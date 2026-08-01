import {
  ABILITIES,
  type AbilityKey,
  type SrdClass,
  type SrdEquipment,
  type SrdLevel,
  type SrdProficiency,
  type SrdRace,
  type SrdSkill,
  type SrdSubrace,
  type SrdTrait,
} from "@/srd/types";
import {
  abilityCheckModifiers,
  effectiveSpeed,
  exhaustionEffects,
  maxHpAfterExhaustion,
} from "./conditions";
import { resolveTraits } from "./traits";

/**
 * `deriveCharacter` is the single source of truth for every number on a
 * character sheet. Nothing derived is ever stored: AC, saves, attack bonuses,
 * spell save DC, proficiency bonus, passive scores and initiative are all
 * recomputed from base scores + equipment + SRD data on every read.
 *
 * Base ability scores in the database are *pre-racial*. Racial and subracial
 * bonuses are applied here, so a character's scores can never disagree with
 * their race.
 */

export type CharacterRecord = {
  id?: string;
  name: string;
  race: string;
  subrace?: string | null;
  class: string;
  subclass?: string | null;
  background?: string | null;
  alignment?: string | null;
  level: number;
  xp?: number;
  /** Pre-racial base scores. */
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
  hpCurrent?: number;
  hpMax?: number;
  tempHp?: number;
  hitDiceRemaining?: number;
  conditions?: string[];
  exhaustion?: number;
  inspiration?: boolean;
};

export type CharacterProficiencyRow = {
  kind: string;
  proficiencyIndex: string;
  expertise?: boolean;
};

export type CharacterItemRow = {
  itemIndex: string;
  quantity?: number;
  equipped?: boolean;
  attuned?: boolean;
  doc: SrdEquipment;
};

export type DeriveContext = {
  classDoc: SrdClass;
  raceDoc: SrdRace;
  subraceDoc?: SrdSubrace | null;
  /** The `srd_levels` row for this class at this level; supplies slots and prof bonus. */
  levelDoc?: SrdLevel | null;
  skills: SrdSkill[];
  proficiencyDocs: SrdProficiency[];
  proficiencies: CharacterProficiencyRow[];
  items: CharacterItemRow[];
  /** Racial trait documents; supply bonus HP, resistances and extra cantrips. */
  traitDocs?: SrdTrait[];
};

export type DerivedAbility = {
  base: number;
  racial: number;
  score: number;
  modifier: number;
};

export type DerivedAttack = {
  name: string;
  itemIndex: string;
  kind: "melee" | "ranged";
  ability: AbilityKey;
  proficient: boolean;
  attackBonus: number;
  damageDice: string;
  damageBonus: number;
  damageType: string;
  versatileDice?: string;
  /** Melee reach, or normal/long range in feet for ranged and thrown weapons. */
  reachFt?: number;
  rangeFt?: { normal: number; long?: number };
  properties: string[];
};

export type DerivedSpellcasting = {
  ability: AbilityKey;
  modifier: number;
  saveDc: number;
  attackBonus: number;
  cantripsKnown: number;
  spellsKnown?: number;
  slots: { level: number; max: number }[];
};

export type DerivedCharacter = {
  abilities: Record<AbilityKey, DerivedAbility>;
  proficiencyBonus: number;
  armorClass: { value: number; sources: string[] };
  initiative: number;
  speed: { base: number; effective: number };
  saves: Record<AbilityKey, { modifier: number; proficient: boolean }>;
  skills: Record<
    string,
    { name: string; ability: AbilityKey; modifier: number; proficient: boolean; expertise: boolean }
  >;
  passive: { perception: number; investigation: number; insight: number };
  hitDie: number;
  /** Max HP by the "average roll" convention, used to validate stored HP and to level up. */
  hpMaxByAverage: number;
  /** Stored max HP after exhaustion 4+ halves it. */
  effectiveHpMax: number;
  spellcasting: DerivedSpellcasting | null;
  attacks: DerivedAttack[];
  carry: { capacity: number; pushDragLift: number; encumbered: number; heavilyEncumbered: number };
  /** Damage types this character resists, e.g. a tiefling's Hellish Resistance. */
  resistances: string[];
  /** True when wearing armor or a shield the character is not proficient with. */
  armorPenalty: boolean;
  stealthDisadvantage: boolean;
  checksHaveDisadvantage: boolean;
};

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** PHB: 2 at levels 1-4, then +1 every 4 levels. */
export function proficiencyBonusForLevel(level: number): number {
  return 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);
}

/** XP thresholds for levels 1-20 (PHB 15). */
export const XP_THRESHOLDS = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000,
  165000, 195000, 225000, 265000, 305000, 355000,
] as const;

export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 0; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1;
  }
  return level;
}

export function xpToNextLevel(xp: number): number | null {
  const level = levelForXp(xp);
  if (level >= 20) return null;
  return XP_THRESHOLDS[level] - xp;
}

/* ------------------------------------------------------------------ *
 * deriveCharacter
 * ------------------------------------------------------------------ */

export function deriveCharacter(
  character: CharacterRecord,
  ctx: DeriveContext,
): DerivedCharacter {
  const state = {
    conditions: character.conditions ?? [],
    exhaustion: character.exhaustion ?? 0,
  };

  /* --- Abilities (base + racial) --- */
  const racial: Record<AbilityKey, number> = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  for (const bonus of ctx.raceDoc.ability_bonuses ?? []) {
    const key = bonus.ability_score.index as AbilityKey;
    if (key in racial) racial[key] += bonus.bonus;
  }
  for (const bonus of ctx.subraceDoc?.ability_bonuses ?? []) {
    const key = bonus.ability_score.index as AbilityKey;
    if (key in racial) racial[key] += bonus.bonus;
  }

  const abilities = {} as Record<AbilityKey, DerivedAbility>;
  for (const key of ABILITIES) {
    const base = character[key];
    const score = base + racial[key];
    abilities[key] = { base, racial: racial[key], score, modifier: abilityModifier(score) };
  }
  const mod = (key: AbilityKey) => abilities[key].modifier;

  const traits = resolveTraits(ctx.raceDoc, ctx.subraceDoc, ctx.traitDocs ?? []);

  /* --- Proficiency bonus: SRD level data first, formula as the fallback --- */
  const proficiencyBonus =
    ctx.levelDoc?.prof_bonus ?? proficiencyBonusForLevel(character.level);

  /* --- Proficiency lookup helpers --- */
  // Trait proficiencies are folded in here rather than trusted to have been
  // stored at build time, so a character created before traits were understood
  // still derives a correct sheet instead of needing a data migration.
  const profIndexes = new Set([
    ...ctx.proficiencies.map((p) => p.proficiencyIndex),
    ...traits.proficiencies,
  ]);
  const expertise = new Set(
    ctx.proficiencies.filter((p) => p.expertise).map((p) => p.proficiencyIndex),
  );
  const docByIndex = new Map(ctx.proficiencyDocs.map((d) => [d.index, d]));

  /** True when any held proficiency covers this equipment item. */
  const proficientWithItem = (item: SrdEquipment): boolean => {
    for (const index of profIndexes) {
      const doc = docByIndex.get(index);
      const ref = doc?.reference?.index;
      if (ref === item.index) return true;
      if (item.weapon_category === "Simple" && ref === "simple-weapons") return true;
      if (item.weapon_category === "Martial" && ref === "martial-weapons") return true;
      if (item.armor_category === "Shield" && index === "shields") return true;
      if (item.armor_category && index === "all-armor") return true;
      if (item.armor_category === "Light" && index === "light-armor") return true;
      if (item.armor_category === "Medium" && index === "medium-armor") return true;
      if (item.armor_category === "Heavy" && index === "heavy-armor") return true;
    }
    return false;
  };

  /* --- Armor class --- */
  const equipped = ctx.items.filter((i) => i.equipped);
  const armor = equipped.find(
    (i) => i.doc.armor_category && i.doc.armor_category !== "Shield",
  );
  const shield = equipped.find((i) => i.doc.armor_category === "Shield");

  const acSources: string[] = [];
  let ac: number;

  if (armor?.doc.armor_class) {
    const rule = armor.doc.armor_class;
    let dexPart = 0;
    if (rule.dex_bonus) {
      dexPart =
        rule.max_bonus !== undefined ? Math.min(mod("dex"), rule.max_bonus) : mod("dex");
    }
    ac = rule.base + dexPart;
    acSources.push(`${armor.doc.name} ${rule.base}`);
    if (rule.dex_bonus) acSources.push(`Dex ${dexPart >= 0 ? "+" : ""}${dexPart}`);
  } else {
    // Unarmored, including the class Unarmored Defense features.
    let bonus = 0;
    if (ctx.classDoc.index === "barbarian") {
      bonus = mod("con");
      acSources.push("Unarmored Defense 10", `Dex ${fmt(mod("dex"))}`, `Con ${fmt(bonus)}`);
    } else if (ctx.classDoc.index === "monk" && !shield) {
      bonus = mod("wis");
      acSources.push("Unarmored Defense 10", `Dex ${fmt(mod("dex"))}`, `Wis ${fmt(bonus)}`);
    } else {
      acSources.push("Unarmored 10", `Dex ${fmt(mod("dex"))}`);
    }
    ac = 10 + mod("dex") + bonus;
  }

  if (shield?.doc.armor_class) {
    ac += shield.doc.armor_class.base;
    acSources.push(`${shield.doc.name} +${shield.doc.armor_class.base}`);
  }

  const armorPenalty =
    (armor !== undefined && !proficientWithItem(armor.doc)) ||
    (shield !== undefined && !proficientWithItem(shield.doc));
  const stealthDisadvantage = armor?.doc.stealth_disadvantage === true;

  /* --- Saves --- */
  const saves = {} as Record<AbilityKey, { modifier: number; proficient: boolean }>;
  for (const key of ABILITIES) {
    const proficient = profIndexes.has(`saving-throw-${key}`);
    saves[key] = {
      proficient,
      modifier: mod(key) + (proficient ? proficiencyBonus : 0),
    };
  }

  /* --- Skills --- */
  const checkMods = abilityCheckModifiers(state);
  const skills: DerivedCharacter["skills"] = {};
  for (const skill of ctx.skills) {
    const ability = skill.ability_score.index as AbilityKey;
    const profIndex = `skill-${skill.index}`;
    const proficient = profIndexes.has(profIndex);
    const hasExpertise = expertise.has(profIndex);
    skills[skill.index] = {
      name: skill.name,
      ability,
      proficient,
      expertise: hasExpertise,
      modifier:
        mod(ability) +
        (proficient ? proficiencyBonus : 0) +
        (hasExpertise ? proficiencyBonus : 0),
    };
  }

  const passiveOf = (skillIndex: string, ability: AbilityKey) => {
    const entry = skills[skillIndex];
    const base = 10 + (entry ? entry.modifier : mod(ability));
    // A creature with disadvantage on the relevant check takes -5 passive (PHB 175).
    return base + (checkMods.disadvantage ? -5 : 0);
  };

  /* --- Speed --- */
  const baseSpeed = ctx.raceDoc.speed;

  /* --- Spellcasting --- */
  let spellcasting: DerivedSpellcasting | null = null;
  if (ctx.classDoc.spellcasting && character.level >= ctx.classDoc.spellcasting.level) {
    const ability = ctx.classDoc.spellcasting.spellcasting_ability.index as AbilityKey;
    const casting = ctx.levelDoc?.spellcasting;
    const slots: { level: number; max: number }[] = [];

    if (casting) {
      for (let lvl = 1; lvl <= 9; lvl++) {
        const key = `spell_slots_level_${lvl}` as keyof typeof casting;
        const max = (casting[key] as number | undefined) ?? 0;
        if (max > 0) slots.push({ level: lvl, max });
      }
    }
    spellcasting = {
      ability,
      modifier: mod(ability),
      saveDc: 8 + proficiencyBonus + mod(ability),
      attackBonus: proficiencyBonus + mod(ability),
      cantripsKnown: (casting?.cantrips_known ?? 0) + traits.extraCantrips,
      spellsKnown: casting?.spells_known,
      slots,
    };
  }

  /* --- Attacks from equipped weapons --- */
  const attacks: DerivedAttack[] = [];
  for (const item of equipped) {
    const doc = item.doc;
    if (!doc.damage || doc.equipment_category.index !== "weapon") continue;

    const props = (doc.properties ?? []).map((p) => p.index);
    const isRanged = doc.weapon_range === "Ranged";
    const finesse = props.includes("finesse");

    let ability: AbilityKey;
    if (isRanged) ability = "dex";
    else if (finesse) ability = mod("dex") > mod("str") ? "dex" : "str";
    else ability = "str";

    const proficient = proficientWithItem(doc);
    attacks.push({
      name: doc.name,
      itemIndex: doc.index,
      kind: isRanged ? "ranged" : "melee",
      ability,
      proficient,
      attackBonus: mod(ability) + (proficient ? proficiencyBonus : 0),
      damageDice: doc.damage.damage_dice,
      damageBonus: mod(ability),
      damageType: doc.damage.damage_type.index,
      versatileDice: doc.two_handed_damage?.damage_dice,
      reachFt: isRanged ? undefined : (doc.range?.normal ?? 5),
      rangeFt: isRanged
        ? { normal: doc.range?.normal ?? 0, long: doc.range?.long }
        : doc.throw_range
          ? { normal: doc.throw_range.normal, long: doc.throw_range.long }
          : undefined,
      properties: props,
    });
  }

  /* --- Hit points and carrying --- */
  const hitDie = ctx.classDoc.hit_die;
  const averagePerLevel = Math.floor(hitDie / 2) + 1;
  const hpMaxByAverage =
    hitDie +
    mod("con") +
    (character.level - 1) * (averagePerLevel + mod("con")) +
    traits.hpPerLevel * character.level;

  const strScore = abilities.str.score;

  return {
    resistances: traits.resistances,
    abilities,
    proficiencyBonus,
    armorClass: { value: ac, sources: acSources },
    initiative: mod("dex"),
    speed: { base: baseSpeed, effective: effectiveSpeed(baseSpeed, state) },
    saves,
    skills,
    passive: {
      perception: passiveOf("perception", "wis"),
      investigation: passiveOf("investigation", "int"),
      insight: passiveOf("insight", "wis"),
    },
    hitDie,
    hpMaxByAverage: Math.max(1, hpMaxByAverage),
    effectiveHpMax: maxHpAfterExhaustion(
      character.hpMax ?? Math.max(1, hpMaxByAverage),
      state.exhaustion,
    ),
    spellcasting,
    attacks,
    carry: {
      capacity: strScore * 15,
      pushDragLift: strScore * 30,
      encumbered: strScore * 5,
      heavilyEncumbered: strScore * 10,
    },
    armorPenalty,
    stealthDisadvantage,
    checksHaveDisadvantage: checkMods.disadvantage,
  };
}

/** True when exhaustion has reached the level that kills outright. */
export function isDeadFromExhaustion(exhaustion: number): boolean {
  return exhaustionEffects(exhaustion).dead;
}

function fmt(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}
