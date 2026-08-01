import { describe, expect, it } from "vitest";
import { equipmentChoicesFor, resolveStartingEquipment } from "./equipment";
import { srd, srdGet } from "@/srd/local";

const categories = srd.equipmentCategories();
const fighter = srdGet.class("fighter");

/** Answers every block of a class with its first option, picking the first legal sub-choice. */
function firstLegalSelections(classIndex: string) {
  const classDoc = srdGet.class(classIndex);
  return equipmentChoicesFor(classDoc, categories).map((block) => ({
    block: block.block,
    option: 0,
    picks: block.options[0].picks.map((pick) => pick.from[0]),
  }));
}

describe("resolveStartingEquipment", () => {
  it("expands a simple branch into its item", () => {
    // Fighter block 0 option (a) is chain mail.
    const items = resolveStartingEquipment(
      fighter,
      [
        { block: 0, option: 0 },
        { block: 1, option: 0, picks: ["longsword"] },
        { block: 2, option: 0 },
        { block: 3, option: 0 },
      ],
      categories,
    );
    expect(items.find((i) => i.itemIndex === "chain-mail")).toEqual({
      itemIndex: "chain-mail",
      quantity: 1,
    });
  });

  it("expands a bundle branch into all of its items with quantities", () => {
    // Fighter block 0 option (b) is leather armour, a longbow and 20 arrows.
    const items = resolveStartingEquipment(
      fighter,
      [
        { block: 0, option: 1 },
        { block: 1, option: 0, picks: ["longsword"] },
        { block: 2, option: 0 },
        { block: 3, option: 0 },
      ],
      categories,
    );
    expect(items).toContainEqual({ itemIndex: "leather-armor", quantity: 1 });
    expect(items).toContainEqual({ itemIndex: "longbow", quantity: 1 });
    expect(items).toContainEqual({ itemIndex: "arrow", quantity: 20 });
  });

  it("accepts a weapon drawn from an equipment category", () => {
    const items = resolveStartingEquipment(
      fighter,
      [
        { block: 0, option: 0 },
        { block: 1, option: 0, picks: ["greataxe"] },
        { block: 2, option: 0 },
        { block: 3, option: 0 },
      ],
      categories,
    );
    expect(items).toContainEqual({ itemIndex: "greataxe", quantity: 1 });
  });

  it("rejects an item that is not in the offered category", () => {
    expect(() =>
      resolveStartingEquipment(
        fighter,
        [
          { block: 0, option: 0 },
          // Plate armour is not a martial weapon.
          { block: 1, option: 0, picks: ["plate-armor"] },
          { block: 2, option: 0 },
          { block: 3, option: 0 },
        ],
        categories,
      ),
    ).toThrow(/not an allowed choice/i);
  });

  it("rejects a branch the class was never offered", () => {
    expect(() =>
      resolveStartingEquipment(fighter, [{ block: 0, option: 99 }], categories),
    ).toThrow(/no option/i);
  });

  it("rejects a block that does not exist", () => {
    expect(() =>
      resolveStartingEquipment(fighter, [{ block: 99, option: 0 }], categories),
    ).toThrow(/no equipment choice/i);
  });

  it("rejects a block answered twice", () => {
    expect(() =>
      resolveStartingEquipment(
        fighter,
        [
          { block: 0, option: 0 },
          { block: 0, option: 1 },
        ],
        categories,
      ),
    ).toThrow(/twice/i);
  });

  it("rejects a request that leaves a block unanswered", () => {
    expect(() => resolveStartingEquipment(fighter, [{ block: 0, option: 0 }], categories)).toThrow(
      /was not answered/i,
    );
  });

  it("rejects a nested choice that was not made", () => {
    expect(() =>
      resolveStartingEquipment(
        fighter,
        [
          { block: 0, option: 0 },
          { block: 1, option: 0 },
          { block: 2, option: 0 },
          { block: 3, option: 0 },
        ],
        categories,
      ),
    ).toThrow(/was not made/i);
  });

  it("rejects extra picks beyond what the option needs", () => {
    expect(() =>
      resolveStartingEquipment(
        fighter,
        [
          { block: 0, option: 0 },
          { block: 1, option: 0, picks: ["longsword", "greataxe"] },
          { block: 2, option: 0 },
          { block: 3, option: 0 },
        ],
        categories,
      ),
    ).toThrow(/more choices were sent/i);
  });

  it("merges duplicate items into one stack", () => {
    // Two martial weapons, both the same, should be one row of quantity 2.
    const items = resolveStartingEquipment(
      fighter,
      [
        { block: 0, option: 0 },
        { block: 1, option: 1, picks: ["longsword", "longsword"] },
        { block: 2, option: 0 },
        { block: 3, option: 0 },
      ],
      categories,
    );
    expect(items.filter((i) => i.itemIndex === "longsword")).toEqual([
      { itemIndex: "longsword", quantity: 2 },
    ]);
  });

  it.each([
    "barbarian", "bard", "cleric", "druid", "fighter", "monk",
    "paladin", "ranger", "rogue", "sorcerer", "warlock", "wizard",
  ])("resolves a full legal kit for %s", (classIndex) => {
    const items = resolveStartingEquipment(
      srdGet.class(classIndex),
      firstLegalSelections(classIndex),
      categories,
    );
    expect(items.length).toBeGreaterThan(0);
    // Every resolved index must be a real piece of equipment.
    const known = new Set(srd.equipment().map((e) => e.index));
    for (const item of items) {
      expect(known.has(item.itemIndex), `${classIndex}: unknown item ${item.itemIndex}`).toBe(true);
      expect(item.quantity).toBeGreaterThan(0);
    }
  });
});

describe("equipmentChoicesFor", () => {
  it("labels each branch readably", () => {
    const blocks = equipmentChoicesFor(fighter, categories);
    expect(blocks[0].description).toMatch(/chain mail/i);
    expect(blocks[0].options[0].label).toBe("Chain Mail");
    expect(blocks[0].options[1].label).toBe("Leather Armor, Longbow, 20 Arrow");
  });

  it("reports the options a nested choice draws from", () => {
    const blocks = equipmentChoicesFor(fighter, categories);
    const nested = blocks.flatMap((b) => b.options).find((o) => o.picks.length > 0);
    expect(nested).toBeDefined();
    expect(nested!.picks[0].from).toContain("greataxe");
    expect(nested!.picks[0].from).not.toContain("plate-armor");
  });
});
