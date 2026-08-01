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
  /** Damage that simply lands, with no attack roll and no save: Magic Missile. */
  | { kind: "auto" }
  /** The engine will not guess; the DM rules on it. */
  | { kind: "adjudicate" }
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

  // Ten SRD spells carry damage dice with no `attack_type` and no `dc`. Exactly
  // one of them — Magic Missile — actually hits automatically. For the rest the
  // structured fields are incomplete: their description states an attack or a
  // save that the machine-readable fields omit, and Sleep's dice are not damage
  // at all but the pool of hit points it puts to sleep. Treating the whole set
  // as auto-damage turned Sleep into a 5d8 force nuke that beat Fireball.
  //
  // See SHAPE_FROM_DESCRIPTION for how each is classified from the SRD text.
  if (spell.damage?.damage_at_slot_level || spell.damage?.damage_at_character_level) {
    const override = SHAPE_FROM_DESCRIPTION[spell.index];
    if (override) return override;
    return { kind: "auto" };
  }
  return { kind: "utility" };
}

/**
 * Spells whose mechanics are in the SRD `desc` but not in its structured fields.
 *
 * Every entry is justified by that spell's own description in the vendored
 * data, quoted below. Nothing here is invented: it is the same prose-to-number
 * split the conditions and traits modules make, applied to the handful of
 * spells the dataset under-describes.
 *
 * `adjudicate` means the engine will not guess. It spends the slot, records the
 * cast, and hands the DM a ruling — house rule 2's escalation path — rather than
 * inventing a number the rules do not support.
 */
const SHAPE_FROM_DESCRIPTION: Record<string, SpellShape> = {
  // "roll 5d8; the total is how many hit points of creatures this spell can
  // affect" — a pool, not damage, and the SRD gives it no damage_type at all.
  sleep: { kind: "adjudicate" },
  // "each creature ... must make a Dexterity saving throw ... half as much on a
  // successful one"
  "call-lightning": { kind: "save", ability: "dex", onSuccess: "half" },
  "flaming-sphere": { kind: "save", ability: "dex", onSuccess: "half" },
  // "Make a ranged spell attack for each ray." The engine resolves one attack,
  // so three rays go to the DM rather than being quietly under-resolved.
  "scorching-ray": { kind: "adjudicate" },
  // Damage only on a specific contingency (teleporting into an occupied space).
  "dimension-door": { kind: "adjudicate" },
  // Self-range buffs: the dice apply to future weapon hits, not to a target now.
  "branding-smite": { kind: "adjudicate" },
  "divine-favor": { kind: "adjudicate" },
  "fire-shield": { kind: "adjudicate" },
  "flame-blade": { kind: "adjudicate" },
};

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
