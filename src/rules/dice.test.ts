import { describe, expect, it } from "vitest";
import {
  averageOf,
  combineAdvantage,
  cryptoRng,
  parseFormula,
  rollD20,
  rollDamage,
  rollFormula,
  scriptedRng,
} from "./dice";

describe("parseFormula", () => {
  it("parses plain dice", () => {
    expect(parseFormula("2d6")).toEqual([{ kind: "dice", count: 2, sides: 6, keep: undefined, sign: 1 }]);
  });

  it("defaults an omitted count to one", () => {
    expect(parseFormula("d20")[0]).toMatchObject({ count: 1, sides: 20 });
  });

  it("parses modifiers and multiple dice terms", () => {
    expect(parseFormula("1d8+1d6-2")).toEqual([
      { kind: "dice", count: 1, sides: 8, keep: undefined, sign: 1 },
      { kind: "dice", count: 1, sides: 6, keep: undefined, sign: 1 },
      { kind: "flat", value: 2, sign: -1 },
    ]);
  });

  it("parses keep-highest notation", () => {
    expect(parseFormula("4d6kh3")[0]).toMatchObject({ count: 4, sides: 6, keep: { mode: "h", count: 3 } });
  });

  it.each(["", "hello", "2d", "d", "2d6+", "1d6 orc", "2d6kh5"])(
    "rejects %o rather than guessing",
    (bad) => {
      expect(() => parseFormula(bad)).toThrow();
    },
  );
});

describe("rollFormula", () => {
  it("sums dice and modifiers", () => {
    const result = rollFormula("2d6+3", scriptedRng([4, 5]));
    expect(result.total).toBe(12);
    expect(result.modifier).toBe(3);
    expect(result.dice.map((d) => d.value)).toEqual([4, 5]);
  });

  it("discards the lowest dice on keep-highest and excludes them from the total", () => {
    const result = rollFormula("4d6kh3", scriptedRng([1, 6, 3, 5]));
    expect(result.total).toBe(14); // 6 + 5 + 3, the 1 is dropped
    expect(result.dice.filter((d) => !d.kept).map((d) => d.value)).toEqual([1]);
    expect(result.dice).toHaveLength(4); // every die is still reported
  });

  it("subtracts negative dice terms", () => {
    expect(rollFormula("1d6-1d4", scriptedRng([6, 2])).total).toBe(4);
  });
});

describe("rollD20", () => {
  it("rolls a single die at normal advantage", () => {
    const result = rollD20({ modifier: 5 }, scriptedRng([12]));
    expect(result.dice).toHaveLength(1);
    expect(result.natural).toBe(12);
    expect(result.total).toBe(17);
  });

  it("keeps the higher die with advantage", () => {
    const result = rollD20({ modifier: 0, advantage: "advantage" }, scriptedRng([7, 18]));
    expect(result.natural).toBe(18);
    expect(result.dice.find((d) => !d.kept)?.value).toBe(7);
  });

  it("keeps the lower die with disadvantage", () => {
    const result = rollD20({ modifier: 0, advantage: "disadvantage" }, scriptedRng([7, 18]));
    expect(result.natural).toBe(7);
    expect(result.dice.find((d) => !d.kept)?.value).toBe(18);
  });

  it("discards exactly one die when both faces match", () => {
    const result = rollD20({ advantage: "advantage" }, scriptedRng([11, 11]));
    expect(result.dice.filter((d) => d.kept)).toHaveLength(1);
    expect(result.natural).toBe(11);
  });
});

describe("combineAdvantage", () => {
  it("cancels advantage against disadvantage", () => {
    expect(combineAdvantage([{ advantage: true }, { disadvantage: true }])).toBe("normal");
  });

  it("does not stack multiple sources of the same kind", () => {
    expect(combineAdvantage([{ advantage: true }, { advantage: true }])).toBe("advantage");
    expect(
      combineAdvantage([{ advantage: true }, { advantage: true }, { disadvantage: true }]),
    ).toBe("normal");
  });

  it("is normal with no sources", () => {
    expect(combineAdvantage([])).toBe("normal");
  });
});

describe("rollDamage", () => {
  it("adds the modifier once", () => {
    const result = rollDamage("1d8", { modifier: 3 }, scriptedRng([5]));
    expect(result.total).toBe(8);
  });

  it("doubles the dice but not the modifier on a critical hit", () => {
    const result = rollDamage("2d6", { critical: true, modifier: 4 }, scriptedRng([3, 3, 3, 3]));
    expect(result.dice).toHaveLength(4);
    expect(result.total).toBe(16); // 12 from dice + 4, not 4 doubled
  });

  it("never returns negative damage", () => {
    expect(rollDamage("1d4", { modifier: -10 }, scriptedRng([1])).total).toBe(0);
  });
});

describe("averageOf", () => {
  it.each([
    ["1d8", 4.5],
    ["2d6", 7],
    ["1d10+5", 10.5],
    ["18d10", 99],
  ])("averages %s as %d", (formula, expected) => {
    expect(averageOf(formula)).toBeCloseTo(expected);
  });
});

describe("cryptoRng", () => {
  it("stays within bounds across many rolls", () => {
    for (let i = 0; i < 2000; i++) {
      const value = cryptoRng(20);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(20);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("eventually produces every face of a d20", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) seen.add(cryptoRng(20));
    expect(seen.size).toBe(20);
  });

  it("rejects nonsense die sizes", () => {
    expect(() => cryptoRng(0)).toThrow();
    expect(() => cryptoRng(2.5)).toThrow();
  });
});
