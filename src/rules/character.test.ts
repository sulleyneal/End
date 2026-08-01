/**
 * Character-sheet audit (PLAN.md §4.2).
 *
 * Expected values here are written by hand from the SRD, not produced by
 * `deriveCharacter`. If the engine and this table ever agree only because they
 * share a bug, the table is the thing that is wrong.
 */
import { describe, expect, it } from "vitest";
import {
  abilityModifier,
  deriveCharacter,
  levelForXp,
  proficiencyBonus,
  type CharacterState,
} from "./character";
import { ABILITIES, CLASSES, classInfo, type ClassName } from "./srd";

describe("abilityModifier", () => {
  const table: Array<[number, number]> = [
    [1, -5],
    [3, -4],
    [7, -2],
    [8, -1],
    [9, -1],
    [10, 0],
    [11, 0],
    [12, 1],
    [15, 2],
    [16, 3],
    [18, 4],
    [20, 5],
    [30, 10],
  ];

  it.each(table)("score %i → %i", (score, expected) => {
    expect(abilityModifier(score)).toBe(expected);
  });
});

describe("proficiencyBonus", () => {
  const expected: Record<number, number> = {
    1: 2, 2: 2, 3: 2, 4: 2,
    5: 3, 6: 3, 7: 3, 8: 3,
    9: 4, 10: 4, 11: 4, 12: 4,
    13: 5, 14: 5, 15: 5, 16: 5,
    17: 6, 18: 6, 19: 6, 20: 6,
  };

  it("matches the SRD table at every level", () => {
    for (const [level, bonus] of Object.entries(expected)) {
      expect(proficiencyBonus(Number(level))).toBe(bonus);
    }
  });

  it("rejects levels outside 1–20", () => {
    expect(() => proficiencyBonus(0)).toThrow(RangeError);
    expect(() => proficiencyBonus(21)).toThrow(RangeError);
  });
});

describe("levelForXp", () => {
  it("maps XP to the SRD advancement table", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(299)).toBe(1);
    expect(levelForXp(300)).toBe(2);
    expect(levelForXp(2699)).toBe(3);
    expect(levelForXp(2700)).toBe(4);
    expect(levelForXp(48000)).toBe(9);
    expect(levelForXp(355000)).toBe(20);
    expect(levelForXp(1_000_000)).toBe(20);
  });
});

describe("deriveCharacter", () => {
  it("level 5 fighter in chain mail and shield", () => {
    const fighter: CharacterState = {
      class: "fighter",
      level: 5,
      abilities: {
        strength: 16,
        dexterity: 12,
        constitution: 14,
        intelligence: 10,
        wisdom: 13,
        charisma: 8,
      },
      armor: "chain-mail",
      shield: true,
      skillProficiencies: ["athletics", "intimidation"],
    };
    const d = deriveCharacter(fighter);

    expect(d.proficiencyBonus).toBe(3);
    // Chain mail 16, heavy armor grants no Dex bonus, +2 shield.
    expect(d.armorClass).toBe(18);
    expect(d.initiative).toBe(1);
    expect(d.speedFt).toBe(30); // STR 16 meets chain mail's 13 requirement
    expect(d.hitDie).toBe(10);
    expect(d.stealthDisadvantage).toBe(true);

    expect(d.savingThrows.strength).toBe(6); // +3 STR, proficient +3
    expect(d.savingThrows.constitution).toBe(5); // +2 CON, proficient +3
    expect(d.savingThrows.dexterity).toBe(1); // not proficient
    expect(d.savingThrows.charisma).toBe(-1);
    expect(d.saveProficiencies.sort()).toEqual(["constitution", "strength"]);

    expect(d.skills.athletics).toBe(6); // +3 STR, proficient +3
    expect(d.skills.intimidation).toBe(2); // -1 CHA, proficient +3
    expect(d.skills.perception).toBe(1); // +1 WIS, not proficient
    expect(d.passivePerception).toBe(11);

    expect(d.spellcastingAbility).toBeNull();
    expect(d.spellSaveDc).toBeNull();
    expect(d.spellAttackBonus).toBeNull();
  });

  it("level 1 wizard, unarmored", () => {
    const d = deriveCharacter({
      class: "wizard",
      level: 1,
      abilities: {
        strength: 8,
        dexterity: 14,
        constitution: 13,
        intelligence: 16,
        wisdom: 12,
        charisma: 10,
      },
      skillProficiencies: ["arcana", "investigation"],
    });

    expect(d.proficiencyBonus).toBe(2);
    expect(d.armorClass).toBe(12); // 10 + 2 Dex
    expect(d.hitDie).toBe(6);
    expect(d.savingThrows.intelligence).toBe(5); // +3 INT, proficient +2
    expect(d.savingThrows.wisdom).toBe(3); // +1 WIS, proficient +2
    expect(d.savingThrows.strength).toBe(-1);
    expect(d.spellcastingAbility).toBe("intelligence");
    expect(d.spellSaveDc).toBe(13); // 8 + 2 + 3
    expect(d.spellAttackBonus).toBe(5); // 2 + 3
    expect(d.skills.arcana).toBe(5);
    expect(d.passivePerception).toBe(11); // 10 + 1 WIS
  });

  it("applies expertise as a doubled proficiency bonus", () => {
    const d = deriveCharacter({
      class: "rogue",
      level: 8,
      abilities: {
        strength: 10,
        dexterity: 18,
        constitution: 12,
        intelligence: 12,
        wisdom: 14,
        charisma: 13,
      },
      armor: "studded-leather",
      skillProficiencies: ["stealth", "perception", "investigation"],
      expertise: ["stealth"],
    });

    expect(d.proficiencyBonus).toBe(3);
    expect(d.armorClass).toBe(16); // studded leather 12 + 4 Dex, no cap
    expect(d.skills.stealth).toBe(10); // +4 Dex, expertise +6
    expect(d.skills.perception).toBe(5); // +2 Wis, proficient +3
    expect(d.skills.investigation).toBe(4); // +1 Int, proficient +3
    expect(d.skills.acrobatics).toBe(4); // +4 Dex, not proficient
    expect(d.passivePerception).toBe(15);
    expect(d.stealthDisadvantage).toBe(false);
  });

  it("caps the Dex bonus at +2 in medium armor", () => {
    const d = deriveCharacter({
      class: "cleric",
      level: 3,
      abilities: {
        strength: 12,
        dexterity: 18,
        constitution: 14,
        intelligence: 10,
        wisdom: 16,
        charisma: 12,
      },
      armor: "half-plate",
    });

    expect(d.armorClass).toBe(17); // 15 + min(4, 2)
    expect(d.stealthDisadvantage).toBe(true);
    expect(d.spellSaveDc).toBe(13); // 8 + 2 + 3 Wis
  });

  it("drops speed by 10 ft when heavy armor outweighs Strength", () => {
    const weak = deriveCharacter({
      class: "cleric",
      level: 1,
      abilities: {
        strength: 10,
        dexterity: 10,
        constitution: 14,
        intelligence: 10,
        wisdom: 16,
        charisma: 12,
      },
      armor: "plate", // requires STR 15
    });
    expect(weak.speedFt).toBe(20);
    expect(weak.armorClass).toBe(18);

    const strong = deriveCharacter({
      class: "cleric",
      level: 1,
      abilities: {
        strength: 15,
        dexterity: 10,
        constitution: 14,
        intelligence: 10,
        wisdom: 16,
        charisma: 12,
      },
      armor: "plate",
    });
    expect(strong.speedFt).toBe(30);
  });

  it("halves speed at exhaustion 2, after the armor penalty", () => {
    const base: CharacterState = {
      class: "fighter",
      level: 1,
      abilities: {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      },
    };

    expect(deriveCharacter({ ...base, exhaustion: 1 }).speedFt).toBe(30);
    expect(deriveCharacter({ ...base, exhaustion: 2 }).speedFt).toBe(15);
    // 30 - 10 for the plate requirement, then halved.
    expect(deriveCharacter({ ...base, armor: "plate", exhaustion: 2 }).speedFt).toBe(10);
  });

  it("adds flat AC bonuses and shields on top of armor", () => {
    const d = deriveCharacter({
      class: "paladin",
      level: 6,
      abilities: {
        strength: 16,
        dexterity: 10,
        constitution: 14,
        intelligence: 10,
        wisdom: 12,
        charisma: 16,
      },
      armor: "chain-mail",
      shield: true,
      acBonus: 2, // Shield of Faith
    });
    expect(d.armorClass).toBe(20); // 16 + 0 Dex + 2 shield + 2
    expect(d.spellSaveDc).toBe(14); // 8 + 3 PB + 3 Cha
    expect(d.spellAttackBonus).toBe(6);
  });

  it("honours extra save proficiencies without duplicating class ones", () => {
    const d = deriveCharacter({
      class: "wizard",
      level: 4,
      abilities: {
        strength: 10,
        dexterity: 14,
        constitution: 14,
        intelligence: 18,
        wisdom: 12,
        charisma: 10,
      },
      extraSaveProficiencies: ["constitution", "intelligence"],
    });

    expect(d.saveProficiencies.sort()).toEqual([
      "constitution",
      "intelligence",
      "wisdom",
    ]);
    expect(d.savingThrows.constitution).toBe(4); // +2 CON, proficient +2
    expect(d.savingThrows.intelligence).toBe(6); // +4 INT, counted once
  });

  it("produces a coherent sheet for every SRD class", () => {
    for (const className of Object.keys(CLASSES) as ClassName[]) {
      const d = deriveCharacter({
        class: className,
        level: 10,
        abilities: {
          strength: 14,
          dexterity: 14,
          constitution: 14,
          intelligence: 14,
          wisdom: 14,
          charisma: 14,
        },
      });

      expect(d.proficiencyBonus).toBe(4);
      expect(d.armorClass).toBe(12); // 10 + 2 Dex, unarmored
      expect(d.saveProficiencies).toHaveLength(2);
      expect(d.hitDie).toBe(classInfo(className)?.hitDie);

      for (const ability of ABILITIES) {
        const proficient = d.saveProficiencies.includes(ability);
        expect(d.savingThrows[ability]).toBe(proficient ? 6 : 2);
      }

      if (classInfo(className)?.spellcastingAbility) {
        expect(d.spellSaveDc).toBe(14); // 8 + 4 + 2
        expect(d.spellAttackBonus).toBe(6);
      } else {
        expect(d.spellSaveDc).toBeNull();
      }
    }
  });

  it("rejects an unknown class", () => {
    expect(() =>
      deriveCharacter({
        class: "artificer" as ClassName,
        level: 1,
        abilities: {
          strength: 10,
          dexterity: 10,
          constitution: 10,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
        },
      }),
    ).toThrow();
  });
});
