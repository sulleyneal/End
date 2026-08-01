import type { AbilityKey } from "@/srd/types";
import {
  type AdvantageState,
  type Rng,
  type RollResult,
  combineAdvantage,
  cryptoRng,
  rollD20,
  rollDamage,
} from "./dice";
import {
  attackModifiersAgainst,
  attackModifiersFor,
  hitIsAutomaticCrit,
  resistsAllDamage,
  savingThrowModifiers,
} from "./conditions";

/**
 * Combat resolution. Everything here is a pure function over explicit state:
 * it takes a combatant snapshot and returns the *patch* to apply, never
 * mutating its inputs. That makes each rule independently testable and means a
 * caller cannot accidentally half-apply an outcome.
 */

export type CombatantState = {
  name: string;
  hpCurrent: number;
  hpMax: number;
  tempHp: number;
  ac: number;
  conditions: string[];
  exhaustion: number;
  deathSuccesses: number;
  deathFailures: number;
  stable: boolean;
  defeated: boolean;
  concentration?: { spellIndex: string; spellName: string; level: number } | null;
  /** Damage type indexes, e.g. "fire", "bludgeoning". */
  resistances?: string[];
  immunities?: string[];
  vulnerabilities?: string[];
  /** Player characters go to 0 HP and make death saves; monsters simply drop. */
  isPlayerCharacter?: boolean;
};

/* ------------------------------------------------------------------ *
 * Attack rolls
 * ------------------------------------------------------------------ */

export type AttackOutcome = {
  roll: RollResult;
  natural: number;
  hit: boolean;
  critical: boolean;
  /** A natural 1 always misses, whatever the bonus (PHB 194). */
  fumble: boolean;
  targetAc: number;
  advantage: AdvantageState;
};

export function resolveAttack(
  params: {
    attackBonus: number;
    attacker: Pick<CombatantState, "conditions" | "exhaustion">;
    target: Pick<CombatantState, "conditions" | "exhaustion" | "ac">;
    rangeFt: number;
    /** Extra situational advantage, e.g. from a spell or the DM's ruling. */
    situational?: { advantage?: boolean; disadvantage?: boolean };
    /** Champion fighters crit on 19-20; default 20. */
    critRange?: number;
  },
  rng: Rng = cryptoRng,
): AttackOutcome {
  const critRange = params.critRange ?? 20;
  const advantage = combineAdvantage([
    attackModifiersFor(params.attacker),
    attackModifiersAgainst(params.target, params.rangeFt),
    params.situational ?? {},
  ]);

  const roll = rollD20({ modifier: params.attackBonus, advantage }, rng);
  const natural = roll.natural!;

  const fumble = natural === 1;
  const naturalCrit = natural >= critRange;
  const autoCrit = hitIsAutomaticCrit(params.target, params.rangeFt);

  // A natural 20 always hits; a natural 1 always misses.
  const hit = !fumble && (naturalCrit || roll.total >= params.target.ac);
  const critical = hit && (naturalCrit || autoCrit);

  return {
    roll,
    natural,
    hit,
    critical,
    fumble,
    targetAc: params.target.ac,
    advantage,
  };
}

/* ------------------------------------------------------------------ *
 * Damage
 * ------------------------------------------------------------------ */

export type DamagePacket = { amount: number; type: string };

/** Applies resistance, vulnerability and immunity in the PHB order: vulnerability doubles, then resistance halves (rounding down). */
export function adjustDamageForDefenses(
  packet: DamagePacket,
  target: Pick<
    CombatantState,
    "resistances" | "immunities" | "vulnerabilities" | "conditions" | "exhaustion"
  >,
): number {
  const type = packet.type.toLowerCase();
  const has = (list: string[] | undefined) =>
    (list ?? []).some((entry) => entry.toLowerCase().includes(type));

  if (has(target.immunities)) return 0;

  let amount = packet.amount;
  if (has(target.vulnerabilities)) amount *= 2;
  if (has(target.resistances) || resistsAllDamage(target)) amount = Math.floor(amount / 2);
  return Math.max(0, amount);
}

export type DamageResult = {
  /** Damage after defenses, before temp HP. */
  adjusted: number;
  absorbedByTempHp: number;
  appliedToHp: number;
  patch: Partial<CombatantState>;
  /** Dropped to 0 HP this hit. */
  droppedToZero: boolean;
  /** Massive damage: the leftover met or exceeded max HP (PHB 197). */
  instantDeath: boolean;
  /** Concentration check the target must now make, if any. */
  concentrationCheckDc: number | null;
  deathSaveFailuresAdded: number;
};

/**
 * Applies a damage packet. Temp HP absorbs first and is not restored.
 *
 * Damage taken at 0 HP costs a death save failure — two if the hit was a
 * critical (PHB 197).
 */
export function applyDamage(
  target: CombatantState,
  packet: DamagePacket,
  options: { critical?: boolean } = {},
): DamageResult {
  const adjusted = adjustDamageForDefenses(packet, target);

  const patch: Partial<CombatantState> = {};
  let deathSaveFailuresAdded = 0;

  // Damage while already at 0 HP: no HP to lose, only death saves.
  if (target.isPlayerCharacter && target.hpCurrent === 0 && !target.defeated) {
    deathSaveFailuresAdded = options.critical ? 2 : 1;
    const failures = Math.min(3, target.deathFailures + deathSaveFailuresAdded);
    patch.deathFailures = failures;
    patch.stable = false;
    if (failures >= 3) patch.defeated = true;
    return {
      adjusted,
      absorbedByTempHp: 0,
      appliedToHp: 0,
      patch,
      droppedToZero: false,
      instantDeath: false,
      concentrationCheckDc: adjusted > 0 ? concentrationDc(adjusted) : null,
      deathSaveFailuresAdded,
    };
  }

  const absorbedByTempHp = Math.min(target.tempHp, adjusted);
  const appliedToHp = adjusted - absorbedByTempHp;
  const rawHp = target.hpCurrent - appliedToHp;

  patch.tempHp = target.tempHp - absorbedByTempHp;
  patch.hpCurrent = Math.max(0, rawHp);

  const droppedToZero = target.hpCurrent > 0 && patch.hpCurrent === 0;
  // Leftover damage past 0 killing outright.
  const overkill = rawHp < 0 ? -rawHp : 0;
  const instantDeath = droppedToZero && overkill >= target.hpMax;

  if (droppedToZero) {
    patch.deathSuccesses = 0;
    patch.deathFailures = 0;
    patch.stable = false;
    patch.concentration = null;
    if (instantDeath || !target.isPlayerCharacter) {
      patch.defeated = true;
    }
  }

  return {
    adjusted,
    absorbedByTempHp,
    appliedToHp,
    patch,
    droppedToZero,
    instantDeath,
    concentrationCheckDc:
      adjusted > 0 && target.concentration && !droppedToZero ? concentrationDc(adjusted) : null,
    deathSaveFailuresAdded,
  };
}

/** Healing. A creature at 0 HP wakes with the healed amount and its death saves cleared. */
export function applyHealing(target: CombatantState, amount: number): Partial<CombatantState> {
  if (target.defeated) return {};
  const healed = Math.min(target.hpMax, target.hpCurrent + Math.max(0, amount));
  const patch: Partial<CombatantState> = { hpCurrent: healed };
  if (target.hpCurrent === 0 && healed > 0) {
    patch.deathSuccesses = 0;
    patch.deathFailures = 0;
    patch.stable = false;
    patch.conditions = target.conditions.filter((c) => c !== "unconscious");
  }
  return patch;
}

/** Temporary hit points never stack — the higher pool wins (PHB 198). */
export function applyTempHp(target: CombatantState, amount: number): Partial<CombatantState> {
  return amount > target.tempHp ? { tempHp: amount } : {};
}

/* ------------------------------------------------------------------ *
 * Saving throws and concentration
 * ------------------------------------------------------------------ */

export type SaveOutcome = {
  roll: RollResult | null;
  total: number;
  success: boolean;
  dc: number;
  autoFailed: boolean;
  advantage: AdvantageState;
};

export function resolveSave(
  params: {
    ability: AbilityKey;
    modifier: number;
    dc: number;
    creature: Pick<CombatantState, "conditions" | "exhaustion">;
    situational?: { advantage?: boolean; disadvantage?: boolean };
  },
  rng: Rng = cryptoRng,
): SaveOutcome {
  const mods = savingThrowModifiers(params.creature, params.ability);

  if (mods.autoFail) {
    return {
      roll: null,
      total: 0,
      success: false,
      dc: params.dc,
      autoFailed: true,
      advantage: "normal",
    };
  }

  const advantage = combineAdvantage([mods, params.situational ?? {}]);
  const roll = rollD20({ modifier: params.modifier, advantage }, rng);
  return {
    roll,
    total: roll.total,
    success: roll.total >= params.dc,
    dc: params.dc,
    autoFailed: false,
    advantage,
  };
}

/** DC 10, or half the damage taken, whichever is higher (PHB 203). */
export function concentrationDc(damage: number): number {
  return Math.max(10, Math.floor(damage / 2));
}

/* ------------------------------------------------------------------ *
 * Death saving throws
 * ------------------------------------------------------------------ */

export type DeathSaveOutcome = {
  roll: RollResult;
  natural: number;
  result: "success" | "failure" | "critical-success" | "critical-failure";
  patch: Partial<CombatantState>;
  /** Three successes: stable but still at 0 HP. */
  stabilized: boolean;
  /** A natural 20 restores 1 HP and ends unconsciousness. */
  revived: boolean;
  dead: boolean;
};

/**
 * A death save is a flat d20 against DC 10 with no modifiers.
 * Natural 20 revives at 1 HP; natural 1 counts as two failures (PHB 197).
 */
export function rollDeathSave(target: CombatantState, rng: Rng = cryptoRng): DeathSaveOutcome {
  const roll = rollD20({ modifier: 0 }, rng);
  const natural = roll.natural!;

  let successes = target.deathSuccesses;
  let failures = target.deathFailures;
  let result: DeathSaveOutcome["result"];

  if (natural === 20) {
    result = "critical-success";
  } else if (natural === 1) {
    result = "critical-failure";
    failures += 2;
  } else if (natural >= 10) {
    result = "success";
    successes += 1;
  } else {
    result = "failure";
    failures += 1;
  }

  failures = Math.min(3, failures);
  successes = Math.min(3, successes);

  const revived = result === "critical-success";
  const dead = failures >= 3;
  const stabilized = !revived && !dead && successes >= 3;

  const patch: Partial<CombatantState> = revived
    ? {
        hpCurrent: 1,
        deathSuccesses: 0,
        deathFailures: 0,
        stable: false,
        conditions: target.conditions.filter((c) => c !== "unconscious"),
      }
    : {
        deathSuccesses: successes,
        deathFailures: failures,
        stable: stabilized,
        defeated: dead,
      };

  return { roll, natural, result, patch, stabilized, revived, dead };
}

/* ------------------------------------------------------------------ *
 * Initiative
 * ------------------------------------------------------------------ */

export type InitiativeEntry = {
  id: string;
  name: string;
  initiative: number;
  /** Dex score; higher acts first on a tie (PHB 189 suggests the DM decides — we use Dex, then name, so ordering is deterministic). */
  tiebreak: number;
};

export function sortInitiative<T extends InitiativeEntry>(entries: T[]): T[] {
  return [...entries].sort(
    (a, b) =>
      b.initiative - a.initiative ||
      b.tiebreak - a.tiebreak ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

export function rollInitiative(
  params: {
    modifier: number;
    creature: Pick<CombatantState, "conditions" | "exhaustion">;
    situational?: { advantage?: boolean; disadvantage?: boolean };
  },
  rng: Rng = cryptoRng,
): RollResult {
  // Initiative is a Dexterity check, so it inherits check-level disadvantage.
  const advantage = combineAdvantage([params.situational ?? {}]);
  return rollD20({ modifier: params.modifier, advantage }, rng);
}

/* ------------------------------------------------------------------ *
 * Weapon damage helper
 * ------------------------------------------------------------------ */

export function rollWeaponDamage(
  attack: { damageDice: string; damageBonus: number; damageType: string },
  options: { critical?: boolean; extraDice?: string } = {},
  rng: Rng = cryptoRng,
): { roll: RollResult; packet: DamagePacket } {
  const formula = options.extraDice
    ? `${attack.damageDice}+${options.extraDice}`
    : attack.damageDice;
  const roll = rollDamage(
    formula,
    { critical: options.critical, modifier: attack.damageBonus },
    rng,
  );
  return { roll, packet: { amount: roll.total, type: attack.damageType } };
}
