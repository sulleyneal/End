import { describe, expect, it } from "vitest";
import {
  SpellError,
  damageDiceFor,
  healingDiceFor,
  rangeFt,
  shapeOf,
  spellListFor,
  validateSlot,
} from "./spells";
import { srd, srdGet } from "@/srd/local";

/**
 * Expectations here are written from the PHB, not read back out of the same
 * documents the code consumes.
 */

describe("spell shape", () => {
  it("reads Fire Bolt as a ranged spell attack", () => {
    expect(shapeOf(srdGet.spell("fire-bolt"))).toEqual({ kind: "attack", attackType: "ranged" });
  });

  it("reads Sacred Flame as a Dex save for no damage on a success", () => {
    expect(shapeOf(srdGet.spell("sacred-flame"))).toEqual({
      kind: "save",
      ability: "dex",
      onSuccess: "none",
    });
  });

  it("reads Burning Hands as a Dex save for half", () => {
    expect(shapeOf(srdGet.spell("burning-hands"))).toEqual({
      kind: "save",
      ability: "dex",
      onSuccess: "half",
    });
  });

  it("reads Cure Wounds as healing", () => {
    expect(shapeOf(srdGet.spell("cure-wounds")).kind).toBe("heal");
  });
});

describe("ranges", () => {
  it("parses feet", () => {
    expect(rangeFt(srdGet.spell("fire-bolt"))).toBe(120);
    expect(rangeFt(srdGet.spell("sacred-flame"))).toBe(60);
  });

  it("treats touch as five feet and self as no range", () => {
    expect(rangeFt(srdGet.spell("cure-wounds"))).toBe(5);
    expect(rangeFt(srdGet.spell("burning-hands"))).toBeNull();
  });
});

describe("damage scaling", () => {
  it("scales a cantrip by character level, not slot level", () => {
    const fireBolt = srdGet.spell("fire-bolt");
    expect(damageDiceFor(fireBolt, { slotLevel: 0, characterLevel: 1 })).toBe("1d10");
    expect(damageDiceFor(fireBolt, { slotLevel: 0, characterLevel: 4 })).toBe("1d10");
    expect(damageDiceFor(fireBolt, { slotLevel: 0, characterLevel: 5 })).toBe("2d10");
    expect(damageDiceFor(fireBolt, { slotLevel: 0, characterLevel: 11 })).toBe("3d10");
    expect(damageDiceFor(fireBolt, { slotLevel: 0, characterLevel: 17 })).toBe("4d10");
  });

  it("scales a levelled spell by the slot spent", () => {
    const missile = srdGet.spell("magic-missile");
    expect(damageDiceFor(missile, { slotLevel: 1, characterLevel: 1 })).toBe("3d4 + 3");
    expect(damageDiceFor(missile, { slotLevel: 3, characterLevel: 1 })).toBe("5d4 + 5");
  });

  it("scales healing by the slot spent and folds in the caster's modifier", () => {
    // The SRD stores these as "1d8 + MOD"; a +3 Wisdom cleric heals 1d8 + 3.
    expect(healingDiceFor(srdGet.spell("cure-wounds"), 1, 3)).toBe("1d8 + 3");
    expect(healingDiceFor(srdGet.spell("cure-wounds"), 3, 3)).toBe("3d8 + 3");
    expect(healingDiceFor(srdGet.spell("cure-wounds"), 1, 0)).toBe("1d8 + 0");
    expect(healingDiceFor(srdGet.spell("cure-wounds"), 1, -1)).toBe("1d8 - 1");
  });
});

describe("slot validation", () => {
  const slots = [
    { level: 1, max: 2, used: 0 },
    { level: 2, max: 0, used: 0 },
  ];

  it("lets a cantrip through without a slot", () => {
    expect(validateSlot(srdGet.spell("fire-bolt"), 0, slots)).toEqual({ cantrip: true });
  });

  it("refuses to spend a slot on a cantrip", () => {
    expect(() => validateSlot(srdGet.spell("fire-bolt"), 1, slots)).toThrow(SpellError);
  });

  it("refuses a slot below the spell's level", () => {
    expect(() => validateSlot(srdGet.spell("magic-missile"), 0, slots)).toThrow(SpellError);
  });

  it("allows upcasting into a higher slot", () => {
    const roomy = [{ level: 3, max: 2, used: 0 }];
    expect(validateSlot(srdGet.spell("magic-missile"), 3, roomy)).toEqual({
      cantrip: false,
      slotLevel: 3,
    });
  });

  it("refuses a slot that is already spent", () => {
    const spent = [{ level: 1, max: 2, used: 2 }];
    expect(() => validateSlot(srdGet.spell("magic-missile"), 1, spent)).toThrow(
      /all spent/,
    );
  });

  it("refuses a slot level the caster does not have", () => {
    expect(() => validateSlot(srdGet.spell("magic-missile"), 9, slots)).toThrow(
      /no level 9 spell slots/,
    );
  });
});

describe("class spell lists", () => {
  it("gives a level-1 wizard cantrips and first-level spells only", () => {
    const list = spellListFor(srd.spells(), "wizard", 1);
    expect(list.length).toBeGreaterThan(20);
    expect(list.every((s) => s.level <= 1)).toBe(true);
    expect(list.some((s) => s.index === "magic-missile")).toBe(true);
    // Cure Wounds is a cleric/druid/bard/paladin/ranger spell, never a wizard's.
    expect(list.some((s) => s.index === "cure-wounds")).toBe(false);
  });

  it("gives a cleric their own list", () => {
    const list = spellListFor(srd.spells(), "cleric", 1);
    expect(list.some((s) => s.index === "cure-wounds")).toBe(true);
    expect(list.some((s) => s.index === "magic-missile")).toBe(false);
  });
});
