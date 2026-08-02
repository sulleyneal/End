import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { db } from "@/db";
import {
  campaigns,
  characters,
  combatants,
  locations,
  messages as messagesTable,
  npcs,
  plotThreads,
  quests,
  rolls as rollsTable,
  worldFacts,
} from "@/db/schema";
import { abilityCheckModifiers, isCondition } from "@/rules/conditions";
import { resolveSave } from "@/rules/combat";
import { combineAdvantage, rollD20 } from "@/rules/dice";
import type { AbilityKey } from "@/srd/types";
import { applyLevelUps, listCharacters } from "@/server/characters";
import { closeStaleSession } from "./recap";
import { getActiveEncounter, performAttack, startEncounter } from "@/server/encounters";
import { appendEvent } from "@/server/events";
import { DM_MODEL, anthropic } from "./client";
import { buildProjection, renderProjection } from "./memory";
import {
  DM_TOOLS,
  applyConditionSchema,
  attackSchema,
  awardXpSchema,
  callForCheckSchema,
  callForSaveSchema,
  dmRulingSchema,
  moveSceneSchema,
  narrateSchema,
  npcSaysSchema,
  rememberSchema,
  removeConditionSchema,
  startEncounterSchema,
} from "./tools";

/**
 * A DM turn.
 *
 * The model is handed the memory projection and the player's action, and
 * replies with tool calls. Each call is validated and executed here, against
 * the rules engine — the model is then told what actually happened and narrates
 * that. An AI that "decides" a hit for 14 damage cannot change a hit point,
 * because no tool it can call accepts a damage number.
 */

const SYSTEM_PROMPT = `You are the Dungeon Master of a Dungeons & Dragons 5th Edition game, running the SRD 5.1 ruleset.

## What you control, and what you do not

You own the story: description, NPCs, pacing, consequences, and rulings on things the rules do not cover.

You do NOT own the numbers. The application is the referee. It owns the dice, the character sheets, and every hit point. You must never state or imply a die result, a damage amount, a hit point total, an attack's success, or whether a check passed, unless a tool result has just told you so. If you want something uncertain to happen, call the tool for it and wait for the answer.

This is not a stylistic preference. It is the only reason players can trust the game.

## How to take a turn

- Call \`narrate\` to describe the scene and the outcome of resolved actions.
- When a player attempts something uncertain, call \`call_for_check\` or \`call_for_save\` and narrate the result you are given.
- When a creature attacks, call \`attack\`. The server rolls and tells you what landed.
- When the rules do not cover something, call \`dm_ruling\` — be decisive and consistent, and prefer letting creative ideas work at a cost.
- Call \`remember\` whenever something durable is established: a name, a promise, a secret, a consequence. Future sessions read only that memory, never this conversation.
- End your turn once you have narrated. Do not call tools speculatively.

## Voice

Write in second person plural, present tense. Be vivid but economical — two or three short paragraphs is usually right, less in combat. Give players real choices and let their decisions land. Never write a player character's dialogue, thoughts, or decisions for them; describe what the world does and hand control back.`;

/** How many tool round-trips a single turn may take before we stop. */
const MAX_ITERATIONS = 6;

export type DmTurnResult = {
  /** Player-visible entries produced this turn, in order. */
  entries: { kind: string; author: string; content: string; metadata?: Record<string, unknown> }[];
  toolCalls: { name: string; ok: boolean; detail: string }[];
  stoppedBecause: "end_turn" | "iteration_limit" | "refusal";
};

type Ctx = {
  campaignId: string;
  entries: DmTurnResult["entries"];
  toolCalls: DmTurnResult["toolCalls"];
};

/* ------------------------------------------------------------------ *
 * Persistence helpers
 * ------------------------------------------------------------------ */

async function postMessage(
  ctx: Ctx,
  params: {
    authorType: "player" | "dm" | "system";
    authorName: string;
    kind: "narration" | "dialogue" | "ooc" | "system" | "ruling" | "action";
    content: string;
    metadata?: Record<string, unknown>;
  },
) {
  const [row] = await db
    .insert(messagesTable)
    .values({
      campaignId: ctx.campaignId,
      authorType: params.authorType,
      authorName: params.authorName,
      kind: params.kind,
      content: params.content,
      metadata: params.metadata,
    })
    .returning({ id: messagesTable.id });

  await appendEvent(ctx.campaignId, "message", {
    messageId: row.id,
    authorType: params.authorType,
    authorName: params.authorName,
    kind: params.kind,
    content: params.content,
    metadata: params.metadata ?? null,
  });

  ctx.entries.push({
    kind: params.kind,
    author: params.authorName,
    content: params.content,
    metadata: params.metadata,
  });
}

/**
 * Anything the DM can call on to roll: a player character, or a monster in the
 * encounter that is running.
 *
 * `call_for_save` and `call_for_check` used to resolve player characters only,
 * so no monster could ever be made to roll. The DM's fallback was to apply the
 * condition unrolled — a player could talk a condition onto a goblin with no
 * die involved, in an app whose whole premise is that the engine is referee.
 */
async function findRollerByName(
  campaignId: string,
  name: string,
): Promise<
  | {
      kind: "character" | "monster";
      id: string;
      name: string;
      conditions: string[];
      exhaustion: number;
      saveModifier: (ability: AbilityKey) => number;
      checkModifier: (key: string) => { modifier: number; label: string } | null;
    }
  | null
> {
  const sheet = await findCharacterByName(campaignId, name);
  if (sheet) {
    return {
      kind: "character",
      id: sheet.id,
      name: sheet.name,
      conditions: sheet.conditions,
      exhaustion: sheet.exhaustion,
      saveModifier: (ability) => sheet.derived.saves[ability].modifier,
      checkModifier: (key) => {
        const skill = sheet.derived.skills[key];
        if (skill) return { modifier: skill.modifier, label: skill.name };
        const abilities: AbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];
        const asAbility = abilities.find((a) => a === key);
        if (!asAbility) return null;
        return {
          modifier: sheet.derived.abilities[asAbility].modifier,
          label: asAbility.toUpperCase(),
        };
      },
    };
  }

  const encounter = await getActiveEncounter(campaignId);
  const needle = name.trim().toLowerCase();
  const monster =
    encounter?.combatants.find((c) => !c.characterId && c.name.toLowerCase() === needle) ??
    encounter?.combatants.find((c) => !c.characterId && c.name.toLowerCase().includes(needle));
  if (!monster) return null;

  const stats = monster.stats as { saveModifiers?: Record<string, number>; abilities?: Record<string, number> } | null;
  const saves = stats?.saveModifiers ?? {};
  const scores = stats?.abilities ?? {};

  return {
    kind: "monster",
    id: monster.id,
    name: monster.name,
    conditions: monster.conditions,
    exhaustion: monster.exhaustion,
    saveModifier: (ability) => saves[ability] ?? 0,
    checkModifier: (key) => {
      const abilities: AbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];
      const asAbility = abilities.find((a) => a === key);
      if (!asAbility) return null;
      const score = scores[asAbility] ?? 10;
      return { modifier: Math.floor((score - 10) / 2), label: asAbility.toUpperCase() };
    },
  };
}

async function findCharacterByName(campaignId: string, name: string) {
  const sheets = await listCharacters(campaignId);
  const needle = name.trim().toLowerCase();
  return (
    sheets.find((s) => s.name.toLowerCase() === needle) ??
    sheets.find((s) => s.name.toLowerCase().includes(needle)) ??
    null
  );
}

/* ------------------------------------------------------------------ *
 * Tool execution — every branch returns text the model will read
 * ------------------------------------------------------------------ */

async function executeTool(ctx: Ctx, name: string, rawInput: unknown): Promise<string> {
  switch (name) {
    case "narrate": {
      const { text } = narrateSchema.parse(rawInput);
      await postMessage(ctx, {
        authorType: "dm",
        authorName: "Dungeon Master",
        kind: "narration",
        content: text,
      });
      return "Narration delivered to the table.";
    }

    case "npc_says": {
      const { npc, text } = npcSaysSchema.parse(rawInput);
      await postMessage(ctx, {
        authorType: "dm",
        authorName: npc,
        kind: "dialogue",
        content: text,
        metadata: { npc },
      });
      return `${npc} spoke.`;
    }

    case "dm_ruling": {
      const ruling = dmRulingSchema.parse(rawInput);
      await postMessage(ctx, {
        authorType: "dm",
        authorName: "Dungeon Master",
        kind: "ruling",
        content: ruling.ruling,
        metadata: { question: ruling.question, mechanic: ruling.mechanic ?? null },
      });
      return "Ruling recorded and shown to the players as a ruling card.";
    }

    case "call_for_check": {
      const input = callForCheckSchema.parse(rawInput);
      const sheet = await findRollerByName(ctx.campaignId, input.character);
      if (!sheet) {
        return `There is nobody called "${input.character}" in this campaign or the current encounter.`;
      }

      const key = input.skill.trim().toLowerCase();
      const resolved = sheet.checkModifier(key);
      if (!resolved) {
        return `"${input.skill}" is not an SRD skill or ability for ${sheet.name}.`;
      }
      const { modifier, label } = resolved;

      // Conditions and exhaustion can impose disadvantage on ability checks.
      const advantage = combineAdvantage([
        abilityCheckModifiers({ conditions: sheet.conditions, exhaustion: sheet.exhaustion }),
      ]);
      const roll = rollD20({ modifier, advantage });
      const success = roll.total >= input.dc;

      await db.insert(rollsTable).values({
        campaignId: ctx.campaignId,
        actorType: sheet.kind,
        actorId: sheet.id,
        actorName: sheet.name,
        kind: "check",
        formula: roll.formula,
        dice: roll.dice,
        modifier: roll.modifier,
        advantage: roll.advantage,
        total: roll.total,
        dc: input.dc,
        outcome: success ? "success" : "failure",
      });

      await postMessage(ctx, {
        authorType: "system",
        authorName: sheet.name,
        kind: "system",
        content: `${sheet.name} rolls ${label} for ${input.reason}: ${roll.natural}${
          roll.modifier >= 0 ? "+" : ""
        }${roll.modifier} = ${roll.total} vs DC ${input.dc} — ${success ? "success" : "failure"}.`,
        metadata: { kind: "check", roll, dc: input.dc, success },
      });

      return `${sheet.name} rolled ${label}: natural ${roll.natural}, total ${roll.total} against DC ${input.dc}. Result: ${
        success ? "SUCCESS" : "FAILURE"
      }. Narrate this outcome.`;
    }

    case "call_for_save": {
      const input = callForSaveSchema.parse(rawInput);
      const sheet = await findRollerByName(ctx.campaignId, input.character);
      if (!sheet) {
        return `There is nobody called "${input.character}" in this campaign or the current encounter.`;
      }

      const outcome = resolveSave({
        ability: input.ability,
        modifier: sheet.saveModifier(input.ability),
        dc: input.dc,
        creature: { conditions: sheet.conditions, exhaustion: sheet.exhaustion },
      });

      if (outcome.roll) {
        await db.insert(rollsTable).values({
          campaignId: ctx.campaignId,
          actorType: sheet.kind,
          actorId: sheet.id,
          actorName: sheet.name,
          kind: "save",
          formula: outcome.roll.formula,
          dice: outcome.roll.dice,
          modifier: outcome.roll.modifier,
          advantage: outcome.advantage,
          total: outcome.total,
          dc: input.dc,
          outcome: outcome.success ? "success" : "failure",
        });
      }

      await postMessage(ctx, {
        authorType: "system",
        authorName: sheet.name,
        kind: "system",
        content: outcome.autoFailed
          ? `${sheet.name} automatically fails a ${input.ability.toUpperCase()} save (${input.reason}).`
          : `${sheet.name} rolls a ${input.ability.toUpperCase()} save for ${input.reason}: ${outcome.total} vs DC ${input.dc} — ${
              outcome.success ? "success" : "failure"
            }.`,
        metadata: { kind: "save", outcome },
      });

      return outcome.autoFailed
        ? `${sheet.name} automatically failed the save (a condition forces it). Narrate the failure.`
        : `${sheet.name} rolled ${outcome.total} against DC ${input.dc}: ${
            outcome.success ? "SUCCESS" : "FAILURE"
          }. Narrate this outcome.`;
    }

    case "attack": {
      const input = attackSchema.parse(rawInput);
      const encounter = await getActiveEncounter(ctx.campaignId);
      if (!encounter) return "There is no active encounter. Call start_encounter first.";

      const find = (needle: string) =>
        encounter.combatants.find((c) => c.name.toLowerCase() === needle.trim().toLowerCase()) ??
        encounter.combatants.find((c) => c.name.toLowerCase().includes(needle.trim().toLowerCase()));

      const attacker = find(input.attacker);
      const target = find(input.target);
      if (!attacker) return `No combatant called "${input.attacker}" is in this fight.`;
      if (!target) return `No combatant called "${input.target}" is in this fight.`;

      let attackIndex = 0;
      if (input.weapon) {
        const i = attacker.attacks.findIndex((a) =>
          a.name.toLowerCase().includes(input.weapon!.toLowerCase()),
        );
        if (i >= 0) attackIndex = i;
      }

      try {
        const report = await performAttack({
          encounterId: encounter.id,
          actorId: attacker.id,
          targetId: target.id,
          attackIndex,
        });
        const a = report.attack;
        const summary = a.hit
          ? `${a.attackerName} hit ${a.targetName} with ${a.weapon} (natural ${a.attackRoll.natural}, total ${a.attackRoll.total} vs AC ${a.targetAc})${
              a.critical ? " — a critical hit" : ""
            } for ${a.damageTaken} damage. ${a.targetName} is now at ${a.targetHpAfter} hit points${
              a.droppedToZero ? " and is down" : ""
            }${a.instantDeath ? " — killed outright" : ""}.`
          : `${a.attackerName} missed ${a.targetName} with ${a.weapon} (natural ${a.attackRoll.natural}, total ${a.attackRoll.total} vs AC ${a.targetAc}).`;

        await postMessage(ctx, {
          authorType: "system",
          authorName: a.attackerName,
          kind: "system",
          content: summary,
          metadata: { kind: "attack", attack: a },
        });

        return `${summary} Narrate exactly this outcome — do not change any number.`;
      } catch (error) {
        return `That attack is not legal: ${error instanceof Error ? error.message : "unknown reason"}`;
      }
    }

    case "apply_condition":
    case "remove_condition": {
      const input =
        name === "apply_condition"
          ? applyConditionSchema.parse(rawInput)
          : removeConditionSchema.parse(rawInput);
      if (!isCondition(input.condition)) return `"${input.condition}" is not an SRD condition.`;

      const sheet = await findCharacterByName(ctx.campaignId, input.target);
      const encounter = await getActiveEncounter(ctx.campaignId);
      const combatant = encounter?.combatants.find(
        (c) => c.name.toLowerCase() === input.target.trim().toLowerCase(),
      );

      if (!sheet && !combatant) return `There is nobody called "${input.target}" here.`;

      const apply = name === "apply_condition";

      // A skeleton cannot be poisoned. Condition immunities come off the
      // monster's own SRD stat block and were being collected but never
      // consulted, so the DM could hand any condition to anything.
      if (apply && combatant) {
        const immunities = (combatant.stats as { conditionImmunities?: string[] } | null)
          ?.conditionImmunities;
        if (immunities?.includes(input.condition)) {
          return `${combatant.name} is immune to being ${input.condition}. Narrate the attempt failing.`;
        }
      }
      const update = (existing: string[]) =>
        apply
          ? [...new Set([...existing, input.condition])]
          : existing.filter((c) => c !== input.condition);

      if (sheet) {
        await db
          .update(characters)
          .set({ conditions: update(sheet.conditions) })
          .where(eq(characters.id, sheet.id));
      }
      if (combatant) {
        await db
          .update(combatants)
          .set({ conditions: update(combatant.conditions) })
          .where(eq(combatants.id, combatant.id));
      }

      await appendEvent(ctx.campaignId, "character.updated", {
        target: input.target,
        condition: input.condition,
        applied: apply,
      });

      return `${input.target} is ${apply ? "now" : "no longer"} ${input.condition}. The engine is enforcing its mechanical effects.`;
    }

    case "start_encounter": {
      const input = startEncounterSchema.parse(rawInput);
      try {
        const encounter = await startEncounter(ctx.campaignId, {
          name: input.name,
          monsters: input.monsters,
        });
        const order = encounter.combatants
          .map((c) => `${c.name} (${c.initiative})`)
          .join(", ");
        await postMessage(ctx, {
          authorType: "system",
          authorName: "System",
          kind: "system",
          content: `Roll for initiative — ${input.name}. Order: ${order}.`,
          metadata: { kind: "encounter", encounterId: encounter.id },
        });
        return `Encounter started. Initiative order: ${order}. It is ${
          encounter.combatants.find((c) => c.id === encounter.activeCombatantId)?.name ?? "nobody"
        }'s turn.`;
      } catch (error) {
        return `Could not start that encounter: ${
          error instanceof Error ? error.message : "unknown reason"
        }`;
      }
    }

    case "move_scene": {
      const input = moveSceneSchema.parse(rawInput);
      const existing = await db
        .select()
        .from(locations)
        .where(and(eq(locations.campaignId, ctx.campaignId), eq(locations.name, input.name)))
        .limit(1);

      let locationId = existing[0]?.id;
      if (!locationId) {
        const [row] = await db
          .insert(locations)
          .values({
            campaignId: ctx.campaignId,
            name: input.name,
            type: input.type ?? null,
            description: input.description ?? null,
            discovered: true,
          })
          .returning({ id: locations.id });
        locationId = row.id;
      } else {
        await db.update(locations).set({ discovered: true }).where(eq(locations.id, locationId));
      }

      await db
        .update(campaigns)
        .set({ currentLocationId: locationId })
        .where(eq(campaigns.id, ctx.campaignId));

      return `The party is now at ${input.name}.`;
    }

    case "remember": {
      const input = rememberSchema.parse(rawInput);
      const written: string[] = [];

      // New NPCs belong to wherever the party currently is, so they keep
      // showing up in the projection instead of vanishing on the next scene.
      const [campaign] = await db
        .select({ currentLocationId: campaigns.currentLocationId })
        .from(campaigns)
        .where(eq(campaigns.id, ctx.campaignId))
        .limit(1);

      for (const fact of input.facts ?? []) {
        await db.insert(worldFacts).values({ campaignId: ctx.campaignId, fact });
        written.push("fact");
      }

      for (const npc of input.npcs ?? []) {
        const [existing] = await db
          .select()
          .from(npcs)
          .where(and(eq(npcs.campaignId, ctx.campaignId), eq(npcs.name, npc.name)))
          .limit(1);

        if (existing) {
          await db
            .update(npcs)
            .set({
              role: npc.role ?? existing.role,
              description: npc.description ?? existing.description,
              voice: npc.voice ?? existing.voice,
              secrets: npc.secrets ?? existing.secrets,
              disposition: Math.max(
                -100,
                Math.min(100, existing.disposition + (npc.dispositionChange ?? 0)),
              ),
            })
            .where(eq(npcs.id, existing.id));
        } else {
          await db.insert(npcs).values({
            campaignId: ctx.campaignId,
            name: npc.name,
            role: npc.role ?? null,
            description: npc.description ?? null,
            voice: npc.voice ?? null,
            secrets: npc.secrets ?? null,
            disposition: npc.dispositionChange ?? 0,
            locationId: campaign?.currentLocationId ?? null,
          });
        }
        written.push(`npc:${npc.name}`);
      }

      for (const thread of input.threads ?? []) {
        const [existing] = await db
          .select()
          .from(plotThreads)
          .where(
            and(eq(plotThreads.campaignId, ctx.campaignId), eq(plotThreads.title, thread.title)),
          )
          .limit(1);

        if (existing) {
          await db
            .update(plotThreads)
            .set({
              summary: thread.summary,
              status: thread.status ?? existing.status,
              urgency: thread.urgency ?? existing.urgency,
              lastTouched: new Date(),
            })
            .where(eq(plotThreads.id, existing.id));
        } else {
          await db.insert(plotThreads).values({
            campaignId: ctx.campaignId,
            title: thread.title,
            summary: thread.summary,
            status: thread.status ?? "open",
            urgency: thread.urgency ?? 3,
          });
        }
        written.push(`thread:${thread.title}`);
      }

      for (const quest of input.quests ?? []) {
        const [existing] = await db
          .select()
          .from(quests)
          .where(and(eq(quests.campaignId, ctx.campaignId), eq(quests.title, quest.title)))
          .limit(1);

        const objectives = (quest.objectives ?? []).map((text) => ({ text, done: false }));
        if (existing) {
          await db
            .update(quests)
            .set({
              status: quest.status ?? existing.status,
              rewards: quest.rewards ?? existing.rewards,
              objectives: objectives.length > 0 ? objectives : existing.objectives,
            })
            .where(eq(quests.id, existing.id));
        } else {
          await db.insert(quests).values({
            campaignId: ctx.campaignId,
            title: quest.title,
            status: quest.status ?? "offered",
            rewards: quest.rewards ?? null,
            objectives,
          });
        }
        written.push(`quest:${quest.title}`);
      }

      return written.length > 0
        ? `Memory updated: ${written.join(", ")}.`
        : "Nothing to remember was provided.";
    }

    case "award_xp": {
      const input = awardXpSchema.parse(rawInput);
      const sheets = await listCharacters(ctx.campaignId);
      const levelled: string[] = [];
      for (const sheet of sheets) {
        await db
          .update(characters)
          .set({ xp: sheet.xp + input.amount })
          .where(eq(characters.id, sheet.id));
        // XP used to be tracked and never spent, so everyone stayed level 1.
        const gained = await applyLevelUps(sheet.id);
        if (gained > 0) levelled.push(`${sheet.name} to level ${sheet.level + gained}`);
      }

      await postMessage(ctx, {
        authorType: "system",
        authorName: "System",
        kind: "system",
        content: `The party gains ${input.amount} XP — ${input.reason}.`,
        metadata: { kind: "xp", amount: input.amount },
      });

      if (levelled.length > 0) {
        await postMessage(ctx, {
          authorType: "system",
          authorName: "System",
          kind: "system",
          content: `Level up: ${levelled.join(", ")}.`,
          metadata: { kind: "level-up" },
        });
      }

      return `Awarded ${input.amount} XP to ${sheets.length} character(s).${
        levelled.length > 0 ? ` Levelled up: ${levelled.join(", ")}.` : ""
      }`;
    }

    default:
      return `There is no tool called "${name}".`;
  }
}

/* ------------------------------------------------------------------ *
 * The turn
 * ------------------------------------------------------------------ */

export async function runDmTurn(params: {
  campaignId: string;
  /** The player's display name, or their character's. */
  actorName: string;
  action: string;
  /** Set for out-of-character table talk, which the DM should not narrate around. */
  ooc?: boolean;
}): Promise<DmTurnResult> {
  const ctx: Ctx = { campaignId: params.campaignId, entries: [], toolCalls: [] };

  // Record the player's action first, so it is in the log even if the DM fails.
  await postMessage(ctx, {
    authorType: "player",
    authorName: params.actorName,
    kind: params.ooc ? "ooc" : "action",
    content: params.action,
  });

  if (params.ooc) {
    return { entries: ctx.entries, toolCalls: [], stoppedBecause: "end_turn" };
  }

  // If the table has been quiet for hours, the last session is over: write it
  // up before this turn starts a new one, so the recap lands without anyone
  // having to remember to ask for it.
  try {
    await closeStaleSession(params.campaignId);
  } catch (error) {
    // A missing recap must never block someone taking their turn.
    console.error("Session close failed", error);
  }

  await appendEvent(params.campaignId, "dm.thinking", { actorName: params.actorName });

  const projection = renderProjection(await buildProjection(params.campaignId));
  const client = anthropic();

  const conversation: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Current state of the campaign:\n\n${projection}\n\n---\n\n${params.actorName} does this:\n\n${params.action}`,
    },
  ];

  let stoppedBecause: DmTurnResult["stoppedBecause"] = "iteration_limit";

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const response = await client.messages.create({
      model: DM_MODEL,
      max_tokens: 8000,
      // The system prompt and tool list are stable, so they cache across turns;
      // the projection and the action come after, where they can vary freely.
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: DM_TOOLS,
      messages: conversation,
    });

    if (response.stop_reason === "refusal") {
      await postMessage(ctx, {
        authorType: "system",
        authorName: "System",
        kind: "system",
        content: "The DM declined to narrate that. Try a different action.",
      });
      return { entries: ctx.entries, toolCalls: ctx.toolCalls, stoppedBecause: "refusal" };
    }

    // Preserve the assistant turn verbatim — thinking blocks included.
    conversation.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUses.length === 0) {
      // The model wrote prose instead of narrating through a tool; still show it.
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (text) {
        await postMessage(ctx, {
          authorType: "dm",
          authorName: "Dungeon Master",
          kind: "narration",
          content: text,
        });
      }
      stoppedBecause = "end_turn";
      break;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      let detail: string;
      let ok = true;
      try {
        detail = await executeTool(ctx, use.name, use.input);
      } catch (error) {
        ok = false;
        // Validation failures go back to the model as text so it can correct
        // itself. A raw ZodError message is a JSON dump — name the offending
        // fields instead, or the model just retries the same malformed call.
        if (error instanceof ZodError) {
          const issues = error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; ");
          detail = `That ${use.name} call was rejected — ${issues}. Fix those fields and call it again.`;
        } else {
          detail =
            error instanceof Error
              ? `That call was rejected: ${error.message}`
              : "That call was rejected.";
        }
        console.error(`DM tool ${use.name} failed:`, error);
      }
      ctx.toolCalls.push({ name: use.name, ok, detail });
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: detail,
        ...(ok ? {} : { is_error: true }),
      });
    }

    conversation.push({ role: "user", content: results });
  }

  return { entries: ctx.entries, toolCalls: ctx.toolCalls, stoppedBecause };
}
