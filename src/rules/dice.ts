/**
 * Dice. House rule 3: every roll happens here, on the server, with
 * `crypto.randomInt`, and the individual faces are kept so any total can be
 * audited later. The 3D dice widget replays these results; it never makes them.
 */
import { randomInt } from "node:crypto";

export type AdvantageState = "normal" | "advantage" | "disadvantage";

export interface RollResult {
  /** Faces that counted toward the total. */
  dice: number[];
  /** Faces rolled but dropped by advantage/disadvantage, kept for the audit trail. */
  discarded: number[];
  modifier: number;
  total: number;
  formula: string;
  advantage: AdvantageState;
}

/** A single die. `sides` must be positive; the RNG is uniform over 1..sides. */
export function rollDie(sides: number, rng: Rng = randomInt): number {
  if (!Number.isInteger(sides) || sides < 1) {
    throw new RangeError(`Invalid die size: ${sides}`);
  }
  return rng(1, sides + 1);
}

/** Signature of `crypto.randomInt(min, max)` — max exclusive. Tests inject a stub. */
export type Rng = (min: number, max: number) => number;

export function rollDice(count: number, sides: number, rng: Rng = randomInt): number[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`Invalid die count: ${count}`);
  }
  return Array.from({ length: count }, () => rollDie(sides, rng));
}

/**
 * A d20 roll, the spine of the whole engine. Advantage and disadvantage each
 * roll twice and keep the better or worse face; both faces are recorded.
 */
export function rollD20(
  modifier = 0,
  advantage: AdvantageState = "normal",
  rng: Rng = randomInt,
): RollResult {
  const faces = advantage === "normal" ? rollDice(1, 20, rng) : rollDice(2, 20, rng);

  let kept: number;
  let discarded: number[];
  if (advantage === "advantage") {
    kept = Math.max(faces[0], faces[1]);
    discarded = [Math.min(faces[0], faces[1])];
  } else if (advantage === "disadvantage") {
    kept = Math.min(faces[0], faces[1]);
    discarded = [Math.max(faces[0], faces[1])];
  } else {
    kept = faces[0];
    discarded = [];
  }

  return {
    dice: [kept],
    discarded,
    modifier,
    total: kept + modifier,
    formula: `1d20${formatModifier(modifier)}`,
    advantage,
  };
}

export function formatModifier(modifier: number): string {
  if (modifier === 0) return "";
  return modifier > 0 ? `+${modifier}` : `${modifier}`;
}

/**
 * Combine advantage sources. Any advantage plus any disadvantage cancels to a
 * flat roll no matter how many of each there are (PHB), and that is the whole
 * rule — there is no "two advantages beats one disadvantage".
 */
export function resolveAdvantage(
  hasAdvantage: boolean,
  hasDisadvantage: boolean,
): AdvantageState {
  if (hasAdvantage === hasDisadvantage) return "normal";
  return hasAdvantage ? "advantage" : "disadvantage";
}

const DICE_EXPRESSION = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i;

/** Parse and roll an expression like `2d6+3`. Used for damage and hit dice. */
export function rollExpression(expression: string, rng: Rng = randomInt): RollResult {
  const match = DICE_EXPRESSION.exec(expression);
  if (!match) throw new SyntaxError(`Unparseable dice expression: ${expression}`);

  const count = match[1] === "" ? 1 : Number(match[1]);
  const sides = Number(match[2]);
  const modifier =
    match[4] === undefined ? 0 : Number(match[4]) * (match[3] === "-" ? -1 : 1);

  const dice = rollDice(count, sides, rng);
  const total = dice.reduce((sum, face) => sum + face, 0) + modifier;

  return {
    dice,
    discarded: [],
    modifier,
    total,
    formula: `${count}d${sides}${formatModifier(modifier)}`,
    advantage: "normal",
  };
}
