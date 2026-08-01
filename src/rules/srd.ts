/**
 * Small, stable SRD 5.1 tables that the rules engine needs in code rather than
 * in the database. The bulk SRD documents (spells, monsters, equipment) live in
 * Postgres; these are the lookups that every derivation touches.
 */

export const ABILITIES = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
] as const;

export type Ability = (typeof ABILITIES)[number];

/** Skill → governing ability. */
export const SKILL_ABILITY = {
  acrobatics: "dexterity",
  "animal-handling": "wisdom",
  arcana: "intelligence",
  athletics: "strength",
  deception: "charisma",
  history: "intelligence",
  insight: "wisdom",
  intimidation: "charisma",
  investigation: "intelligence",
  medicine: "wisdom",
  nature: "intelligence",
  perception: "wisdom",
  performance: "charisma",
  persuasion: "charisma",
  religion: "wisdom",
  "sleight-of-hand": "dexterity",
  stealth: "dexterity",
  survival: "wisdom",
} as const satisfies Record<string, Ability>;

export type Skill = keyof typeof SKILL_ABILITY;

export interface ClassInfo {
  hitDie: number;
  savingThrows: readonly [Ability, Ability];
  /** Absent for classes with no spellcasting at all. */
  spellcastingAbility?: Ability;
}

export const CLASSES = {
  barbarian: { hitDie: 12, savingThrows: ["strength", "constitution"] },
  bard: { hitDie: 8, savingThrows: ["dexterity", "charisma"], spellcastingAbility: "charisma" },
  cleric: { hitDie: 8, savingThrows: ["wisdom", "charisma"], spellcastingAbility: "wisdom" },
  druid: { hitDie: 8, savingThrows: ["intelligence", "wisdom"], spellcastingAbility: "wisdom" },
  fighter: { hitDie: 10, savingThrows: ["strength", "constitution"] },
  monk: { hitDie: 8, savingThrows: ["strength", "dexterity"] },
  paladin: { hitDie: 10, savingThrows: ["wisdom", "charisma"], spellcastingAbility: "charisma" },
  ranger: { hitDie: 10, savingThrows: ["strength", "dexterity"], spellcastingAbility: "wisdom" },
  rogue: { hitDie: 8, savingThrows: ["dexterity", "intelligence"] },
  sorcerer: { hitDie: 6, savingThrows: ["constitution", "charisma"], spellcastingAbility: "charisma" },
  warlock: { hitDie: 8, savingThrows: ["wisdom", "charisma"], spellcastingAbility: "charisma" },
  wizard: { hitDie: 6, savingThrows: ["intelligence", "wisdom"], spellcastingAbility: "intelligence" },
} as const satisfies Record<string, ClassInfo>;

export type ClassName = keyof typeof CLASSES;

/**
 * `as const satisfies` keeps the key literals but narrows each value to its own
 * shape, so optional fields vanish from the union. Read through these accessors
 * to get the declared interface back. They return `undefined` for unknown
 * input, which callers are expected to check.
 */
export function classInfo(name: string): ClassInfo | undefined {
  return (CLASSES as Record<string, ClassInfo>)[name];
}

/** XP thresholds for levels 1–20 (SRD 5.1 "Character Advancement"). */
export const XP_THRESHOLDS = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000,
  120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
] as const;

export type ArmorCategory = "light" | "medium" | "heavy" | "none";

export interface ArmorInfo {
  baseAc: number;
  category: ArmorCategory;
  /** Medium armor caps the Dex bonus at +2; heavy armor adds none. */
  maxDexBonus: number | null;
  stealthDisadvantage: boolean;
  /** Minimum Strength, below which speed drops by 10 ft. */
  strengthRequirement?: number;
}

export const ARMOR = {
  padded: { baseAc: 11, category: "light", maxDexBonus: null, stealthDisadvantage: true },
  leather: { baseAc: 11, category: "light", maxDexBonus: null, stealthDisadvantage: false },
  "studded-leather": { baseAc: 12, category: "light", maxDexBonus: null, stealthDisadvantage: false },
  hide: { baseAc: 12, category: "medium", maxDexBonus: 2, stealthDisadvantage: false },
  "chain-shirt": { baseAc: 13, category: "medium", maxDexBonus: 2, stealthDisadvantage: false },
  "scale-mail": { baseAc: 14, category: "medium", maxDexBonus: 2, stealthDisadvantage: true },
  breastplate: { baseAc: 14, category: "medium", maxDexBonus: 2, stealthDisadvantage: false },
  "half-plate": { baseAc: 15, category: "medium", maxDexBonus: 2, stealthDisadvantage: true },
  "ring-mail": { baseAc: 14, category: "heavy", maxDexBonus: 0, stealthDisadvantage: true },
  "chain-mail": {
    baseAc: 16,
    category: "heavy",
    maxDexBonus: 0,
    stealthDisadvantage: true,
    strengthRequirement: 13,
  },
  splint: {
    baseAc: 17,
    category: "heavy",
    maxDexBonus: 0,
    stealthDisadvantage: true,
    strengthRequirement: 15,
  },
  plate: {
    baseAc: 18,
    category: "heavy",
    maxDexBonus: 0,
    stealthDisadvantage: true,
    strengthRequirement: 15,
  },
} as const satisfies Record<string, ArmorInfo>;

export type ArmorName = keyof typeof ARMOR;

export function armorInfo(name: string): ArmorInfo | undefined {
  return (ARMOR as Record<string, ArmorInfo>)[name];
}

/** The 15 SRD conditions. */
export const CONDITIONS = [
  "blinded",
  "charmed",
  "deafened",
  "exhaustion",
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
] as const;

export type Condition = (typeof CONDITIONS)[number];
