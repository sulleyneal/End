import { type Rng, cryptoRng, rollFormula } from "./dice";

/**
 * Short and long rests.
 *
 * Hit dice are spent one at a time and each is rolled, so the log shows the
 * player exactly what they got — a rest is not a silent heal.
 */

export type RestingCharacter = {
  level: number;
  hitDie: number;
  hitDiceRemaining: number;
  conModifier: number;
  hpCurrent: number;
  hpMax: number;
  tempHp: number;
  exhaustion: number;
  conditions: string[];
  spellSlots: { level: number; max: number; used: number }[];
};

export type ShortRestResult = {
  diceSpent: number;
  rolls: { die: number; rolled: number; healed: number }[];
  hpHealed: number;
  patch: {
    hpCurrent: number;
    hitDiceRemaining: number;
  };
};

/**
 * Spends up to `diceToSpend` hit dice. Each die heals its roll plus the
 * character's Constitution modifier, never less than 0, and stops early once
 * the character is at full HP.
 */
export function takeShortRest(
  character: RestingCharacter,
  diceToSpend: number,
  rng: Rng = cryptoRng,
): ShortRestResult {
  const available = Math.min(diceToSpend, character.hitDiceRemaining);
  const rolls: ShortRestResult["rolls"] = [];

  let hp = character.hpCurrent;
  let spent = 0;

  for (let i = 0; i < available; i++) {
    if (hp >= character.hpMax) break;
    const roll = rollFormula(`1d${character.hitDie}`, rng);
    const healed = Math.max(0, roll.total + character.conModifier);
    hp = Math.min(character.hpMax, hp + healed);
    rolls.push({ die: character.hitDie, rolled: roll.total, healed });
    spent += 1;
  }

  return {
    diceSpent: spent,
    rolls,
    hpHealed: hp - character.hpCurrent,
    patch: {
      hpCurrent: hp,
      hitDiceRemaining: character.hitDiceRemaining - spent,
    },
  };
}

export type LongRestResult = {
  hitDiceRegained: number;
  patch: {
    hpCurrent: number;
    tempHp: number;
    hitDiceRemaining: number;
    exhaustion: number;
    conditions: string[];
    deathSuccesses: number;
    deathFailures: number;
    stable: boolean;
  };
  spellSlots: { level: number; max: number; used: number }[];
};

/**
 * A long rest restores all hit points and spell slots, returns half the
 * character's total hit dice (minimum one), and removes one level of
 * exhaustion (PHB 186).
 */
export function takeLongRest(character: RestingCharacter): LongRestResult {
  const regained = Math.max(1, Math.floor(character.level / 2));
  const hitDiceRemaining = Math.min(character.level, character.hitDiceRemaining + regained);

  return {
    hitDiceRegained: hitDiceRemaining - character.hitDiceRemaining,
    patch: {
      hpCurrent: character.hpMax,
      tempHp: 0,
      hitDiceRemaining,
      exhaustion: Math.max(0, character.exhaustion - 1),
      conditions: character.conditions.filter((c) => c !== "unconscious"),
      deathSuccesses: 0,
      deathFailures: 0,
      stable: false,
    },
    spellSlots: character.spellSlots.map((slot) => ({ ...slot, used: 0 })),
  };
}
