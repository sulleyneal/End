import { describe, expect, it } from "vitest";
import {
  type CharacterItemRow,
  type CharacterProficiencyRow,
  type CharacterRecord,
  type DeriveContext,
  deriveCharacter,
} from "@/rules/character";
import { buildLevel1Character, skillOptionsFor } from "@/rules/build";
import { equipmentChoicesFor } from "@/rules/equipment";
import { resolveTraits } from "@/rules/traits";
import { srd, srdGet } from "@/srd/local";
import { ABILITIES, type AbilityKey } from "@/srd/types";

/**
 * The character sheet audit.
 *
 * Every expectation in this file is written out by hand from the Player's
 * Handbook. Nothing here is read back from the same SRD documents the engine
 * consumes, so a wrong value in the data or a wrong reading of it both fail
 * here rather than agreeing with themselves.
 */

/* ------------------------------------------------------------------ *
 * Independently written reference tables
 * ------------------------------------------------------------------ */

type CasterKind = "full" | "half" | "pact" | "none";

const CLASS_TABLE: Record<
  string,
  { hitDie: number; saves: [AbilityKey, AbilityKey]; ability: AbilityKey | null; caster: CasterKind }
> = {
  barbarian: { hitDie: 12, saves: ["str", "con"], ability: null, caster: "none" },
  bard: { hitDie: 8, saves: ["dex", "cha"], ability: "cha", caster: "full" },
  cleric: { hitDie: 8, saves: ["wis", "cha"], ability: "wis", caster: "full" },
  druid: { hitDie: 8, saves: ["int", "wis"], ability: "wis", caster: "full" },
  fighter: { hitDie: 10, saves: ["str", "con"], ability: null, caster: "none" },
  monk: { hitDie: 8, saves: ["str", "dex"], ability: null, caster: "none" },
  paladin: { hitDie: 10, saves: ["wis", "cha"], ability: "cha", caster: "half" },
  ranger: { hitDie: 10, saves: ["str", "dex"], ability: "wis", caster: "half" },
  rogue: { hitDie: 8, saves: ["dex", "int"], ability: null, caster: "none" },
  sorcerer: { hitDie: 6, saves: ["con", "cha"], ability: "cha", caster: "full" },
  warlock: { hitDie: 8, saves: ["wis", "cha"], ability: "cha", caster: "pact" },
  wizard: { hitDie: 6, saves: ["int", "wis"], ability: "int", caster: "full" },
};

/** PHB p.15 — proficiency bonus by character level, written out rather than computed. */
const PROFICIENCY_BONUS: Record<number, number> = {
  1: 2, 2: 2, 3: 2, 4: 2,
  5: 3, 6: 3, 7: 3, 8: 3,
  9: 4, 10: 4, 11: 4, 12: 4,
  13: 5, 14: 5, 15: 5, 16: 5,
  17: 6, 18: 6, 19: 6, 20: 6,
};

/** PHB p.113 — the full-caster spell slot table, levels 1-20, slots 1st-9th. */
const FULL_CASTER_SLOTS: Record<number, number[]> = {
  1: [2],
  2: [3],
  3: [4, 2],
  4: [4, 3],
  5: [4, 3, 2],
  6: [4, 3, 3],
  7: [4, 3, 3, 1],
  8: [4, 3, 3, 2],
  9: [4, 3, 3, 3, 1],
  10: [4, 3, 3, 3, 2],
  11: [4, 3, 3, 3, 2, 1],
  12: [4, 3, 3, 3, 2, 1],
  13: [4, 3, 3, 3, 2, 1, 1],
  14: [4, 3, 3, 3, 2, 1, 1],
  15: [4, 3, 3, 3, 2, 1, 1, 1],
  16: [4, 3, 3, 3, 2, 1, 1, 1],
  17: [4, 3, 3, 3, 2, 1, 1, 1, 1],
  18: [4, 3, 3, 3, 3, 1, 1, 1, 1],
  19: [4, 3, 3, 3, 3, 2, 1, 1, 1],
  20: [4, 3, 3, 3, 3, 2, 2, 1, 1],
};

/** PHB — paladin/ranger slots (they gain spellcasting at level 2). */
const HALF_CASTER_SLOTS: Record<number, number[]> = {
  1: [],
  2: [2],
  3: [3],
  4: [3],
  5: [4, 2],
  6: [4, 2],
  7: [4, 3],
  8: [4, 3],
  9: [4, 3, 2],
  10: [4, 3, 2],
  11: [4, 3, 3],
  12: [4, 3, 3],
  13: [4, 3, 3, 1],
  14: [4, 3, 3, 1],
  15: [4, 3, 3, 2],
  16: [4, 3, 3, 2],
  17: [4, 3, 3, 3, 1],
  18: [4, 3, 3, 3, 1],
  19: [4, 3, 3, 3, 2],
  20: [4, 3, 3, 3, 2],
};

/** Warlock Pact Magic: slot count and the single slot level they are all cast at. */
const PACT_MAGIC: Record<number, { count: number; level: number }> = {
  1: { count: 1, level: 1 },
  2: { count: 2, level: 1 },
  3: { count: 2, level: 2 },
  4: { count: 2, level: 2 },
  5: { count: 2, level: 3 },
  6: { count: 2, level: 3 },
  7: { count: 2, level: 4 },
  8: { count: 2, level: 4 },
  9: { count: 2, level: 5 },
  10: { count: 2, level: 5 },
  11: { count: 3, level: 5 },
  12: { count: 3, level: 5 },
  13: { count: 3, level: 5 },
  14: { count: 3, level: 5 },
  15: { count: 3, level: 5 },
  16: { count: 3, level: 5 },
  17: { count: 4, level: 5 },
  18: { count: 4, level: 5 },
  19: { count: 4, level: 5 },
  20: { count: 4, level: 5 },
};

/** PHB racial ability score increases and walking speeds. */
const RACE_TABLE: Record<string, { bonuses: Partial<Record<AbilityKey, number>>; speed: number }> = {
  dwarf: { bonuses: { con: 2 }, speed: 25 },
  elf: { bonuses: { dex: 2 }, speed: 30 },
  halfling: { bonuses: { dex: 2 }, speed: 25 },
  human: { bonuses: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 }, speed: 30 },
  dragonborn: { bonuses: { str: 2, cha: 1 }, speed: 30 },
  gnome: { bonuses: { int: 2 }, speed: 25 },
  "half-elf": { bonuses: { cha: 2 }, speed: 30 },
  "half-orc": { bonuses: { str: 2, con: 1 }, speed: 30 },
  tiefling: { bonuses: { int: 1, cha: 2 }, speed: 30 },
};

const SUBRACE_TABLE: Record<string, Partial<Record<AbilityKey, number>>> = {
  "hill-dwarf": { wis: 1 },
  "high-elf": { int: 1 },
  "lightfoot-halfling": { cha: 1 },
  "rock-gnome": { con: 1 },
};

/** PHB p.13 — ability modifier by score. */
const MODIFIER_TABLE: Record<number, number> = {
  1: -5, 2: -4, 3: -4, 4: -3, 5: -3, 6: -2, 7: -2, 8: -1, 9: -1, 10: 0,
  11: 0, 12: 1, 13: 1, 14: 2, 15: 2, 16: 3, 17: 3, 18: 4, 19: 4, 20: 5,
};

/** Every skill and the ability it uses (PHB p.174). */
const SKILL_ABILITY: Record<string, AbilityKey> = {
  acrobatics: "dex",
  "animal-handling": "wis",
  arcana: "int",
  athletics: "str",
  deception: "cha",
  history: "int",
  insight: "wis",
  intimidation: "cha",
  investigation: "int",
  medicine: "wis",
  nature: "int",
  perception: "wis",
  performance: "cha",
  persuasion: "cha",
  religion: "int",
  "sleight-of-hand": "dex",
  stealth: "dex",
  survival: "wis",
};

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

const BASE_SCORES: Record<AbilityKey, number> = {
  str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8,
};

function contextFor(
  classIndex: string,
  raceIndex: string,
  level: number,
  options: {
    subraceIndex?: string;
    proficiencies?: CharacterProficiencyRow[];
    items?: CharacterItemRow[];
  } = {},
): DeriveContext {
  const classDoc = srdGet.class(classIndex);
  return {
    traitDocs: srd.traits(),
    classDoc,
    raceDoc: srdGet.race(raceIndex),
    subraceDoc: options.subraceIndex ? srdGet.subrace(options.subraceIndex) : null,
    levelDoc: srd.levels().find((l) => l.index === `${classIndex}-${level}`) ?? null,
    skills: srd.skills(),
    proficiencyDocs: srd.proficiencies(),
    proficiencies:
      options.proficiencies ??
      classDoc.saving_throws.map((s) => ({
        kind: "saving-throw",
        proficiencyIndex: `saving-throw-${s.index}`,
      })),
    items: options.items ?? [],
  };
}

function characterAt(classIndex: string, raceIndex: string, level: number): CharacterRecord {
  return {
    name: `Test ${classIndex}`,
    race: raceIndex,
    class: classIndex,
    level,
    ...BASE_SCORES,
  };
}

const CLASSES = Object.keys(CLASS_TABLE);
const LEVELS = [1, 2, 3, 4, 5, 8, 11, 13, 17, 20];

/* ------------------------------------------------------------------ *
 * The audit
 * ------------------------------------------------------------------ */

describe("ability modifiers match the PHB table exactly", () => {
  it.each(Object.entries(MODIFIER_TABLE))("score %s is modifier %s", (score, expected) => {
    const derived = deriveCharacter(
      { ...characterAt("fighter", "elf", 1), str: Number(score) },
      contextFor("fighter", "elf", 1),
    );
    // Elf gives no Strength bonus, so the base score is the final score.
    expect(derived.abilities.str.score).toBe(Number(score));
    expect(derived.abilities.str.modifier).toBe(expected);
  });
});

describe("every SRD class across a spread of levels", () => {
  const cases = CLASSES.flatMap((c) => LEVELS.map((l) => [c, l] as const));

  it.each(cases)("%s at level %i has the right proficiency bonus", (classIndex, level) => {
    const derived = deriveCharacter(
      characterAt(classIndex, "human", level),
      contextFor(classIndex, "human", level),
    );
    expect(derived.proficiencyBonus).toBe(PROFICIENCY_BONUS[level]);
  });

  it.each(cases)("%s at level %i has the right hit die", (classIndex, level) => {
    const derived = deriveCharacter(
      characterAt(classIndex, "human", level),
      contextFor(classIndex, "human", level),
    );
    expect(derived.hitDie).toBe(CLASS_TABLE[classIndex].hitDie);
  });

  it.each(cases)("%s at level %i is proficient in exactly its two saves", (classIndex, level) => {
    const derived = deriveCharacter(
      characterAt(classIndex, "human", level),
      contextFor(classIndex, "human", level),
    );
    const expected = CLASS_TABLE[classIndex].saves;
    const proficient = ABILITIES.filter((a) => derived.saves[a].proficient);
    expect(proficient.sort()).toEqual([...expected].sort());

    for (const ability of ABILITIES) {
      const mod = derived.abilities[ability].modifier;
      const bonus = expected.includes(ability) ? PROFICIENCY_BONUS[level] : 0;
      expect(derived.saves[ability].modifier).toBe(mod + bonus);
    }
  });

  it.each(cases)("%s at level %i has the right spellcasting maths", (classIndex, level) => {
    const entry = CLASS_TABLE[classIndex];
    const derived = deriveCharacter(
      characterAt(classIndex, "human", level),
      contextFor(classIndex, "human", level),
    );

    if (entry.caster === "none") {
      expect(derived.spellcasting).toBeNull();
      return;
    }
    if (entry.caster === "half" && level < 2) {
      expect(derived.spellcasting).toBeNull();
      return;
    }

    const casting = derived.spellcasting;
    expect(casting).not.toBeNull();
    const ability = entry.ability!;
    const mod = derived.abilities[ability].modifier;

    expect(casting!.ability).toBe(ability);
    expect(casting!.saveDc).toBe(8 + PROFICIENCY_BONUS[level] + mod);
    expect(casting!.attackBonus).toBe(PROFICIENCY_BONUS[level] + mod);
  });

  it.each(cases)("%s at level %i has the right spell slots", (classIndex, level) => {
    const entry = CLASS_TABLE[classIndex];
    const derived = deriveCharacter(
      characterAt(classIndex, "human", level),
      contextFor(classIndex, "human", level),
    );

    if (entry.caster === "none") {
      expect(derived.spellcasting).toBeNull();
      return;
    }

    const actual = derived.spellcasting?.slots ?? [];

    if (entry.caster === "pact") {
      const expected = PACT_MAGIC[level];
      expect(actual).toEqual([{ level: expected.level, max: expected.count }]);
      return;
    }

    const table = entry.caster === "full" ? FULL_CASTER_SLOTS : HALF_CASTER_SLOTS;
    const expected = table[level].map((max, i) => ({ level: i + 1, max }));
    expect(actual).toEqual(expected);
  });
});

describe("racial ability bonuses and speed", () => {
  it.each(Object.entries(RACE_TABLE))("%s applies the PHB bonuses", (raceIndex, expected) => {
    const derived = deriveCharacter(
      characterAt("fighter", raceIndex, 1),
      contextFor("fighter", raceIndex, 1),
    );
    for (const ability of ABILITIES) {
      const bonus = expected.bonuses[ability] ?? 0;
      expect(derived.abilities[ability].racial).toBe(bonus);
      expect(derived.abilities[ability].score).toBe(BASE_SCORES[ability] + bonus);
      expect(derived.abilities[ability].modifier).toBe(
        MODIFIER_TABLE[BASE_SCORES[ability] + bonus],
      );
    }
    expect(derived.speed.base).toBe(expected.speed);
  });

  it.each(Object.entries(SUBRACE_TABLE))("%s stacks its bonus on the race", (subraceIndex, extra) => {
    const raceIndex = srdGet.subrace(subraceIndex).race.index;
    const derived = deriveCharacter(
      characterAt("fighter", raceIndex, 1),
      contextFor("fighter", raceIndex, 1, { subraceIndex }),
    );
    for (const ability of ABILITIES) {
      const expected = (RACE_TABLE[raceIndex].bonuses[ability] ?? 0) + (extra[ability] ?? 0);
      expect(derived.abilities[ability].racial).toBe(expected);
    }
  });
});

describe("skills", () => {
  it("uses the right ability for every skill and adds proficiency once", () => {
    const proficiencies: CharacterProficiencyRow[] = [
      { kind: "skill", proficiencyIndex: "skill-stealth" },
      { kind: "skill", proficiencyIndex: "skill-arcana", expertise: true },
    ];
    const derived = deriveCharacter(
      characterAt("rogue", "human", 5),
      contextFor("rogue", "human", 5, { proficiencies }),
    );
    const pb = PROFICIENCY_BONUS[5];

    for (const [skill, ability] of Object.entries(SKILL_ABILITY)) {
      const entry = derived.skills[skill];
      expect(entry, `missing skill ${skill}`).toBeDefined();
      expect(entry.ability).toBe(ability);

      const mod = derived.abilities[ability].modifier;
      const expected =
        skill === "stealth" ? mod + pb : skill === "arcana" ? mod + pb * 2 : mod;
      expect(entry.modifier, `${skill} modifier`).toBe(expected);
    }
  });

  it("derives passive scores as 10 + the skill modifier", () => {
    const derived = deriveCharacter(
      characterAt("cleric", "human", 1),
      contextFor("cleric", "human", 1, {
        proficiencies: [{ kind: "skill", proficiencyIndex: "skill-perception" }],
      }),
    );
    expect(derived.passive.perception).toBe(10 + derived.skills.perception.modifier);
    expect(derived.passive.investigation).toBe(10 + derived.skills.investigation.modifier);
  });
});

describe("armour class", () => {
  const armour = (index: string): CharacterItemRow => ({
    itemIndex: index,
    equipped: true,
    doc: srdGet.equipment(index),
  });

  it("is 10 + Dex with no armour", () => {
    const derived = deriveCharacter(
      characterAt("wizard", "human", 1),
      contextFor("wizard", "human", 1),
    );
    // Human gives +1 Dex: base 14 -> 15 -> +2.
    expect(derived.abilities.dex.modifier).toBe(2);
    expect(derived.armorClass.value).toBe(12);
  });

  it("adds full Dex to light armour", () => {
    const derived = deriveCharacter(
      characterAt("rogue", "human", 1),
      contextFor("rogue", "human", 1, { items: [armour("leather-armor")] }),
    );
    expect(derived.armorClass.value).toBe(11 + 2);
  });

  it("caps Dex at +2 in medium armour", () => {
    const high = { ...characterAt("ranger", "human", 1), dex: 17 }; // 18 after human, +4
    const derived = deriveCharacter(
      high,
      contextFor("ranger", "human", 1, { items: [armour("half-plate-armor")] }),
    );
    expect(derived.abilities.dex.modifier).toBe(4);
    expect(derived.armorClass.value).toBe(15 + 2);
  });

  it("ignores Dex entirely in heavy armour", () => {
    const derived = deriveCharacter(
      characterAt("fighter", "human", 1),
      contextFor("fighter", "human", 1, { items: [armour("chain-mail")] }),
    );
    expect(derived.armorClass.value).toBe(16);
  });

  it("adds a shield on top", () => {
    const derived = deriveCharacter(
      characterAt("fighter", "human", 1),
      contextFor("fighter", "human", 1, { items: [armour("chain-mail"), armour("shield")] }),
    );
    expect(derived.armorClass.value).toBe(18);
  });

  it("gives a barbarian 10 + Dex + Con unarmoured", () => {
    const derived = deriveCharacter(
      characterAt("barbarian", "human", 1),
      contextFor("barbarian", "human", 1),
    );
    // dex 15 (+2), con 14 (+2)
    expect(derived.armorClass.value).toBe(10 + 2 + 2);
  });

  it("gives a monk 10 + Dex + Wis unarmoured", () => {
    const derived = deriveCharacter(
      characterAt("monk", "human", 1),
      contextFor("monk", "human", 1),
    );
    // dex 15 (+2), wis 11 (+0)
    expect(derived.armorClass.value).toBe(10 + 2 + 0);
  });

  it("flags armour the character is not proficient with", () => {
    const derived = deriveCharacter(
      characterAt("wizard", "human", 1),
      contextFor("wizard", "human", 1, { items: [armour("chain-mail")] }),
    );
    expect(derived.armorPenalty).toBe(true);
  });
});

describe("attacks", () => {
  it("uses Strength for a plain melee weapon and adds proficiency", () => {
    const derived = deriveCharacter(
      characterAt("fighter", "human", 5),
      contextFor("fighter", "human", 5, {
        proficiencies: [
          { kind: "saving-throw", proficiencyIndex: "saving-throw-str" },
          { kind: "other", proficiencyIndex: "martial-weapons" },
        ],
        items: [{ itemIndex: "longsword", equipped: true, doc: srdGet.equipment("longsword") }],
      }),
    );
    const attack = derived.attacks[0];
    // str 16 (+3), proficiency +3 at level 5
    expect(attack.ability).toBe("str");
    expect(attack.proficient).toBe(true);
    expect(attack.attackBonus).toBe(3 + 3);
    expect(attack.damageDice).toBe("1d8");
    expect(attack.damageBonus).toBe(3);
    expect(attack.versatileDice).toBe("1d10");
  });

  it("uses the better of Strength and Dexterity for a finesse weapon", () => {
    const nimble = { ...characterAt("rogue", "human", 1), str: 8, dex: 16 };
    const derived = deriveCharacter(
      nimble,
      contextFor("rogue", "human", 1, {
        proficiencies: [{ kind: "other", proficiencyIndex: "rapiers" }],
        items: [{ itemIndex: "rapier", equipped: true, doc: srdGet.equipment("rapier") }],
      }),
    );
    const attack = derived.attacks[0];
    expect(attack.ability).toBe("dex");
    expect(attack.attackBonus).toBe(3 + 2);
  });

  it("uses Dexterity and reports range for a ranged weapon", () => {
    const derived = deriveCharacter(
      characterAt("ranger", "human", 1),
      contextFor("ranger", "human", 1, {
        proficiencies: [{ kind: "other", proficiencyIndex: "martial-weapons" }],
        items: [{ itemIndex: "longbow", equipped: true, doc: srdGet.equipment("longbow") }],
      }),
    );
    const attack = derived.attacks[0];
    expect(attack.kind).toBe("ranged");
    expect(attack.ability).toBe("dex");
    expect(attack.rangeFt).toEqual({ normal: 150, long: 600 });
  });

  it("omits the proficiency bonus for a weapon the character cannot use", () => {
    const derived = deriveCharacter(
      characterAt("wizard", "human", 5),
      contextFor("wizard", "human", 5, {
        proficiencies: [],
        items: [{ itemIndex: "greataxe", equipped: true, doc: srdGet.equipment("greataxe") }],
      }),
    );
    expect(derived.attacks[0].proficient).toBe(false);
    expect(derived.attacks[0].attackBonus).toBe(derived.abilities.str.modifier);
  });
});

describe("level-1 construction", () => {
  const categories = srd.equipmentCategories();

  /** Takes the first branch of every equipment block, with the first legal sub-pick. */
  const firstLegalKit = (classIndex: string) =>
    equipmentChoicesFor(srdGet.class(classIndex), categories).map((block) => ({
      block: block.block,
      option: 0,
      picks: block.options[0].picks.map((pick) => pick.from[0]),
    }));

  const skillPicksFor = (classDoc: ReturnType<typeof srdGet.class>) => {
    const block = skillOptionsFor(classDoc);
    return block ? block.options.slice(0, block.choose) : [];
  };

  it.each(CLASSES)("%s builds legally with the standard array", (classIndex) => {
    const classDoc = srdGet.class(classIndex);

    const built = buildLevel1Character(
      {
        name: `Audit ${classIndex}`,
        classIndex,
        raceIndex: "human",
        scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
        scoreMethod: "standard-array",
        skillChoices: skillPicksFor(classDoc),
        equipmentSelections: firstLegalKit(classIndex),
      },
      {
        classDoc,
        raceDoc: srdGet.race("human"),
        levelDoc: srdGet.level(classIndex, 1),
        equipmentCategories: categories,
        equipmentDocs: srd.equipment(),
      },
    );

    // Every class walks away with a kit. Armour is worn, and the character has
    // drawn at most one melee and one ranged weapon — enough to fight with,
    // never two swords in one hand.
    expect(built.items.length).toBeGreaterThan(0);
    const equipmentDocs = srd.equipment();
    let meleeEquipped = 0;
    let rangedEquipped = 0;

    for (const item of built.items) {
      const doc = equipmentDocs.find((e) => e.index === item.itemIndex);
      expect(doc, `unknown item ${item.itemIndex}`).toBeDefined();

      const isArmor = doc!.armor_category !== undefined;
      const isWeapon = doc!.equipment_category?.index === "weapon";

      if (isArmor) {
        expect(item.equipped, `${item.itemIndex} should be worn`).toBe(true);
      } else if (!isWeapon) {
        expect(item.equipped, `${item.itemIndex} is not wearable or wieldable`).toBe(false);
      }

      if (item.equipped && isWeapon) {
        if (doc!.weapon_range === "Melee") meleeEquipped++;
        else rangedEquipped++;
      }
    }

    expect(meleeEquipped).toBeLessThanOrEqual(1);
    expect(rangedEquipped).toBeLessThanOrEqual(1);

    // The regression that mattered: a starting kit with a weapon in it must
    // produce a usable attack, or the character reaches the table unable to
    // swing at anything and the combat UI offers no attack buttons at all.
    const startsWithWeapon = built.items.some(
      (item) =>
        equipmentDocs.find((e) => e.index === item.itemIndex)?.equipment_category?.index ===
        "weapon",
    );
    if (startsWithWeapon) {
      expect(meleeEquipped + rangedEquipped, `${classIndex} drew no weapon`).toBeGreaterThan(0);
    }

    const entry = CLASS_TABLE[classIndex];
    // Human adds +1 Con, so 13 -> 14 -> modifier +2.
    expect(built.character.hpMax).toBe(entry.hitDie + 2);
    expect(built.character.level).toBe(1);
    expect(built.character.hitDiceRemaining).toBe(1);

    for (const save of entry.saves) {
      expect(built.proficiencies.map((p) => p.proficiencyIndex)).toContain(
        `saving-throw-${save}`,
      );
    }
  });

  it("rejects a score set that is not the standard array", () => {
    expect(() =>
      buildLevel1Character(
        {
          name: "Cheater",
          classIndex: "fighter",
          raceIndex: "human",
          scores: { str: 18, dex: 18, con: 18, int: 18, wis: 18, cha: 18 },
          scoreMethod: "standard-array",
          skillChoices: [],
        },
        { classDoc: srdGet.class("fighter"), raceDoc: srdGet.race("human") },
      ),
    ).toThrow(/standard array/i);
  });

  it("rejects point buy that overspends", () => {
    expect(() =>
      buildLevel1Character(
        {
          name: "Cheater",
          classIndex: "fighter",
          raceIndex: "human",
          scores: { str: 15, dex: 15, con: 15, int: 15, wis: 15, cha: 15 },
          scoreMethod: "point-buy",
          skillChoices: [],
        },
        { classDoc: srdGet.class("fighter"), raceDoc: srdGet.race("human") },
      ),
    ).toThrow(/point buy/i);
  });

  it("rejects a skill that the class does not offer", () => {
    expect(() =>
      buildLevel1Character(
        {
          name: "Cheater",
          classIndex: "wizard",
          raceIndex: "human",
          scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
          scoreMethod: "standard-array",
          skillChoices: ["skill-stealth", "skill-athletics"],
        },
        { classDoc: srdGet.class("wizard"), raceDoc: srdGet.race("human") },
      ),
    ).toThrow(/not one of the available options/i);
  });

  it("rejects a subrace that does not belong to the race", () => {
    expect(() =>
      buildLevel1Character(
        {
          name: "Cheater",
          classIndex: "fighter",
          raceIndex: "human",
          subraceIndex: "hill-dwarf",
          scores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
          scoreMethod: "standard-array",
          skillChoices: ["skill-acrobatics", "skill-athletics"],
        },
        { classDoc: srdGet.class("fighter"), raceDoc: srdGet.race("human") },
      ),
    ).toThrow(/no subrace/i);
  });
});

/* ------------------------------------------------------------------ *
 * Racial traits
 *
 * Every case below was a real miss found by an adversarial playthrough:
 * traits were parsed from the SRD by nobody, so hill dwarves were short on
 * hit points, high elves had no Perception and one cantrip too few, and
 * tieflings burned like anyone else.
 * ------------------------------------------------------------------ */

describe("racial traits reach the sheet", () => {
  it("Dwarven Toughness adds 1 HP per level, not once", () => {
    const plain = deriveCharacter(
      characterAt("fighter", "dwarf", 5),
      contextFor("fighter", "dwarf", 5),
    );
    const hill = deriveCharacter(
      characterAt("fighter", "dwarf", 5),
      contextFor("fighter", "dwarf", 5, { subraceIndex: "hill-dwarf" }),
    );
    expect(hill.hpMaxByAverage - plain.hpMaxByAverage).toBe(5);
  });

  it("Keen Senses gives an elf Perception proficiency and passive 12", () => {
    const derived = deriveCharacter(
      characterAt("wizard", "elf", 1),
      contextFor("wizard", "elf", 1, { subraceIndex: "high-elf" }),
    );
    // Wis 10 (+0) + proficiency 2 = +2, passive 10 + 2 = 12.
    expect(derived.skills.perception.proficient).toBe(true);
    expect(derived.skills.perception.modifier).toBe(2);
    expect(derived.passive.perception).toBe(12);
  });

  it("High Elf Cantrip adds a fourth cantrip to a level-1 wizard", () => {
    const highElf = deriveCharacter(
      characterAt("wizard", "elf", 1),
      contextFor("wizard", "elf", 1, { subraceIndex: "high-elf" }),
    );
    const human = deriveCharacter(
      characterAt("wizard", "human", 1),
      contextFor("wizard", "human", 1),
    );
    expect(human.spellcasting?.cantripsKnown).toBe(3);
    expect(highElf.spellcasting?.cantripsKnown).toBe(4);
  });

  it("Elf Weapon Training and Dwarven Combat Training grant weapon proficiencies", () => {
    const built = resolveTraits(srdGet.race("elf"), srdGet.subrace("high-elf"), srd.traits());
    expect(built.proficiencies).toContain("skill-perception");
    expect(built.proficiencies).toEqual(
      expect.arrayContaining(["longswords", "shortswords", "shortbows", "longbows"]),
    );

    const dwarf = resolveTraits(srdGet.race("dwarf"), null, srd.traits());
    expect(dwarf.proficiencies).toEqual(
      expect.arrayContaining(["battleaxes", "handaxes", "light-hammers", "warhammers"]),
    );
  });

  it("Hellish Resistance makes a tiefling resistant to fire", () => {
    const tiefling = resolveTraits(srdGet.race("tiefling"), null, srd.traits());
    expect(tiefling.resistances).toContain("fire");

    const human = resolveTraits(srdGet.race("human"), null, srd.traits());
    expect(human.resistances).toEqual([]);
  });
});
