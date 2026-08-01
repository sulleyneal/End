import { randomInt } from "node:crypto";

/**
 * Dice live here and nowhere else.
 *
 * Every die in the app is produced by this module, server-side, using
 * `crypto.randomInt`. The 3D dice tray in the browser is a *replay* of a roll
 * that already happened — it is handed the faces and animates toward them. No
 * client and no AI can produce a number that reaches game state.
 */

export type AdvantageState = "normal" | "advantage" | "disadvantage";

/** A single physical die. `kept` is false for the die discarded by (dis)advantage or a "keep highest" term. */
export type DieRoll = { sides: number; value: number; kept: boolean };

export type RollResult = {
  formula: string;
  dice: DieRoll[];
  modifier: number;
  total: number;
  advantage: AdvantageState;
  /** The natural face of the kept d20, when this was a d20 test. Crits key off this, never off the total. */
  natural?: number;
};

/** Injectable so tests can assert exact outcomes. Returns an integer in [1, sides]. */
export type Rng = (sides: number) => number;

export const cryptoRng: Rng = (sides) => {
  if (!Number.isInteger(sides) || sides < 1) {
    throw new Error(`Invalid die size: ${sides}`);
  }
  return randomInt(1, sides + 1);
};

/** A scripted RNG for tests: consumes the given faces in order, then throws. */
export function scriptedRng(faces: number[]): Rng {
  let i = 0;
  return () => {
    if (i >= faces.length) throw new Error("scriptedRng exhausted");
    return faces[i++];
  };
}

/* ------------------------------------------------------------------ *
 * Formula parsing
 * ------------------------------------------------------------------ */

export type DiceTerm =
  | { kind: "dice"; count: number; sides: number; keep?: { mode: "h" | "l"; count: number }; sign: 1 | -1 }
  | { kind: "flat"; value: number; sign: 1 | -1 };

const TERM = /([+-]?)\s*(?:(\d*)d(\d+)(?:k([hl])(\d+))?|(\d+))/gi;

/**
 * Parses dice notation: `2d6`, `1d8+3`, `4d6kh3`, `2d20kl1`, `1d10+1d6-2`.
 * Throws on anything it does not fully understand rather than guessing.
 */
export function parseFormula(formula: string): DiceTerm[] {
  const cleaned = formula.replace(/\s+/g, "");
  if (cleaned.length === 0) throw new Error("Empty dice formula");

  const terms: DiceTerm[] = [];
  let consumed = 0;
  TERM.lastIndex = 0;

  for (let m = TERM.exec(cleaned); m !== null; m = TERM.exec(cleaned)) {
    if (m.index !== consumed) break; // a gap means an unparsable character
    consumed = m.index + m[0].length;

    const sign: 1 | -1 = m[1] === "-" ? -1 : 1;
    if (m[6] !== undefined) {
      terms.push({ kind: "flat", value: Number(m[6]), sign });
      continue;
    }

    const count = m[2] === "" ? 1 : Number(m[2]);
    const sides = Number(m[3]);
    if (count < 1 || count > 100) throw new Error(`Unreasonable die count in "${formula}"`);
    if (sides < 1 || sides > 1000) throw new Error(`Unreasonable die size in "${formula}"`);

    const keep = m[4]
      ? { mode: m[4].toLowerCase() as "h" | "l", count: Number(m[5]) }
      : undefined;
    if (keep && (keep.count < 1 || keep.count > count)) {
      throw new Error(`Cannot keep ${keep.count} of ${count} dice in "${formula}"`);
    }

    terms.push({ kind: "dice", count, sides, keep, sign });
  }

  if (consumed !== cleaned.length || terms.length === 0) {
    throw new Error(`Could not parse dice formula: "${formula}"`);
  }
  return terms;
}

/** Rolls a parsed formula. Flat terms fold into `modifier`; dice are reported individually. */
export function rollFormula(formula: string, rng: Rng = cryptoRng): RollResult {
  const terms = parseFormula(formula);
  const dice: DieRoll[] = [];
  let modifier = 0;
  let total = 0;

  for (const term of terms) {
    if (term.kind === "flat") {
      modifier += term.sign * term.value;
      total += term.sign * term.value;
      continue;
    }

    const rolled: DieRoll[] = [];
    for (let i = 0; i < term.count; i++) {
      rolled.push({ sides: term.sides, value: rng(term.sides), kept: true });
    }

    if (term.keep) {
      const order = [...rolled].sort((a, b) =>
        term.keep!.mode === "h" ? b.value - a.value : a.value - b.value,
      );
      for (const die of order.slice(term.keep.count)) die.kept = false;
    }

    for (const die of rolled) if (die.kept) total += term.sign * die.value;
    dice.push(...rolled);
  }

  return { formula, dice, modifier, total, advantage: "normal" };
}

/* ------------------------------------------------------------------ *
 * d20 tests
 * ------------------------------------------------------------------ */

/**
 * The single d20 test used by attacks, saves, checks and initiative.
 *
 * Advantage and disadvantage cancel exactly — several sources of each still
 * produce one plain roll (PHB 173).
 */
export function rollD20(
  options: { modifier?: number; advantage?: AdvantageState } = {},
  rng: Rng = cryptoRng,
): RollResult {
  const modifier = options.modifier ?? 0;
  const advantage = options.advantage ?? "normal";
  const count = advantage === "normal" ? 1 : 2;

  const dice: DieRoll[] = [];
  for (let i = 0; i < count; i++) {
    dice.push({ sides: 20, value: rng(20), kept: true });
  }

  let natural = dice[0].value;
  if (count === 2) {
    const better =
      advantage === "advantage"
        ? Math.max(dice[0].value, dice[1].value)
        : Math.min(dice[0].value, dice[1].value);
    // Mark exactly one die as discarded, even when both show the same face.
    const discard = dice.findIndex((d) => d.value !== better);
    dice[discard === -1 ? 1 : discard].kept = false;
    natural = better;
  }

  return {
    formula: `1d20${modifier >= 0 ? "+" : ""}${modifier}`,
    dice,
    modifier,
    total: natural + modifier,
    advantage,
    natural,
  };
}

/**
 * Combines advantage sources. Any advantage plus any disadvantage is normal,
 * regardless of how many of each.
 */
export function combineAdvantage(
  sources: { advantage?: boolean; disadvantage?: boolean }[],
): AdvantageState {
  const adv = sources.some((s) => s.advantage);
  const dis = sources.some((s) => s.disadvantage);
  if (adv && dis) return "normal";
  if (adv) return "advantage";
  if (dis) return "disadvantage";
  return "normal";
}

/* ------------------------------------------------------------------ *
 * Damage
 * ------------------------------------------------------------------ */

/**
 * Rolls damage. On a critical hit the *dice* are doubled and the modifier is
 * not (PHB 196) — the extra dice are rolled rather than the result doubled.
 */
export function rollDamage(
  formula: string,
  options: { critical?: boolean; modifier?: number } = {},
  rng: Rng = cryptoRng,
): RollResult {
  const terms = parseFormula(formula);
  const effective = options.critical
    ? terms.map((t) => (t.kind === "dice" ? { ...t, count: t.count * 2 } : t))
    : terms;

  const dice: DieRoll[] = [];
  let modifier = options.modifier ?? 0;
  let total = modifier;

  for (const term of effective) {
    if (term.kind === "flat") {
      modifier += term.sign * term.value;
      total += term.sign * term.value;
      continue;
    }
    for (let i = 0; i < term.count; i++) {
      const die: DieRoll = { sides: term.sides, value: rng(term.sides), kept: true };
      dice.push(die);
      total += term.sign * die.value;
    }
  }

  // Damage is never negative, however the modifiers stack up (PHB 196).
  return {
    formula,
    dice,
    modifier,
    total: Math.max(0, total),
    advantage: "normal",
  };
}

/** Average of a formula, used for monster HP and for UI hints. Never for resolution. */
export function averageOf(formula: string): number {
  let total = 0;
  for (const term of parseFormula(formula)) {
    if (term.kind === "flat") {
      total += term.sign * term.value;
    } else {
      const kept = term.keep ? term.keep.count : term.count;
      total += term.sign * kept * ((term.sides + 1) / 2);
    }
  }
  return total;
}
