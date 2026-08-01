/**
 * `deriveCharacter` — the single source of truth for every computed value on a
 * character sheet. Nothing in this file is ever stored: AC, saves, attack
 * bonuses, spell save DC, proficiency bonus, passive Perception and initiative
 * are recomputed from the stored raw state on every read.
 *
 * The character-sheet audit asserts these outputs against an independently
 * written expectation table — not against this code.
 */
import {
  ABILITIES,
  SKILL_ABILITY,
  XP_THRESHOLDS,
  armorInfo,
  classInfo,
  type Ability,
  type ArmorName,
  type ClassName,
  type Condition,
  type Skill,
} from "./srd";

export interface CharacterState {
  class: ClassName;
  level: number;
  abilities: Record<Ability, number>;
  /** Skill proficiencies; a skill listed in `expertise` must also be here. */
  skillProficiencies?: readonly Skill[];
  expertise?: readonly Skill[];
  /** Extra save proficiencies beyond the class's two (e.g. from a feat). */
  extraSaveProficiencies?: readonly Ability[];
  armor?: ArmorName | null;
  shield?: boolean;
  /** Flat bonuses from magic items, fighting styles, spells like Shield of Faith. */
  acBonus?: number;
  baseSpeedFt?: number;
  conditions?: readonly Condition[];
  exhaustion?: number;
}

export interface DerivedCharacter {
  abilityModifiers: Record<Ability, number>;
  proficiencyBonus: number;
  armorClass: number;
  initiative: number;
  savingThrows: Record<Ability, number>;
  saveProficiencies: Ability[];
  skills: Record<Skill, number>;
  passivePerception: number;
  speedFt: number;
  hitDie: number;
  spellcastingAbility: Ability | null;
  spellSaveDc: number | null;
  spellAttackBonus: number | null;
  /** True when the character's armor imposes disadvantage on Stealth. */
  stealthDisadvantage: boolean;
}

/** SRD: modifier = floor((score - 10) / 2). Works for scores below 10 too. */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** +2 at level 1, rising by 1 every four levels: 1-4 → +2 … 17-20 → +6. */
export function proficiencyBonus(level: number): number {
  if (level < 1 || level > 20) {
    throw new RangeError(`Level out of range: ${level}`);
  }
  return 2 + Math.floor((level - 1) / 4);
}

/** Highest level whose XP threshold has been reached. */
export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 0; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1;
  }
  return level;
}

/**
 * Exhaustion levels 1–6. Level 1 is disadvantage on ability checks; level 2
 * halves speed; the higher levels are applied by the combat engine, not here.
 */
const EXHAUSTION_HALVES_SPEED = 2;

export function deriveCharacter(state: CharacterState): DerivedCharacter {
  const info = classInfo(state.class);
  if (!info) throw new Error(`Unknown class: ${state.class}`);

  const abilityModifiers = Object.fromEntries(
    ABILITIES.map((ability) => [ability, abilityModifier(state.abilities[ability])]),
  ) as Record<Ability, number>;

  const pb = proficiencyBonus(state.level);
  const dex = abilityModifiers.dexterity;

  // --- Armor Class ---------------------------------------------------------
  const armor = state.armor ? (armorInfo(state.armor) ?? null) : null;
  let armorClass: number;
  if (!armor) {
    armorClass = 10 + dex;
  } else {
    const dexBonus =
      armor.maxDexBonus === null ? dex : Math.min(dex, armor.maxDexBonus);
    armorClass = armor.baseAc + dexBonus;
  }
  if (state.shield) armorClass += 2;
  armorClass += state.acBonus ?? 0;

  // --- Speed ---------------------------------------------------------------
  let speedFt = state.baseSpeedFt ?? 30;
  if (armor?.strengthRequirement && state.abilities.strength < armor.strengthRequirement) {
    speedFt -= 10;
  }
  if ((state.exhaustion ?? 0) >= EXHAUSTION_HALVES_SPEED) {
    speedFt = Math.floor(speedFt / 2);
  }
  speedFt = Math.max(0, speedFt);

  // --- Saving throws -------------------------------------------------------
  const saveProficiencies = [
    ...new Set<Ability>([...info.savingThrows, ...(state.extraSaveProficiencies ?? [])]),
  ];
  const savingThrows = Object.fromEntries(
    ABILITIES.map((ability) => [
      ability,
      abilityModifiers[ability] + (saveProficiencies.includes(ability) ? pb : 0),
    ]),
  ) as Record<Ability, number>;

  // --- Skills --------------------------------------------------------------
  const proficient = new Set(state.skillProficiencies ?? []);
  const expert = new Set(state.expertise ?? []);
  const skills = Object.fromEntries(
    (Object.keys(SKILL_ABILITY) as Skill[]).map((skill) => {
      const base = abilityModifiers[SKILL_ABILITY[skill]];
      const multiplier = expert.has(skill) ? 2 : proficient.has(skill) ? 1 : 0;
      return [skill, base + pb * multiplier];
    }),
  ) as Record<Skill, number>;

  // --- Spellcasting --------------------------------------------------------
  const spellcastingAbility = info.spellcastingAbility ?? null;
  const spellSaveDc =
    spellcastingAbility === null ? null : 8 + pb + abilityModifiers[spellcastingAbility];
  const spellAttackBonus =
    spellcastingAbility === null ? null : pb + abilityModifiers[spellcastingAbility];

  return {
    abilityModifiers,
    proficiencyBonus: pb,
    armorClass,
    initiative: dex,
    savingThrows,
    saveProficiencies,
    skills,
    passivePerception: 10 + skills.perception,
    speedFt,
    hitDie: info.hitDie,
    spellcastingAbility,
    spellSaveDc,
    spellAttackBonus,
    stealthDisadvantage: armor?.stealthDisadvantage ?? false,
  };
}
