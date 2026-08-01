import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { characterSpells, combatants, rolls as rollsTable, spellSlots } from "@/db/schema";
import type { AbilityKey } from "@/srd/types";
import { srdGet } from "@/srd/local";
import {
  type CombatantState,
  applyDamage,
  applyHealing,
  concentrationDc,
  resolveAttack,
  resolveSave,
} from "@/rules/combat";
import { rollDamage } from "@/rules/dice";
import type { RollResult } from "@/rules/dice";
import { distanceFt } from "@/rules/movement";
import {
  SpellError,
  damageDiceFor,
  healingDiceFor,
  isTouch,
  rangeFt,
  selfAreaFt,
  shapeOf,
  validateSlot,
} from "@/rules/spells";
import { appendEvent } from "./events";
import { NotFoundError, RuleError } from "./http";

/**
 * Casting.
 *
 * The slot is spent before anything is rolled, so a failed spell still costs
 * you the slot — as it does at a real table. Every number here comes from the
 * engine: the AI can ask for a spell to be cast, but it can no more choose the
 * damage than a player can.
 */

export type CastReport = {
  spellName: string;
  slotLevel: number;
  casterName: string;
  attackRoll: RollResult | null;
  saves: { targetName: string; roll: number | null; success: boolean; dc: number }[];
  damageRoll: RollResult | null;
  results: { targetName: string; damage: number; healed: number; hpAfter: number }[];
  concentrating: boolean;
  /** The spell's own SRD text, when the engine handed the effect to the DM. */
  needsRuling: string | null;
  narration: string;
};

/** The slots a character has, with what they have already spent. */
export async function slotsFor(characterId: string) {
  const rows = await db.select().from(spellSlots).where(eq(spellSlots.characterId, characterId));
  return rows
    .map((r) => ({ level: r.level, max: r.max, used: r.used }))
    .sort((a, b) => a.level - b.level);
}

/** Spell indexes this character can actually cast right now. */
export async function knownSpells(characterId: string) {
  const rows = await db
    .select()
    .from(characterSpells)
    .where(eq(characterSpells.characterId, characterId));
  return rows.map((r) => ({
    spellIndex: r.spellIndex,
    prepared: r.prepared || r.alwaysPrepared,
  }));
}

export async function castSpell(params: {
  campaignId: string;
  encounterId: string;
  caster: {
    id: string;
    characterId: string | null;
    name: string;
    level: number;
    x: number | null;
    y: number | null;
    spellAttackBonus: number;
    spellSaveDc: number;
    spellModifier: number;
    conditions: string[];
    exhaustion: number;
  };
  spellIndex: string;
  slotLevel: number;
  /** Called when a damaged target was concentrating, so the caller can roll it. */
  onConcentrationCheck?: (combatantId: string, damage: number) => Promise<unknown>;
  targets: {
    id: string;
    name: string;
    state: CombatantState;
    x: number | null;
    y: number | null;
    /** Every save modifier, so the spell picks the ability it actually calls for. */
    saveModifiers: Partial<Record<string, number>>;
  }[];
}): Promise<CastReport> {
  const { caster } = params;
  if (!caster.characterId) {
    throw new RuleError(`${caster.name} does not cast spells.`);
  }

  let spell;
  try {
    spell = srdGet.spell(params.spellIndex);
  } catch {
    throw new NotFoundError(`No SRD spell called "${params.spellIndex}".`);
  }

  const known = await knownSpells(caster.characterId);
  const entry = known.find((k) => k.spellIndex === spell.index);
  if (!entry) throw new RuleError(`${caster.name} does not know ${spell.name}.`);
  if (!entry.prepared && spell.level > 0) {
    throw new RuleError(`${caster.name} does not have ${spell.name} prepared.`);
  }

  const slots = await slotsFor(caster.characterId);
  let spent: ReturnType<typeof validateSlot>;
  try {
    spent = validateSlot(spell, params.slotLevel, slots);
  } catch (error) {
    throw error instanceof SpellError ? new RuleError(error.message) : error;
  }

  // Checked before the slot is spent — an out-of-range target is a mistake, not
  // a wasted resource. `isSelfOrTouch` used to skip this entirely, which let a cleric touch
  // someone 20 ft away and let a 15-foot cone reach across the whole map.
  // Touch is 5 ft; a Self spell with an area is measured from the caster's own
  // square by that area's size.
  const limitFt = (() => {
    if (isTouch(spell)) return 5;
    const area = selfAreaFt(spell);
    if (area !== null) return area;
    return rangeFt(spell);
  })();

  if (limitFt !== null && caster.x !== null && caster.y !== null) {
    for (const target of params.targets) {
      if (target.x === null || target.y === null) continue;
      if (target.id === caster.id) continue;
      const away = distanceFt({ x: caster.x, y: caster.y }, { x: target.x, y: target.y });
      if (away > limitFt) {
        throw new RuleError(
          `${target.name} is ${away} ft away, beyond ${spell.name}'s ${limitFt} ft ${
            selfAreaFt(spell) !== null ? "area" : "range"
          }.`,
        );
      }
    }
  }

  // Spend the slot now. A missed spell still costs you the slot.
  //
  // One statement, conditional on the slot still being free, because a
  // read-then-write races: two simultaneous casts both read the same `used`
  // and both write used+1, so one slot pays for two spells. The event log
  // already avoids this shape for the same reason.
  if (!spent.cantrip) {
    const claimed = await db
      .update(spellSlots)
      .set({ used: sql`${spellSlots.used} + 1` })
      .where(
        and(
          eq(spellSlots.characterId, caster.characterId),
          eq(spellSlots.level, params.slotLevel),
          lt(spellSlots.used, spellSlots.max),
        ),
      )
      .returning({ level: spellSlots.level });

    if (claimed.length === 0) {
      throw new RuleError(`Your level ${params.slotLevel} spell slots are all spent.`);
    }
  }

  const shape = shapeOf(spell);
  const casterState = { conditions: caster.conditions, exhaustion: caster.exhaustion };
  const report: CastReport = {
    spellName: spell.name,
    slotLevel: spent.cantrip ? 0 : params.slotLevel,
    casterName: caster.name,
    attackRoll: null,
    saves: [],
    damageRoll: null,
    results: [],
    concentrating: false,
    needsRuling: null,
    narration: "",
  };

  const damageFormula = damageDiceFor(spell, {
    slotLevel: report.slotLevel,
    characterLevel: caster.level,
    modifier: caster.spellModifier,
  });
  const healFormula = healingDiceFor(spell, report.slotLevel || 1, caster.spellModifier);
  const damageType = spell.damage?.damage_type?.index ?? "force";

  const applyTo = async (
    target: (typeof params.targets)[number],
    amount: number,
    critical: boolean,
  ) => {
    const outcome = applyDamage(target.state, { amount, type: damageType }, { critical });
    await db.update(combatants).set(outcome.patch).where(eq(combatants.id, target.id));
    if (outcome.concentrationCheckDc !== null) {
      await params.onConcentrationCheck?.(target.id, outcome.adjusted);
    }
    report.results.push({
      targetName: target.name,
      damage: outcome.adjusted,
      healed: 0,
      hpAfter: outcome.patch.hpCurrent ?? target.state.hpCurrent,
    });
    return outcome;
  };

  if (shape.kind === "attack") {
    const target = params.targets[0];
    if (!target) throw new RuleError(`${spell.name} needs a target.`);

    const away =
      caster.x !== null && caster.y !== null && target.x !== null && target.y !== null
        ? distanceFt({ x: caster.x, y: caster.y }, { x: target.x, y: target.y })
        : 5;

    const outcome = resolveAttack({
      attackBonus: caster.spellAttackBonus,
      attacker: casterState,
      target: target.state,
      rangeFt: away,
    });
    report.attackRoll = outcome.roll;

    if (outcome.hit && damageFormula) {
      const roll = rollDamage(damageFormula, { critical: outcome.critical });
      report.damageRoll = roll;
      await applyTo(target, roll.total, outcome.critical);
    } else if (!outcome.hit) {
      report.results.push({
        targetName: target.name,
        damage: 0,
        healed: 0,
        hpAfter: target.state.hpCurrent,
      });
    }
  } else if (shape.kind === "save") {
    // One damage roll shared by every target, which is how an area spell works.
    const roll = damageFormula ? rollDamage(damageFormula) : null;
    report.damageRoll = roll;

    for (const target of params.targets) {
      const save = resolveSave({
        ability: shape.ability as AbilityKey,
        modifier: target.saveModifiers[shape.ability] ?? 0,
        dc: caster.spellSaveDc,
        creature: target.state,
      });
      report.saves.push({
        targetName: target.name,
        roll: save.roll?.total ?? null,
        success: save.success,
        dc: caster.spellSaveDc,
      });

      // Every roll is visible to the whole table (house rule 3). The target's
      // save used to live only in the caster's HTTP response, so the dice log
      // showed damage nobody could see had been resisted.
      if (save.roll) {
        await db.insert(rollsTable).values({
          campaignId: params.campaignId,
          encounterId: params.encounterId,
          actorType: "combatant",
          actorId: target.id,
          actorName: target.name,
          kind: "save",
          formula: save.roll.formula,
          dice: save.roll.dice,
          modifier: save.roll.modifier,
          advantage: save.advantage,
          total: save.total,
          targetName: spell.name,
          dc: caster.spellSaveDc,
          outcome: save.success ? "save" : "failed save",
        });
      }

      if (!roll) continue;
      const full = roll.total;
      const amount = save.success ? (shape.onSuccess === "half" ? Math.floor(full / 2) : 0) : full;
      if (amount > 0) await applyTo(target, amount, false);
      else
        report.results.push({
          targetName: target.name,
          damage: 0,
          healed: 0,
          hpAfter: target.state.hpCurrent,
        });
    }
  } else if (shape.kind === "auto") {
    // No attack roll, no save — the damage simply lands on every target.
    const roll = damageFormula ? rollDamage(damageFormula) : null;
    report.damageRoll = roll;
    if (roll) {
      for (const target of params.targets) await applyTo(target, roll.total, false);
    }
  } else if (shape.kind === "adjudicate" || shape.kind === "utility") {
    // The engine will not invent a number it cannot derive. The slot is spent
    // and the cast is recorded; the effect is a ruling, which is exactly the
    // escalation house rule 2 asks for. Silently doing nothing was worse: a
    // player cast Bless, lost the slot, and nothing whatsoever happened.
    report.needsRuling = spell.desc?.join("\n\n") ?? null;
  } else if (shape.kind === "heal" && healFormula) {
    const roll = rollDamage(healFormula);
    report.damageRoll = roll;
    for (const target of params.targets) {
      const patch = applyHealing(target.state, roll.total);
      await db.update(combatants).set(patch).where(eq(combatants.id, target.id));
      report.results.push({
        targetName: target.name,
        damage: 0,
        healed: roll.total,
        hpAfter: patch.hpCurrent ?? target.state.hpCurrent,
      });
    }
  }

  // Concentration replaces whatever the caster was already concentrating on.
  if (spell.concentration) {
    await db
      .update(combatants)
      .set({
        concentration: {
          spellIndex: spell.index,
          spellName: spell.name,
          level: report.slotLevel,
        },
      })
      .where(eq(combatants.id, caster.id));
    report.concentrating = true;
  }

  if (report.attackRoll || report.damageRoll) {
    await db.insert(rollsTable).values({
      campaignId: params.campaignId,
      encounterId: params.encounterId,
      actorType: "combatant",
      actorId: caster.id,
      actorName: caster.name,
      kind: report.attackRoll ? "attack" : "damage",
      formula: report.attackRoll?.formula ?? report.damageRoll?.formula ?? "",
      dice: report.attackRoll?.dice ?? report.damageRoll?.dice ?? [],
      modifier: report.attackRoll?.modifier ?? report.damageRoll?.modifier ?? 0,
      advantage: "normal",
      total: report.attackRoll?.total ?? report.damageRoll?.total ?? 0,
      targetName: params.targets[0]?.name ?? null,
      dc: shape.kind === "save" ? caster.spellSaveDc : null,
      outcome: spell.name,
    });
  }

  const bits = [`${caster.name} casts ${spell.name}`];
  if (!spent.cantrip) bits.push(`with a level ${report.slotLevel} slot`);
  if (report.needsRuling) bits.push("the DM rules on its effect");
  for (const result of report.results) {
    if (result.healed > 0) bits.push(`${result.targetName} regains ${result.healed} HP`);
    else if (result.damage > 0) bits.push(`${result.targetName} takes ${result.damage} damage`);
    else bits.push(`${result.targetName} is unharmed`);
  }
  report.narration = `${bits.join(", ")}.`;

  await appendEvent(params.campaignId, "combatant.updated", {
    encounterId: params.encounterId,
    combatantId: caster.id,
    name: caster.name,
    spell: spell.name,
    narration: report.narration,
  });

  return report;
}

/**
 * A concentrating caster who takes damage must hold it or lose the spell.
 * Called by the damage path rather than by casting itself.
 */
export function concentrationCheckDcFor(damage: number): number {
  return concentrationDc(damage);
}
