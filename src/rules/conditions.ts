import type { AbilityKey } from "@/srd/types";

/**
 * The mechanical half of the 15 SRD conditions plus exhaustion.
 *
 * The SRD text lives in the database for display; this table is what the
 * engine actually consults. Keeping them separate means prose edits can never
 * change the maths.
 */

export const CONDITIONS = [
  "blinded",
  "charmed",
  "deafened",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralyzed",
  "petrified",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious",
  "exhaustion",
] as const;

export type ConditionKey = (typeof CONDITIONS)[number];

export function isCondition(value: string): value is ConditionKey {
  return (CONDITIONS as readonly string[]).includes(value);
}

type ConditionEffect = {
  /** Conditions this one automatically imposes. */
  implies?: ConditionKey[];
  /** Speed becomes 0. */
  speedZero?: boolean;
  /** Cannot take actions, bonus actions, or reactions. */
  incapacitated?: boolean;
  /** This creature's own attack rolls have disadvantage. */
  attacksHaveDisadvantage?: boolean;
  /** This creature's own attack rolls have advantage. */
  attacksHaveAdvantage?: boolean;
  /** Attack rolls against this creature have advantage. */
  attackedWithAdvantage?: boolean;
  /** Attack rolls against this creature have disadvantage. */
  attackedWithDisadvantage?: boolean;
  /** Ability checks made by this creature have disadvantage. */
  checksHaveDisadvantage?: boolean;
  /** Saving throws of these abilities automatically fail. */
  autoFailSaves?: AbilityKey[];
  /** Saving throws of these abilities have disadvantage. */
  saveDisadvantage?: AbilityKey[];
  /** A melee attack from within 5 ft that hits is a critical hit. */
  meleeHitsAreCrits?: boolean;
  /** Resistance to all damage. */
  resistAllDamage?: boolean;
};

const EFFECTS: Record<ConditionKey, ConditionEffect> = {
  blinded: {
    attacksHaveDisadvantage: true,
    attackedWithAdvantage: true,
  },
  charmed: {},
  deafened: {},
  frightened: {
    attacksHaveDisadvantage: true,
    checksHaveDisadvantage: true,
  },
  grappled: { speedZero: true },
  incapacitated: { incapacitated: true },
  invisible: {
    attacksHaveAdvantage: true,
    attackedWithDisadvantage: true,
  },
  paralyzed: {
    implies: ["incapacitated"],
    speedZero: true,
    autoFailSaves: ["str", "dex"],
    attackedWithAdvantage: true,
    meleeHitsAreCrits: true,
  },
  petrified: {
    implies: ["incapacitated"],
    speedZero: true,
    autoFailSaves: ["str", "dex"],
    attackedWithAdvantage: true,
    resistAllDamage: true,
  },
  poisoned: {
    attacksHaveDisadvantage: true,
    checksHaveDisadvantage: true,
  },
  // Prone is direction-dependent — see attackModifiersAgainst, which needs the range.
  prone: { attacksHaveDisadvantage: true },
  restrained: {
    speedZero: true,
    attacksHaveDisadvantage: true,
    attackedWithAdvantage: true,
    saveDisadvantage: ["dex"],
  },
  stunned: {
    implies: ["incapacitated"],
    speedZero: true,
    autoFailSaves: ["str", "dex"],
    attackedWithAdvantage: true,
  },
  unconscious: {
    implies: ["incapacitated", "prone"],
    speedZero: true,
    autoFailSaves: ["str", "dex"],
    attackedWithAdvantage: true,
    meleeHitsAreCrits: true,
  },
  exhaustion: {},
};

/** Expands conditions that imply others (unconscious ⇒ incapacitated + prone). */
export function expandConditions(conditions: string[]): ConditionKey[] {
  const out = new Set<ConditionKey>();
  const visit = (c: ConditionKey) => {
    if (out.has(c)) return;
    out.add(c);
    for (const implied of EFFECTS[c].implies ?? []) visit(implied);
  };
  for (const c of conditions) if (isCondition(c)) visit(c);
  return [...out];
}

export type CreatureState = {
  conditions: string[];
  exhaustion: number;
};

function effectsOf(state: CreatureState): ConditionEffect[] {
  return expandConditions(state.conditions).map((c) => EFFECTS[c]);
}

/* ------------------------------------------------------------------ *
 * Exhaustion (DMG/PHB appendix A)
 * ------------------------------------------------------------------ */

export const EXHAUSTION_MAX = 6;

export function exhaustionEffects(level: number) {
  const l = Math.max(0, Math.min(EXHAUSTION_MAX, level));
  return {
    checksHaveDisadvantage: l >= 1,
    speedHalved: l >= 2,
    attacksAndSavesHaveDisadvantage: l >= 3,
    hpMaxHalved: l >= 4,
    speedZero: l >= 5,
    dead: l >= 6,
  };
}

/* ------------------------------------------------------------------ *
 * Queries the engine actually calls
 * ------------------------------------------------------------------ */

export function canTakeActions(state: CreatureState): boolean {
  return !effectsOf(state).some((e) => e.incapacitated);
}

export function canTakeReactions(state: CreatureState): boolean {
  return canTakeActions(state);
}

/** Speed after conditions and exhaustion, floored at 0. */
export function effectiveSpeed(baseSpeed: number, state: CreatureState): number {
  const ex = exhaustionEffects(state.exhaustion);
  if (ex.speedZero) return 0;
  if (effectsOf(state).some((e) => e.speedZero)) return 0;
  return ex.speedHalved ? Math.floor(baseSpeed / 2) : baseSpeed;
}

export function maxHpAfterExhaustion(hpMax: number, exhaustion: number): number {
  return exhaustionEffects(exhaustion).hpMaxHalved ? Math.floor(hpMax / 2) : hpMax;
}

/** Advantage/disadvantage contributed by the *attacker's* own state. */
export function attackModifiersFor(state: CreatureState) {
  const effects = effectsOf(state);
  const ex = exhaustionEffects(state.exhaustion);
  return {
    advantage: effects.some((e) => e.attacksHaveAdvantage),
    disadvantage:
      effects.some((e) => e.attacksHaveDisadvantage) || ex.attacksAndSavesHaveDisadvantage,
  };
}

/**
 * Advantage/disadvantage contributed by the *target's* state.
 *
 * `rangeFt` matters: attacking a prone creature has advantage in melee and
 * disadvantage at range, and paralysis only turns hits into crits within 5 ft.
 */
export function attackModifiersAgainst(state: CreatureState, rangeFt: number) {
  const conditions = expandConditions(state.conditions);
  const effects = conditions.map((c) => EFFECTS[c]);

  let advantage = effects.some((e) => e.attackedWithAdvantage);
  let disadvantage = effects.some((e) => e.attackedWithDisadvantage);

  if (conditions.includes("prone")) {
    if (rangeFt <= 5) advantage = true;
    else disadvantage = true;
  }

  return { advantage, disadvantage };
}

/** True when a hit on this target is automatically a critical (paralyzed/unconscious in melee). */
export function hitIsAutomaticCrit(state: CreatureState, rangeFt: number): boolean {
  if (rangeFt > 5) return false;
  return effectsOf(state).some((e) => e.meleeHitsAreCrits);
}

export function savingThrowModifiers(state: CreatureState, ability: AbilityKey) {
  const effects = effectsOf(state);
  const ex = exhaustionEffects(state.exhaustion);
  const autoFail = effects.some((e) => e.autoFailSaves?.includes(ability));
  return {
    autoFail,
    advantage: false,
    disadvantage:
      ex.attacksAndSavesHaveDisadvantage ||
      effects.some((e) => e.saveDisadvantage?.includes(ability)),
  };
}

export function abilityCheckModifiers(state: CreatureState) {
  const effects = effectsOf(state);
  const ex = exhaustionEffects(state.exhaustion);
  return {
    advantage: false,
    disadvantage:
      effects.some((e) => e.checksHaveDisadvantage) || ex.checksHaveDisadvantage,
  };
}

export function resistsAllDamage(state: CreatureState): boolean {
  return effectsOf(state).some((e) => e.resistAllDamage);
}
