import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { characters, combatants, encounters, maps, rolls as rollsTable } from "@/db/schema";
import type { MapTerrain } from "@/db/schema";
import type { DerivedAttack } from "@/rules/character";
import { abilityModifier } from "@/rules/character";
import {
  type CombatantState,
  applyDamage,
  resolveAttack,
  rollDeathSave,
  rollInitiative,
  rollWeaponDamage,
  sortInitiative,
} from "@/rules/combat";
import { canTakeActions, effectiveSpeed } from "@/rules/conditions";
import { checkMeleeReach, checkRange, distanceFt, provokesOpportunityAttacks, validatePath } from "@/rules/movement";
import type { RollResult } from "@/rules/dice";
import { srd } from "@/srd/local";
import { listCharacters } from "./characters";
import { appendEvent } from "./events";
import { NotFoundError, RuleError } from "./http";
import { type CombatStats, monsterArmorClass, monsterCombatStats, monsterHitPoints } from "./monsters";

/**
 * Encounter orchestration.
 *
 * The rules engine decides outcomes; this module decides *whether an action is
 * allowed to happen at all* — whose turn it is, whether the actor still has the
 * action, whether the target is in reach — then persists the result and
 * announces it on the event log.
 */

type CombatantRow = typeof combatants.$inferSelect;

export type CombatantView = CombatantRow & {
  stats: CombatStats | null;
  attacks: DerivedAttack[];
};

export type MapView = {
  id: string;
  width: number;
  height: number;
  cellSizeFt: number;
  terrain: MapTerrain;
  background: string | null;
};

export type EncounterView = {
  id: string;
  campaignId: string;
  mapId: string | null;
  name: string;
  status: string;
  round: number;
  turnIndex: number;
  combatants: CombatantView[];
  /** The battlefield itself, so the client can draw terrain it must not invent. */
  map: MapView | null;
  /** The combatant whose turn it is, or null outside an active encounter. */
  activeCombatantId: string | null;
};

const asState = (row: CombatantRow): CombatantState => ({
  name: row.name,
  hpCurrent: row.hpCurrent,
  hpMax: row.hpMax,
  tempHp: row.tempHp,
  ac: row.ac,
  conditions: row.conditions,
  exhaustion: row.exhaustion,
  deathSuccesses: row.deathSuccesses,
  deathFailures: row.deathFailures,
  stable: row.stable,
  defeated: row.defeated,
  concentration: row.concentration ?? null,
  resistances: (row.stats as CombatStats | null)?.resistances ?? [],
  immunities: (row.stats as CombatStats | null)?.immunities ?? [],
  vulnerabilities: (row.stats as CombatStats | null)?.vulnerabilities ?? [],
  isPlayerCharacter: row.characterId !== null,
});

/**
 * Mirrors a combatant's condition back onto its character sheet.
 *
 * The combatant row is the authority during a fight, but the sheet is what the
 * party panel renders and what the DM's memory projection reads. Without this
 * write-back the two drift: a dying player shows full HP to the table, the AI
 * is told the party is uninjured, and every wound evaporates when the encounter
 * ends. Call this after anything that changes a combatant's hit points or
 * death-save track.
 */
async function syncSheet(combatantId: string) {
  const [row] = await db.select().from(combatants).where(eq(combatants.id, combatantId)).limit(1);
  if (!row?.characterId) return;

  await db
    .update(characters)
    .set({
      hpCurrent: row.hpCurrent,
      tempHp: row.tempHp,
      conditions: row.conditions,
      exhaustion: row.exhaustion,
      deathSuccesses: row.deathSuccesses,
      deathFailures: row.deathFailures,
      stable: row.stable,
    })
    .where(eq(characters.id, row.characterId));
}

/* ------------------------------------------------------------------ *
 * Starting an encounter
 * ------------------------------------------------------------------ */

export type EncounterRequest = {
  name: string;
  /** Monster index plus how many, e.g. `{ index: "goblin", count: 4 }`. */
  monsters: { index: string; count: number }[];
  /** Character ids to roll in. Defaults to every character in the campaign. */
  characterIds?: string[];
  mapId?: string | null;
};

/**
 * Rolls initiative for everyone and opens the encounter.
 *
 * Initiative is rolled here, once, server-side — a client never submits its own
 * initiative result.
 */
export async function startEncounter(
  campaignId: string,
  request: EncounterRequest,
): Promise<EncounterView> {
  const sheets = await listCharacters(campaignId);
  const chosen = request.characterIds
    ? sheets.filter((s) => request.characterIds!.includes(s.id))
    : sheets;

  if (chosen.length === 0) {
    throw new RuleError("There are no characters in this campaign to fight.");
  }

  let mapId = request.mapId ?? null;
  if (!mapId) {
    const [map] = await db
      .insert(maps)
      .values({ campaignId, name: `${request.name} — battlefield`, width: 20, height: 20 })
      .returning({ id: maps.id });
    mapId = map.id;
  }

  const [encounter] = await db
    .insert(encounters)
    .values({ campaignId, mapId, name: request.name, status: "active", round: 1 })
    .returning();

  const rows: (typeof combatants.$inferInsert)[] = [];
  const rollLog: { name: string; roll: RollResult }[] = [];

  chosen.forEach((sheet, i) => {
    const state = { conditions: sheet.conditions, exhaustion: sheet.exhaustion };
    const roll = rollInitiative({ modifier: sheet.derived.initiative, creature: state });
    rollLog.push({ name: sheet.name, roll });

    rows.push({
      encounterId: encounter.id,
      characterId: sheet.id,
      name: sheet.name,
      side: "party",
      initiative: roll.total,
      initiativeTiebreak: sheet.derived.abilities.dex.score,
      hpCurrent: sheet.hpCurrent,
      hpMax: sheet.hpMax,
      tempHp: sheet.tempHp,
      ac: sheet.derived.armorClass.value,
      speed: sheet.derived.speed.base,
      conditions: sheet.conditions,
      exhaustion: sheet.exhaustion,
      x: 2,
      y: 2 + i * 2,
      size: 1,
      stats: {
        abilities: {
          str: sheet.derived.abilities.str.score,
          dex: sheet.derived.abilities.dex.score,
          con: sheet.derived.abilities.con.score,
          int: sheet.derived.abilities.int.score,
          wis: sheet.derived.abilities.wis.score,
          cha: sheet.derived.abilities.cha.score,
        },
        saveModifiers: Object.fromEntries(
          Object.entries(sheet.derived.saves).map(([k, v]) => [k, v.modifier]),
        ),
        attacks: sheet.derived.attacks,
        // Racial resistances travel with the character into the fight; without
        // this a tiefling takes full fire damage despite Hellish Resistance.
        resistances: sheet.derived.resistances,
        immunities: [],
        vulnerabilities: [],
        conditionImmunities: [],
        speed: sheet.derived.speed.base,
        size: 1,
        cr: 0,
        xp: 0,
      } satisfies CombatStats,
    });
  });

  let foeIndex = 0;
  for (const entry of request.monsters) {
    const monster = srd.monsters().find((m) => m.index === entry.index);
    if (!monster) throw new RuleError(`No SRD monster called "${entry.index}".`);
    const count = Math.max(1, Math.min(20, entry.count));
    const stats = monsterCombatStats(monster);

    for (let n = 0; n < count; n++) {
      const state = { conditions: [], exhaustion: 0 };
      const roll = rollInitiative({
        modifier: abilityModifier(monster.dexterity),
        creature: state,
      });
      const name = count > 1 ? `${monster.name} ${n + 1}` : monster.name;
      rollLog.push({ name, roll });

      rows.push({
        encounterId: encounter.id,
        monsterIndex: monster.index,
        name,
        side: "foe",
        initiative: roll.total,
        initiativeTiebreak: monster.dexterity,
        hpCurrent: monsterHitPoints(monster),
        hpMax: monsterHitPoints(monster),
        ac: monsterArmorClass(monster),
        speed: stats.speed,
        x: 12 + (foeIndex % 4),
        y: 2 + Math.floor(foeIndex / 4) * 2,
        size: stats.size,
        stats,
      });
      foeIndex += 1;
    }
  }

  await db.insert(combatants).values(rows);

  // Persist every initiative roll so the log can show how the order was decided.
  await db.insert(rollsTable).values(
    rollLog.map((entry) => ({
      campaignId,
      encounterId: encounter.id,
      actorType: "combatant",
      actorName: entry.name,
      kind: "initiative",
      formula: entry.roll.formula,
      dice: entry.roll.dice,
      modifier: entry.roll.modifier,
      advantage: entry.roll.advantage,
      total: entry.roll.total,
    })),
  );

  const view = await getEncounter(encounter.id);
  await appendEvent(campaignId, "encounter.started", {
    encounterId: encounter.id,
    name: encounter.name,
    order: view.combatants.map((c) => ({ id: c.id, name: c.name, initiative: c.initiative })),
  });
  return view;
}

/* ------------------------------------------------------------------ *
 * Reading an encounter
 * ------------------------------------------------------------------ */

export async function getEncounter(encounterId: string): Promise<EncounterView> {
  const [encounter] = await db
    .select()
    .from(encounters)
    .where(eq(encounters.id, encounterId))
    .limit(1);
  if (!encounter) throw new NotFoundError("No such encounter.");

  const rows = await db
    .select()
    .from(combatants)
    .where(eq(combatants.encounterId, encounterId));

  const ordered = sortInitiative(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      initiative: row.initiative ?? 0,
      tiebreak: row.initiativeTiebreak,
      row,
    })),
  ).map((entry) => entry.row);

  const view: CombatantView[] = ordered.map((row) => ({
    ...row,
    stats: row.stats as CombatStats | null,
    attacks: (row.stats as CombatStats | null)?.attacks ?? [],
  }));

  const living = view.filter((c) => !c.defeated);
  const active =
    encounter.status === "active" && living.length > 0
      ? (view[encounter.turnIndex % view.length]?.id ?? null)
      : null;

  const [mapRow] = encounter.mapId
    ? await db.select().from(maps).where(eq(maps.id, encounter.mapId)).limit(1)
    : [];

  return {
    id: encounter.id,
    campaignId: encounter.campaignId,
    mapId: encounter.mapId,
    name: encounter.name,
    status: encounter.status,
    round: encounter.round,
    turnIndex: encounter.turnIndex,
    combatants: view,
    map: mapRow
      ? {
          id: mapRow.id,
          width: mapRow.width,
          height: mapRow.height,
          cellSizeFt: mapRow.cellSizeFt,
          terrain: mapRow.terrain,
          background: mapRow.background,
        }
      : null,
    activeCombatantId: active,
  };
}

export async function getActiveEncounter(campaignId: string): Promise<EncounterView | null> {
  const [row] = await db
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.campaignId, campaignId), eq(encounters.status, "active")))
    .limit(1);
  return row ? getEncounter(row.id) : null;
}

/* ------------------------------------------------------------------ *
 * Turn gating
 * ------------------------------------------------------------------ */

/**
 * Gates an action on it being this combatant's turn.
 *
 * `allowIncapacitated` exists because an unconscious creature still *has* a
 * turn — it makes a death save and passes. Blocking incapacitated actors from
 * ending their own turn deadlocks the encounter permanently the first time
 * anyone drops to 0 HP, since nothing else can advance the pointer past them.
 * Only rolling a death save and ending the turn may set it.
 */
async function requireTurn(
  encounterId: string,
  combatantId: string,
  options: { allowIncapacitated?: boolean } = {},
) {
  const encounter = await getEncounter(encounterId);
  if (encounter.status !== "active") throw new RuleError("This encounter is not running.");
  if (encounter.activeCombatantId !== combatantId) {
    const active = encounter.combatants.find((c) => c.id === encounter.activeCombatantId);
    throw new RuleError(`It is ${active?.name ?? "someone else"}'s turn.`);
  }

  const actor = encounter.combatants.find((c) => c.id === combatantId);
  if (!actor) throw new NotFoundError("No such combatant.");
  if (actor.defeated) throw new RuleError(`${actor.name} is out of the fight.`);
  if (
    !options.allowIncapacitated &&
    !canTakeActions({ conditions: actor.conditions, exhaustion: actor.exhaustion })
  ) {
    throw new RuleError(`${actor.name} is incapacitated and cannot act.`);
  }

  return { encounter, actor };
}

/* ------------------------------------------------------------------ *
 * Attacking
 * ------------------------------------------------------------------ */

export type AttackReport = {
  encounter: EncounterView;
  attack: {
    attackerName: string;
    targetName: string;
    weapon: string;
    attackRoll: RollResult;
    hit: boolean;
    critical: boolean;
    targetAc: number;
    damage: RollResult | null;
    damageTaken: number;
    targetHpAfter: number;
    droppedToZero: boolean;
    instantDeath: boolean;
  };
};

export async function performAttack(params: {
  encounterId: string;
  actorId: string;
  targetId: string;
  attackIndex: number;
}): Promise<AttackReport> {
  const { encounter, actor } = await requireTurn(params.encounterId, params.actorId);

  if (actor.actionUsed) throw new RuleError(`${actor.name} has already taken an action this turn.`);

  const target = encounter.combatants.find((c) => c.id === params.targetId);
  if (!target) throw new NotFoundError("No such target.");
  if (target.defeated) throw new RuleError(`${target.name} is already out of the fight.`);
  if (target.id === actor.id) throw new RuleError("A combatant cannot attack itself.");

  const attack = actor.attacks[params.attackIndex];
  if (!attack) throw new RuleError(`${actor.name} has no attack ready in that slot.`);

  // Range is enforced against the map, not trusted from the request.
  const from = { x: actor.x ?? 0, y: actor.y ?? 0 };
  const to = { x: target.x ?? 0, y: target.y ?? 0 };
  const rangeFt = distanceFt(from, to);

  let longRange = false;
  if (attack.kind === "melee") {
    const reach = checkMeleeReach(from, to, attack.reachFt ?? 5);
    if (!reach.inRange) throw new RuleError(reach.reason ?? "Target is out of reach.");
  } else {
    const range = checkRange(from, to, attack.rangeFt ?? { normal: 20, long: 60 });
    if (!range.inRange) throw new RuleError(range.reason ?? "Target is out of range.");
    longRange = range.longRange;
  }

  const outcome = resolveAttack({
    attackBonus: attack.attackBonus,
    attacker: { conditions: actor.conditions, exhaustion: actor.exhaustion },
    target: { conditions: target.conditions, exhaustion: target.exhaustion, ac: target.ac },
    rangeFt,
    situational: { disadvantage: longRange },
  });

  let damageRoll: RollResult | null = null;
  let damageTaken = 0;
  let droppedToZero = false;
  let instantDeath = false;
  let targetHpAfter = target.hpCurrent;

  if (outcome.hit) {
    const { roll, packet } = rollWeaponDamage(attack, { critical: outcome.critical });
    damageRoll = roll;

    const result = applyDamage(asState(target), packet, { critical: outcome.critical });
    damageTaken = result.adjusted;
    droppedToZero = result.droppedToZero;
    instantDeath = result.instantDeath;

    await db.update(combatants).set(result.patch).where(eq(combatants.id, target.id));
    targetHpAfter = result.patch.hpCurrent ?? target.hpCurrent;

    if (droppedToZero && result.patch.defeated !== true) {
      // A player character at 0 HP falls unconscious and begins death saves.
      await db
        .update(combatants)
        .set({ conditions: [...new Set([...target.conditions, "unconscious"])] })
        .where(eq(combatants.id, target.id));
    }

    await syncSheet(target.id);
  }

  await db.update(combatants).set({ actionUsed: true }).where(eq(combatants.id, actor.id));

  await db.insert(rollsTable).values([
    {
      campaignId: encounter.campaignId,
      encounterId: encounter.id,
      actorType: "combatant",
      actorId: actor.id,
      actorName: actor.name,
      kind: "attack",
      formula: outcome.roll.formula,
      dice: outcome.roll.dice,
      modifier: outcome.roll.modifier,
      advantage: outcome.advantage,
      total: outcome.roll.total,
      targetName: target.name,
      dc: target.ac,
      outcome: outcome.critical ? "critical" : outcome.hit ? "hit" : "miss",
    },
    ...(damageRoll
      ? [
          {
            campaignId: encounter.campaignId,
            encounterId: encounter.id,
            actorType: "combatant",
            actorId: actor.id,
            actorName: actor.name,
            kind: "damage",
            formula: damageRoll.formula,
            dice: damageRoll.dice,
            modifier: damageRoll.modifier,
            advantage: "normal" as const,
            total: damageRoll.total,
            targetName: target.name,
            outcome: `${damageTaken} ${attack.damageType}`,
          },
        ]
      : []),
  ]);

  const updated = await getEncounter(params.encounterId);
  await appendEvent(encounter.campaignId, "combatant.updated", {
    encounterId: encounter.id,
    attackerName: actor.name,
    targetName: target.name,
    weapon: attack.name,
    natural: outcome.natural,
    total: outcome.roll.total,
    hit: outcome.hit,
    critical: outcome.critical,
    damage: damageTaken,
    targetHpAfter,
    droppedToZero,
    instantDeath,
  });

  return {
    encounter: updated,
    attack: {
      attackerName: actor.name,
      targetName: target.name,
      weapon: attack.name,
      attackRoll: outcome.roll,
      hit: outcome.hit,
      critical: outcome.critical,
      targetAc: target.ac,
      damage: damageRoll,
      damageTaken,
      targetHpAfter,
      droppedToZero,
      instantDeath,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Movement
 * ------------------------------------------------------------------ */

export async function moveCombatant(params: {
  encounterId: string;
  combatantId: string;
  path: { x: number; y: number }[];
}): Promise<{ encounter: EncounterView; costFt: number; provoked: { id: string; name: string }[] }> {
  const { encounter, actor } = await requireTurn(params.encounterId, params.combatantId);

  const [map] = encounter.mapId
    ? await db.select().from(maps).where(eq(maps.id, encounter.mapId)).limit(1)
    : [];
  if (!map) throw new RuleError("This encounter has no battlefield.");

  const budget =
    effectiveSpeed(actor.speed, { conditions: actor.conditions, exhaustion: actor.exhaustion }) -
    actor.movementUsed;

  const from = { x: actor.x ?? 0, y: actor.y ?? 0 };
  const occupied = encounter.combatants
    .filter((c) => c.id !== actor.id && !c.defeated && c.x !== null && c.y !== null)
    .map((c) => ({ x: c.x!, y: c.y! }));

  const validation = validatePath(from, params.path, {
    map: { width: map.width, height: map.height },
    terrain: map.terrain,
    occupied,
    budgetFt: budget,
  });

  if (!validation.ok) throw new RuleError(validation.reason);

  // Leaving an enemy's reach is announced so a reaction can be offered.
  const enemies = encounter.combatants
    .filter((c) => c.side !== actor.side && !c.defeated && c.x !== null && c.y !== null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      cell: { x: c.x!, y: c.y! },
      reachFt: c.attacks.find((a) => a.kind === "melee")?.reachFt ?? 5,
    }));
  const provoked = provokesOpportunityAttacks(from, params.path, enemies);

  const destination = params.path[params.path.length - 1] ?? from;
  await db
    .update(combatants)
    .set({
      x: destination.x,
      y: destination.y,
      movementUsed: actor.movementUsed + validation.costFt,
    })
    .where(eq(combatants.id, actor.id));

  const updated = await getEncounter(params.encounterId);
  await appendEvent(encounter.campaignId, "token.moved", {
    encounterId: encounter.id,
    combatantId: actor.id,
    name: actor.name,
    to: destination,
    costFt: validation.costFt,
    provoked,
  });

  return { encounter: updated, costFt: validation.costFt, provoked };
}

/* ------------------------------------------------------------------ *
 * Turns and death saves
 * ------------------------------------------------------------------ */

export async function endTurn(encounterId: string, combatantId: string): Promise<EncounterView> {
  const { encounter, actor } = await requireTurn(encounterId, combatantId, {
    allowIncapacitated: true,
  });

  // Reset the outgoing combatant's economy.
  await db
    .update(combatants)
    .set({ movementUsed: 0, actionUsed: false, bonusUsed: false, reactionUsed: false })
    .where(eq(combatants.id, actor.id));

  const total = encounter.combatants.length;
  let nextIndex = encounter.turnIndex;
  let round = encounter.round;

  // Skip anyone already out of the fight; stop if nobody is left standing.
  for (let step = 0; step < total; step++) {
    nextIndex += 1;
    if (nextIndex >= total) {
      nextIndex = 0;
      round += 1;
    }
    const next = encounter.combatants[nextIndex];
    if (next && !next.defeated) break;
  }

  await db
    .update(encounters)
    .set({ turnIndex: nextIndex, round })
    .where(eq(encounters.id, encounterId));

  const updated = await getEncounter(encounterId);
  await appendEvent(encounter.campaignId, "turn.changed", {
    encounterId,
    round: updated.round,
    activeCombatantId: updated.activeCombatantId,
    activeName: updated.combatants.find((c) => c.id === updated.activeCombatantId)?.name ?? null,
  });

  return maybeEndEncounter(updated);
}

export async function performDeathSave(params: {
  encounterId: string;
  combatantId: string;
}): Promise<{ encounter: EncounterView; roll: RollResult; result: string }> {
  // A death save is a turn's worth of action, so it is gated exactly like an
  // attack or a move. Without this a dying client could POST repeatedly and
  // burn the whole three-and-three track inside one round.
  const { encounter, actor } = await requireTurn(params.encounterId, params.combatantId, {
    allowIncapacitated: true,
  });
  if (actor.defeated) throw new RuleError(`${actor.name} is beyond saving.`);
  if (actor.hpCurrent > 0) throw new RuleError(`${actor.name} is still on their feet.`);
  if (actor.stable) throw new RuleError(`${actor.name} is stable and no longer rolling.`);
  // One death save per turn. Without this a client can spam the route and farm
  // the three-and-three track — stopping at two successes, or fishing for the
  // natural 20 that revives at 1 HP.
  if (actor.actionUsed) {
    throw new RuleError(`${actor.name} has already rolled a death save this turn.`);
  }

  const outcome = rollDeathSave(asState(actor));
  await db
    .update(combatants)
    .set({ ...outcome.patch, actionUsed: true })
    .where(eq(combatants.id, actor.id));
  await syncSheet(actor.id);

  await db.insert(rollsTable).values({
    campaignId: encounter.campaignId,
    encounterId: encounter.id,
    actorType: "combatant",
    actorId: actor.id,
    actorName: actor.name,
    kind: "death_save",
    formula: outcome.roll.formula,
    dice: outcome.roll.dice,
    modifier: 0,
    advantage: "normal",
    total: outcome.roll.total,
    dc: 10,
    outcome: outcome.result,
  });

  const updated = await getEncounter(params.encounterId);
  await appendEvent(encounter.campaignId, "combatant.updated", {
    encounterId: encounter.id,
    combatantId: actor.id,
    name: actor.name,
    deathSave: outcome.result,
    revived: outcome.revived,
    stabilized: outcome.stabilized,
    dead: outcome.dead,
  });

  return { encounter: await maybeEndEncounter(updated), roll: outcome.roll, result: outcome.result };
}

/** Closes the encounter once one side has nobody left standing. */
async function maybeEndEncounter(view: EncounterView): Promise<EncounterView> {
  if (view.status !== "active") return view;

  const standing = (side: string) =>
    view.combatants.some((c) => c.side === side && !c.defeated && c.hpCurrent > 0);

  if (standing("party") && standing("foe")) return view;

  await db.update(encounters).set({ status: "resolved" }).where(eq(encounters.id, view.id));
  const outcome = standing("party") ? "victory" : "defeat";

  // Belt and braces: the sheet is already written back after every hit, but the
  // fight is over here and the sheet is what the party carries forward, so make
  // the invariant hold even if some future path forgets to sync.
  for (const c of view.combatants) {
    if (c.characterId) await syncSheet(c.id);
  }

  await appendEvent(view.campaignId, "encounter.ended", {
    encounterId: view.id,
    outcome,
    survivors: view.combatants.filter((c) => !c.defeated).map((c) => c.name),
  });

  return { ...view, status: "resolved", activeCombatantId: null };
}
