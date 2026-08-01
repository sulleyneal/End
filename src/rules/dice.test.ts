import { describe, expect, it } from "vitest";
import {
  formatModifier,
  resolveAdvantage,
  rollD20,
  rollDice,
  rollDie,
  rollExpression,
  type Rng,
} from "./dice";

/** Deterministic stand-in for `crypto.randomInt`, yielding the given faces in order. */
function stubRng(faces: number[]): Rng {
  let i = 0;
  return (min, max) => {
    const face = faces[i++];
    if (face === undefined) throw new Error("stub RNG exhausted");
    if (face < min || face >= max) {
      throw new Error(`stub face ${face} outside [${min}, ${max})`);
    }
    return face;
  };
}

describe("rollDie", () => {
  it("returns the stubbed face", () => {
    expect(rollDie(20, stubRng([13]))).toBe(13);
  });

  it("rejects nonsense die sizes", () => {
    expect(() => rollDie(0)).toThrow(RangeError);
    expect(() => rollDie(-6)).toThrow(RangeError);
    expect(() => rollDie(2.5)).toThrow(RangeError);
  });

  it("stays inside 1..sides using the real crypto RNG", () => {
    for (let i = 0; i < 500; i++) {
      const face = rollDie(20);
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(20);
      expect(Number.isInteger(face)).toBe(true);
    }
  });

  it("can produce both extremes of a d20", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rollDie(20));
    expect(seen.has(1)).toBe(true);
    expect(seen.has(20)).toBe(true);
    expect(seen.size).toBe(20);
  });
});

describe("rollDice", () => {
  it("rolls the requested count", () => {
    expect(rollDice(3, 6, stubRng([1, 4, 6]))).toEqual([1, 4, 6]);
  });

  it("allows zero dice", () => {
    expect(rollDice(0, 6)).toEqual([]);
  });

  it("rejects a negative count", () => {
    expect(() => rollDice(-1, 6)).toThrow(RangeError);
  });
});

describe("rollD20", () => {
  it("rolls once at normal", () => {
    const result = rollD20(5, "normal", stubRng([12]));
    expect(result.dice).toEqual([12]);
    expect(result.discarded).toEqual([]);
    expect(result.total).toBe(17);
    expect(result.formula).toBe("1d20+5");
  });

  it("keeps the higher face on advantage and records the dropped one", () => {
    const result = rollD20(3, "advantage", stubRng([7, 15]));
    expect(result.dice).toEqual([15]);
    expect(result.discarded).toEqual([7]);
    expect(result.total).toBe(18);
  });

  it("keeps the lower face on disadvantage", () => {
    const result = rollD20(3, "disadvantage", stubRng([7, 15]));
    expect(result.dice).toEqual([7]);
    expect(result.discarded).toEqual([15]);
    expect(result.total).toBe(10);
  });

  it("handles a negative modifier in the formula", () => {
    expect(rollD20(-2, "normal", stubRng([10])).formula).toBe("1d20-2");
    expect(rollD20(0, "normal", stubRng([10])).formula).toBe("1d20");
  });
});

describe("resolveAdvantage", () => {
  it("cancels advantage against disadvantage", () => {
    expect(resolveAdvantage(true, true)).toBe("normal");
    expect(resolveAdvantage(false, false)).toBe("normal");
  });

  it("returns the uncontested state", () => {
    expect(resolveAdvantage(true, false)).toBe("advantage");
    expect(resolveAdvantage(false, true)).toBe("disadvantage");
  });
});

describe("formatModifier", () => {
  it("signs the modifier and omits zero", () => {
    expect(formatModifier(3)).toBe("+3");
    expect(formatModifier(-3)).toBe("-3");
    expect(formatModifier(0)).toBe("");
  });
});

describe("rollExpression", () => {
  it("rolls NdX+M", () => {
    const result = rollExpression("2d6+3", stubRng([4, 5]));
    expect(result.dice).toEqual([4, 5]);
    expect(result.modifier).toBe(3);
    expect(result.total).toBe(12);
    expect(result.formula).toBe("2d6+3");
  });

  it("defaults an omitted count to one and handles subtraction", () => {
    const result = rollExpression("d8-1", stubRng([8]));
    expect(result.dice).toEqual([8]);
    expect(result.total).toBe(7);
    expect(result.formula).toBe("1d8-1");
  });

  it("tolerates whitespace", () => {
    expect(rollExpression(" 1d4 + 2 ", stubRng([3])).total).toBe(5);
  });

  it("rejects an unparseable expression", () => {
    expect(() => rollExpression("2d")).toThrow(SyntaxError);
    expect(() => rollExpression("fireball")).toThrow(SyntaxError);
  });
});
