import type { SrdRace, SrdSubrace, SrdTrait } from "@/srd/types";

/**
 * Racial traits.
 *
 * Most of what a trait grants is machine-readable in the SRD documents: Keen
 * Senses lists `skill-perception`, Dwarven Combat Training lists four weapon
 * proficiencies. Those are read straight out of the data and never transcribed.
 *
 * Two traits carry their mechanics only in English prose — "your hit point
 * maximum increases by 1", "you have resistance to fire damage" — with nothing
 * structured to read. For those two, and only those, the *numbers* live in
 * TRAIT_MECHANICS below while the descriptive text still comes from the SRD
 * file. This is the same split the conditions module makes.
 *
 * High Elf Cantrip is deliberately not among them: its count and its eight
 * allowed spells are both in `trait_specific.spell_options`, so transcribing
 * "one extra cantrip" was both unnecessary and wrong — it let a cleric take a
 * fourth cleric cantrip instead of the wizard cantrip the trait grants.
 */

export type TraitMechanics = {
  /** Extra maximum hit points per character level (Dwarven Toughness). */
  hpPerLevel?: number;
  /** Damage types this trait grants resistance to (Hellish Resistance). */
  resistances?: string[];
};

/**
 * Only traits whose numbers are absent from the structured data appear here.
 * Anything with a `proficiencies` array is handled by the data path instead.
 */
export const TRAIT_MECHANICS: Record<string, TraitMechanics> = {
  "dwarven-toughness": { hpPerLevel: 1 },
  "hellish-resistance": { resistances: ["fire"] },
};

/** Every trait index a character has, from its race and its subrace. */
export function traitIndexesFor(race: SrdRace, subrace?: SrdSubrace | null): string[] {
  const indexes = [
    ...(race.traits ?? []).map((t) => t.index),
    ...(subrace?.racial_traits ?? []).map((t) => t.index),
  ];
  return [...new Set(indexes)];
}

export type ResolvedTraits = {
  /** The trait documents themselves, for display. */
  traits: Pick<SrdTrait, "index" | "name" | "desc">[];
  /** Proficiency indexes granted outright, read from the SRD documents. */
  proficiencies: string[];
  hpPerLevel: number;
  resistances: string[];
  /**
   * Extra spells a trait grants, with the exact list to choose from — High Elf
   * Cantrip is `choose 1` from eight named wizard cantrips. Both the count and
   * the list are structured in the trait document, so neither is transcribed.
   */
  spellChoices: { traitIndex: string; traitName: string; choose: number; options: string[] }[];
};

/**
 * Combines the data-driven grants with the prose-only mechanics into one
 * summary the builder and `deriveCharacter` can both consume.
 */
export function resolveTraits(
  race: SrdRace,
  subrace: SrdSubrace | null | undefined,
  traitDocs: SrdTrait[],
): ResolvedTraits {
  const wanted = new Set(traitIndexesFor(race, subrace));
  const docs = traitDocs.filter((t) => wanted.has(t.index));

  const result: ResolvedTraits = {
    traits: docs.map((t) => ({ index: t.index, name: t.name, desc: t.desc })),
    proficiencies: [],
    hpPerLevel: 0,
    resistances: [],
    spellChoices: [],
  };

  for (const doc of docs) {
    for (const prof of doc.proficiencies ?? []) {
      if (!result.proficiencies.includes(prof.index)) result.proficiencies.push(prof.index);
    }

    const spellOptions = doc.trait_specific?.spell_options;
    if (spellOptions) {
      const options: string[] = [];
      for (const option of spellOptions.from.options ?? []) {
        if (option.item) options.push(option.item.index);
      }
      if (options.length > 0) {
        result.spellChoices.push({
          traitIndex: doc.index,
          traitName: doc.name,
          choose: spellOptions.choose,
          options,
        });
      }
    }

    const mechanics = TRAIT_MECHANICS[doc.index];
    if (!mechanics) continue;
    result.hpPerLevel += mechanics.hpPerLevel ?? 0;
    for (const damage of mechanics.resistances ?? []) {
      if (!result.resistances.includes(damage)) result.resistances.push(damage);
    }
  }

  return result;
}
