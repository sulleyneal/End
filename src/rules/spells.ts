import type { SrdSpell } from "@/srd/types";

/**
 * Spell resolution.
 *
 * Almost everything needed to resolve a spell is structured in the SRD
 * documents: whether it is an attack or forces a save, which save, what happens
 * on a success, the damage dice at each slot level, the healing at each slot
 * level, whether it needs concentration, and its range. This module reads those
 * fields; it does not restate any spell's rules.
 *
 * What it deliberately does *not* do is decide outcomes. It answers "what would
 * this spell do at this slot level" — the engine rolls the dice.
 */

export type SpellShape =
  | { kind: "attack"; attackType: "melee" | "ranged" }
  | { kind: "save"; ability: string; onSuccess: "none" | "half" | "other" }
  | { kind: "heal" }
  /** Damage that simply lands: Magic Missile, Scorching Ray, Sleep. */
  | { kind: "auto" }
  | { kind: "utility" };

export class SpellError extends Error {}

/** Range in feet, or null for Self/Touch/Special/Sight/Unlimited. */
export function rangeFt(spell: SrdSpell): number | null {
  const match = /^(\d+)\s+f(?:ee|oo)t$/i.exec(spell.range.trim());
  if (match) return Number(match[1]);
  if (/^touch$/i.test(spell.range.trim())) return 5;
  return null;
}

export function isTouch(spell: SrdSpell): boolean {
  return /^touch$/i.test(spell.range.trim());
}

/**
 * The reach of a Self spell that has an area, e.g. `Self (15-foot cone)` -> 15.
 * Null for a Self spell that affects only the caster.
 *
 * The grid is square, so a cone, line or radius of N feet cannot reach further
 * than N feet in any direction; bounding it by that is a conservative check
 * that a client cannot argue with, even before the exact shape is modelled.
 */
export function selfAreaFt(spell: SrdSpell): number | null {
  if (!/^self/i.test(spell.range.trim())) return null;
  const match = /\((\d+)[- ]?foot/i.exec(spell.range);
  if (match) return Number(match[1]);
  return spell.area_of_effect?.size ?? null;
}

export function shapeOf(spell: SrdSpell): SpellShape {
  if (spell.attack_type) return { kind: "attack", attackType: spell.attack_type };
  if (spell.dc) {
    const success = spell.dc.dc_success;
    return {
      kind: "save",
      ability: spell.dc.dc_type.index,
      onSuccess: success === "none" || success === "half" ? success : "other",
    };
  }
  if (spell.heal_at_slot_level) return { kind: "heal" };
  // A spell with damage but neither an attack roll nor a save hits automatically.
  // Ten SRD spells are shaped this way, including Magic Missile and Scorching
  // Ray; treating them as utility meant they spent a slot and did nothing.
  if (spell.damage?.damage_at_slot_level || spell.damage?.damage_at_character_level) {
    return { kind: "auto" };
  }
  return { kind: "utility" };
}

/** Cantrips scale with character level at 1st, 5th, 11th and 17th (PHB). */
export function cantripTier(characterLevel: number): number {
  if (characterLevel >= 17) return 17;
  if (characterLevel >= 11) return 11;
  if (characterLevel >= 5) return 5;
  return 1;
}

/**
 * The SRD writes the caster's spellcasting modifier as a literal `MOD` token in
 * a handful of healing and damage tables ("1d8 + MOD"). Substituting it here
 * keeps every caller from having to know that.
 */
export function substituteMod(dice: string, modifier: number): string {
  if (!dice.includes("MOD")) return dice;
  return dice.replace(/\s*\+\s*MOD/g, modifier >= 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`)
    .replace(/MOD/g, String(modifier));
}

/**
 * The damage dice this spell rolls, or null when it deals none.
 *
 * Cantrips scale by the caster's level; levelled spells scale by the slot spent,
 * which is what makes upcasting work without a special case per spell.
 */
export function damageDiceFor(
  spell: SrdSpell,
  params: { slotLevel: number; characterLevel: number; modifier?: number },
): string | null {
  const damage = spell.damage;
  if (!damage) return null;

  if (damage.damage_at_character_level) {
    const entry = damage.damage_at_character_level[String(cantripTier(params.characterLevel))];
    return entry ? substituteMod(entry, params.modifier ?? 0) : null;
  }
  if (damage.damage_at_slot_level) {
    const table = damage.damage_at_slot_level;
    // Fall back to the highest level at or below the slot spent, so a spell
    // upcast beyond its table still resolves rather than dealing nothing.
    for (let level = params.slotLevel; level >= 1; level--) {
      const entry = table[String(level)];
      if (entry) return substituteMod(entry, params.modifier ?? 0);
    }
  }
  return null;
}

export function healingDiceFor(
  spell: SrdSpell,
  slotLevel: number,
  modifier = 0,
): string | null {
  const table = spell.heal_at_slot_level;
  if (!table) return null;
  for (let level = slotLevel; level >= 1; level--) {
    const entry = table[String(level)];
    if (entry) return substituteMod(entry, modifier);
  }
  return null;
}

/**
 * Checks a slot is legal for this spell before anything is spent.
 *
 * Cantrips cost nothing and are cast at level 0; everything else must be cast
 * with a slot at least its own level.
 */
export function validateSlot(
  spell: SrdSpell,
  slotLevel: number,
  available: { level: number; max: number; used: number }[],
): { cantrip: true } | { cantrip: false; slotLevel: number } {
  if (spell.level === 0) {
    if (slotLevel !== 0) {
      throw new SpellError(`${spell.name} is a cantrip and does not use a spell slot.`);
    }
    return { cantrip: true };
  }

  if (slotLevel < spell.level) {
    throw new SpellError(
      `${spell.name} is a level ${spell.level} spell and cannot be cast with a level ${slotLevel} slot.`,
    );
  }

  const slot = available.find((s) => s.level === slotLevel);
  if (!slot) throw new SpellError(`You have no level ${slotLevel} spell slots.`);
  if (slot.used >= slot.max) {
    throw new SpellError(`Your level ${slotLevel} spell slots are all spent.`);
  }

  return { cantrip: false, slotLevel };
}

/** Spells a class can choose from at a given character level. */
export function spellListFor(
  spells: SrdSpell[],
  classIndex: string,
  maxLevel: number,
): SrdSpell[] {
  return spells
    .filter((s) => (s.classes ?? []).some((c) => c.index === classIndex))
    .filter((s) => s.level <= maxLevel)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ *
 * What a caster knows at level 1
 * ------------------------------------------------------------------ */

export type SpellcastingPlan = {
  /** Cantrips to choose. Always known, never prepared. */
  cantrips: number;
  /** Levelled spells to choose. */
  spells: number;
  /**
   * Prepared casters choose from their whole class list each day and can swap
   * on a rest; known casters learn a fixed few. The distinction matters to the
   * builder only in the wording it shows.
   */
  prepares: boolean;
};

/**
 * How many spells this class picks at level 1.
 *
 * `cantrips_known` and `spells_known` come from the SRD level document. Prepared
 * casters have no `spells_known` there — the SRD gives their count as prose,
 * "Wisdom modifier + cleric level" — so that one formula is applied here.
 */
export function spellcastingPlan(params: {
  classIndex: string;
  level: number;
  cantripsKnown: number;
  spellsKnown?: number;
  castingModifier: number;
}): SpellcastingPlan | null {
  if (params.cantripsKnown === 0 && params.spellsKnown === undefined) {
    // Wizards have no cantrips_known of 0; a class with neither does not cast.
    if (params.cantripsKnown === 0) return null;
  }

  if (params.spellsKnown !== undefined) {
    return { cantrips: params.cantripsKnown, spells: params.spellsKnown, prepares: false };
  }

  // Prepared casters: modifier + level, minimum one.
  const prepared = Math.max(1, params.castingModifier + params.level);
  // A wizard's spellbook starts with six spells; they prepare from it.
  const known = params.classIndex === "wizard" ? 6 : prepared;
  return { cantrips: params.cantripsKnown, spells: known, prepares: true };
}
