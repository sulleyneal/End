import {
  ABILITIES,
  type AbilityKey,
  type SrdChoice,
  type SrdClass,
  type SrdEquipment,
  type SrdEquipmentCategory,
  type SrdLevel,
  type SrdOption,
  type SrdRace,
  type SrdSpell,
  type SrdSubrace,
  type SrdTrait,
} from "@/srd/types";
import { abilityModifier } from "./character";
import { type Rng, cryptoRng } from "./dice";
import { type EquipmentSelection, resolveStartingEquipment } from "./equipment";
import { resolveTraits } from "./traits";
import { spellListFor, spellcastingPlan } from "./spells";

/**
 * Legal character construction.
 *
 * The server builds characters; the client only sends choices. Every choice is
 * checked against the SRD document that offers it, so a hand-crafted request
 * cannot produce a wizard in plate armour or a rogue with six skills.
 */

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

/** PHB point-buy costs for scores 8-15. */
const POINT_BUY_COST: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};
export const POINT_BUY_BUDGET = 27;

export type AbilityScores = Record<AbilityKey, number>;
export type ScoreMethod = "standard-array" | "point-buy" | "rolled" | "manual";

export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildError";
  }
}

/** Rejects score sets that do not match the declared generation method. */
export function validateAbilityScores(scores: AbilityScores, method: ScoreMethod): void {
  for (const key of ABILITIES) {
    const value = scores[key];
    if (!Number.isInteger(value) || value < 3 || value > 18) {
      throw new BuildError(`${key.toUpperCase()} of ${value} is outside the legal range 3-18.`);
    }
  }

  if (method === "standard-array") {
    const sorted = ABILITIES.map((k) => scores[k]).sort((a, b) => b - a);
    const expected = [...STANDARD_ARRAY];
    if (sorted.join(",") !== expected.join(",")) {
      throw new BuildError(
        `Standard array must use exactly ${expected.join(", ")} — got ${sorted.join(", ")}.`,
      );
    }
    return;
  }

  // A rolled set is checked against what the server actually rolled, which the
  // caller passes in — there is nothing to validate from the numbers alone.
  if (method === "rolled") return;

  if (method === "point-buy") {
    let spent = 0;
    for (const key of ABILITIES) {
      const cost = POINT_BUY_COST[scores[key]];
      if (cost === undefined) {
        throw new BuildError(
          `Point buy allows scores 8-15 before racial bonuses; ${key.toUpperCase()} is ${scores[key]}.`,
        );
      }
      spent += cost;
    }
    if (spent > POINT_BUY_BUDGET) {
      throw new BuildError(`Point buy costs ${spent} points, over the ${POINT_BUY_BUDGET} allowed.`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Choice resolution
 * ------------------------------------------------------------------ */

function optionIndexes(options: SrdOption[] | undefined): string[] {
  const out: string[] = [];
  for (const option of options ?? []) {
    if (option.item) out.push(option.item.index);
    if (option.of) out.push(option.of.index);
    if (option.choice?.from.options) out.push(...optionIndexes(option.choice.from.options));
  }
  return out;
}

/** Validates a set of picks against a single SRD choice block. */
export function resolveChoice(choice: SrdChoice, picks: string[], label: string): string[] {
  const unique = [...new Set(picks)];
  if (unique.length !== picks.length) {
    throw new BuildError(`${label}: the same option was chosen twice.`);
  }
  if (picks.length !== choice.choose) {
    throw new BuildError(`${label}: choose exactly ${choice.choose}, got ${picks.length}.`);
  }
  const allowed = new Set(optionIndexes(choice.from.options));
  for (const pick of picks) {
    if (!allowed.has(pick)) {
      throw new BuildError(`${label}: "${pick}" is not one of the available options.`);
    }
  }
  return picks;
}

/* ------------------------------------------------------------------ *
 * Building
 * ------------------------------------------------------------------ */

export type BuildRequest = {
  name: string;
  classIndex: string;
  raceIndex: string;
  subraceIndex?: string | null;
  background?: string;
  alignment?: string;
  scores: AbilityScores;
  scoreMethod: ScoreMethod;
  /** Proficiency indexes chosen from the class's skill choice block, e.g. "skill-stealth". */
  skillChoices: string[];
  /** Proficiency indexes chosen from the race's choice block, when it has one. */
  raceProficiencyChoices?: string[];
  /** One branch per class starting-equipment block. */
  equipmentSelections?: EquipmentSelection[];
  /** Cantrip indexes, for a class that knows cantrips. */
  cantripChoices?: string[];
  /** Levelled spell indexes: known spells, or a wizard's opening spellbook. */
  spellChoices?: string[];
  /** Spells granted by a racial trait, e.g. the High Elf Cantrip. */
  traitSpellChoices?: string[];
};

export type BuiltCharacter = {
  character: {
    name: string;
    race: string;
    subrace: string | null;
    class: string;
    background: string | null;
    alignment: string | null;
    level: number;
    xp: number;
    str: number;
    dex: number;
    con: number;
    int: number;
    wis: number;
    cha: number;
    hpCurrent: number;
    hpMax: number;
    tempHp: number;
    hitDiceRemaining: number;
  };
  proficiencies: { kind: string; proficiencyIndex: string; source: string }[];
  items: { itemIndex: string; quantity: number; equipped: boolean }[];
  spellSlots: { level: number; max: number; used: number }[];
  spells: { spellIndex: string; prepared: boolean; alwaysPrepared: boolean }[];
};

const kindOf = (index: string): string => {
  if (index.startsWith("skill-")) return "skill";
  if (index.startsWith("saving-throw-")) return "saving-throw";
  if (index.endsWith("-armor") || index === "shields" || index === "all-armor") return "armor";
  return "other";
};

export type BuildContext = {
  classDoc: SrdClass;
  raceDoc: SrdRace;
  subraceDoc?: SrdSubrace | null;
  levelDoc?: SrdLevel | null;
  /** Needed to resolve "a martial weapon" style equipment choices. */
  equipmentCategories?: Pick<SrdEquipmentCategory, "index" | "equipment">[];
  /** Racial trait documents, the source of trait-granted proficiencies. */
  traitDocs?: SrdTrait[];
  /** The class's spell list, needed to validate cantrip and spell picks. */
  spellDocs?: SrdSpell[];
  /** Armour lookup, so the starting kit can be worn rather than carried. */
  equipmentDocs?: Pick<
    SrdEquipment,
    "index" | "armor_category" | "equipment_category" | "weapon_range"
  >[];
};

/**
 * Builds a legal level-1 character. Throws `BuildError` with a player-readable
 * message on any illegal choice rather than silently correcting it.
 */
export function buildLevel1Character(
  request: BuildRequest,
  ctx: BuildContext,
): BuiltCharacter {
  validateAbilityScores(request.scores, request.scoreMethod);

  if (request.subraceIndex) {
    const belongs = (ctx.raceDoc.subraces ?? []).some((s) => s.index === request.subraceIndex);
    if (!belongs) {
      throw new BuildError(
        `${ctx.raceDoc.name} has no subrace "${request.subraceIndex}".`,
      );
    }
  }

  const proficiencies: BuiltCharacter["proficiencies"] = [];
  const add = (index: string, source: string) => {
    if (proficiencies.some((p) => p.proficiencyIndex === index)) return;
    proficiencies.push({ kind: kindOf(index), proficiencyIndex: index, source });
  };

  // Saving throws and the class's fixed armour/weapon/tool proficiencies.
  for (const save of ctx.classDoc.saving_throws) add(`saving-throw-${save.index}`, "class");
  for (const prof of ctx.classDoc.proficiencies ?? []) add(prof.index, "class");

  // Skill choices, validated against the class's own choice block.
  const skillBlock = (ctx.classDoc.proficiency_choices ?? []).find((choice) =>
    optionIndexes(choice.from.options).some((i) => i.startsWith("skill-")),
  );
  if (skillBlock) {
    for (const pick of resolveChoice(skillBlock, request.skillChoices, "Class skills")) {
      add(pick, "class-choice");
    }
  } else if (request.skillChoices.length > 0) {
    throw new BuildError(`${ctx.classDoc.name} does not choose skill proficiencies.`);
  }

  // Race and subrace proficiencies.
  for (const prof of ctx.raceDoc.starting_proficiencies ?? []) add(prof.index, "race");
  for (const prof of ctx.subraceDoc?.starting_proficiencies ?? []) add(prof.index, "subrace");
  if (ctx.raceDoc.starting_proficiency_options) {
    for (const pick of resolveChoice(
      ctx.raceDoc.starting_proficiency_options,
      request.raceProficiencyChoices ?? [],
      `${ctx.raceDoc.name} proficiencies`,
    )) {
      add(pick, "race-choice");
    }
  } else if ((request.raceProficiencyChoices ?? []).length > 0) {
    throw new BuildError(`${ctx.raceDoc.name} does not choose extra proficiencies.`);
  }

  // Trait-granted proficiencies: Keen Senses, Dwarven Combat Training, Elf
  // Weapon Training and friends. These are listed in the SRD trait documents,
  // so nothing is transcribed — without this a high elf reaches the table
  // without Perception and a dwarf without their weapon training.
  const traits = resolveTraits(ctx.raceDoc, ctx.subraceDoc, ctx.traitDocs ?? []);
  for (const prof of traits.proficiencies) add(prof, "race-trait");

  // Racial bonuses are applied by deriveCharacter, but HP needs the final Con now.
  let conBonus = 0;
  for (const bonus of ctx.raceDoc.ability_bonuses ?? []) {
    if (bonus.ability_score.index === "con") conBonus += bonus.bonus;
  }
  for (const bonus of ctx.subraceDoc?.ability_bonuses ?? []) {
    if (bonus.ability_score.index === "con") conBonus += bonus.bonus;
  }
  const conMod = abilityModifier(request.scores.con + conBonus);

  // Level 1 HP is the maximum hit die plus the Constitution modifier (PHB 12).
  const hpMax = Math.max(1, ctx.classDoc.hit_die + conMod + traits.hpPerLevel);

  // Starting kit: the class's fixed items plus one resolved branch per choice
  // block. Armour and shields come out worn, and the character draws one melee
  // and one ranged weapon.
  //
  // Leaving every weapon sheathed is what a cautious reading of "in the pack"
  // implies, but attacks are derived only from equipped weapons — so a fighter
  // who starts with a battleaxe in the pack has no attacks at all, and there is
  // no draw-weapon control for them to fix it with. A character arrives at the
  // table ready to fight.
  const resolved = resolveStartingEquipment(
    ctx.classDoc,
    request.equipmentSelections ?? [],
    ctx.equipmentCategories ?? [],
  );
  const docsByIndex = new Map((ctx.equipmentDocs ?? []).map((doc) => [doc.index, doc]));

  let meleeDrawn = false;
  let rangedDrawn = false;
  const items: BuiltCharacter["items"] = resolved.map((item) => {
    const doc = docsByIndex.get(item.itemIndex);

    if (doc?.armor_category !== undefined) {
      return { itemIndex: item.itemIndex, quantity: item.quantity, equipped: true };
    }

    if (doc?.equipment_category?.index === "weapon") {
      if (doc.weapon_range === "Melee" && !meleeDrawn) {
        meleeDrawn = true;
        return { itemIndex: item.itemIndex, quantity: item.quantity, equipped: true };
      }
      if (doc.weapon_range === "Ranged" && !rangedDrawn) {
        rangedDrawn = true;
        return { itemIndex: item.itemIndex, quantity: item.quantity, equipped: true };
      }
    }

    return { itemIndex: item.itemIndex, quantity: item.quantity, equipped: false };
  });

  const spellSlots: BuiltCharacter["spellSlots"] = [];
  const casting = ctx.levelDoc?.spellcasting;
  if (casting) {
    for (let level = 1; level <= 9; level++) {
      const max = (casting as Record<string, number | undefined>)[`spell_slots_level_${level}`] ?? 0;
      if (max > 0) spellSlots.push({ level, max, used: 0 });
    }
  }

  /* --- Spells known and prepared --- */
  const spells: BuiltCharacter["spells"] = [];
  const castingAbility = ctx.classDoc.spellcasting?.spellcasting_ability?.index as
    | AbilityKey
    | undefined;

  if (casting && castingAbility) {
    const abilityScore =
      request.scores[castingAbility] +
      (ctx.raceDoc.ability_bonuses ?? [])
        .filter((b) => b.ability_score.index === castingAbility)
        .reduce((sum, b) => sum + b.bonus, 0) +
      (ctx.subraceDoc?.ability_bonuses ?? [])
        .filter((b) => b.ability_score.index === castingAbility)
        .reduce((sum, b) => sum + b.bonus, 0);

    const plan = spellcastingPlan({
      classIndex: request.classIndex,
      level: 1,
      cantripsKnown: casting.cantrips_known ?? 0,
      spellsKnown: casting.spells_known,
      castingModifier: abilityModifier(abilityScore),
    });

    if (plan) {
      const list = spellListFor(ctx.spellDocs ?? [], request.classIndex, 1);
      const cantripOptions = new Set(list.filter((s) => s.level === 0).map((s) => s.index));
      const spellOptions = new Set(list.filter((s) => s.level === 1).map((s) => s.index));

      const cantrips = [...new Set(request.cantripChoices ?? [])];
      if (cantrips.length !== plan.cantrips) {
        throw new BuildError(
          `${ctx.classDoc.name} chooses exactly ${plan.cantrips} cantrip${
            plan.cantrips === 1 ? "" : "s"
          }; got ${cantrips.length}.`,
        );
      }
      for (const index of cantrips) {
        if (!cantripOptions.has(index)) {
          throw new BuildError(`"${index}" is not a ${ctx.classDoc.name} cantrip.`);
        }
        spells.push({ spellIndex: index, prepared: true, alwaysPrepared: true });
      }

      const chosen = [...new Set(request.spellChoices ?? [])];
      if (chosen.length !== plan.spells) {
        throw new BuildError(
          `${ctx.classDoc.name} chooses exactly ${plan.spells} level 1 spell${
            plan.spells === 1 ? "" : "s"
          }; got ${chosen.length}.`,
        );
      }
      for (const index of chosen) {
        if (!spellOptions.has(index)) {
          throw new BuildError(`"${index}" is not a level 1 ${ctx.classDoc.name} spell.`);
        }
        spells.push({ spellIndex: index, prepared: true, alwaysPrepared: false });
      }
    }
  } else if ((request.cantripChoices ?? []).length || (request.spellChoices ?? []).length) {
    throw new BuildError(`${ctx.classDoc.name} does not cast spells at level 1.`);
  }

  // Trait-granted spells are chosen from the trait's own list, not the class's.
  // High Elf Cantrip grants one wizard cantrip; folding it into the class count
  // let a high elf cleric take a fourth *cleric* cantrip instead.
  const traitPicks = [...new Set(request.traitSpellChoices ?? [])];
  const traitWanted = traits.spellChoices.reduce((sum, c) => sum + c.choose, 0);
  if (traitPicks.length !== traitWanted) {
    throw new BuildError(
      traitWanted === 0
        ? `${ctx.raceDoc.name} grants no extra spells.`
        : `${traits.spellChoices.map((c) => c.traitName).join(" and ")}: choose exactly ${traitWanted}, got ${traitPicks.length}.`,
    );
  }
  for (const choice of traits.spellChoices) {
    for (const pick of traitPicks) {
      if (!choice.options.includes(pick)) {
        throw new BuildError(`"${pick}" is not offered by ${choice.traitName}.`);
      }
    }
  }
  for (const pick of traitPicks) {
    if (spells.some((s) => s.spellIndex === pick)) continue;
    spells.push({ spellIndex: pick, prepared: true, alwaysPrepared: true });
  }

  return {
    spells,
    character: {
      name: request.name.trim(),
      race: request.raceIndex,
      subrace: request.subraceIndex ?? null,
      class: request.classIndex,
      background: request.background ?? null,
      alignment: request.alignment ?? null,
      level: 1,
      xp: 0,
      str: request.scores.str,
      dex: request.scores.dex,
      con: request.scores.con,
      int: request.scores.int,
      wis: request.scores.wis,
      cha: request.scores.cha,
      hpCurrent: hpMax,
      hpMax,
      tempHp: 0,
      hitDiceRemaining: 1,
    },
    proficiencies,
    items,
    spellSlots,
  };
}

/** The skill choice block for a class, so the UI can render the right options. */
export function skillOptionsFor(classDoc: SrdClass): { choose: number; options: string[] } | null {
  const block = (classDoc.proficiency_choices ?? []).find((choice) =>
    optionIndexes(choice.from.options).some((i) => i.startsWith("skill-")),
  );
  if (!block) return null;
  return {
    choose: block.choose,
    options: optionIndexes(block.from.options).filter((i) => i.startsWith("skill-")),
  };
}

/* ------------------------------------------------------------------ *
 * Suggested ability arrangement
 * ------------------------------------------------------------------ */

/**
 * Which abilities each class wants, best first.
 *
 * This is advice, not a rule — every class can legally put any score anywhere,
 * and the builder lets a player rearrange freely. It exists so that picking
 * "barbarian" does not leave you staring at six empty boxes wondering where the
 * 15 goes.
 *
 * It is written by hand because the SRD does not record a class's primary
 * ability anywhere: `spellcasting_ability` covers only casters, and saving-throw
 * proficiencies mislead for monks and paladins. No rules content is being
 * transcribed here — nothing below changes what is legal.
 */
export const SUGGESTED_ABILITY_ORDER: Record<string, AbilityKey[]> = {
  barbarian: ["str", "con", "dex", "wis", "cha", "int"],
  bard: ["cha", "dex", "con", "wis", "int", "str"],
  cleric: ["wis", "con", "str", "cha", "dex", "int"],
  druid: ["wis", "con", "dex", "int", "cha", "str"],
  fighter: ["str", "con", "dex", "wis", "cha", "int"],
  monk: ["dex", "wis", "con", "str", "cha", "int"],
  paladin: ["str", "cha", "con", "wis", "dex", "int"],
  ranger: ["dex", "wis", "con", "str", "int", "cha"],
  rogue: ["dex", "int", "con", "wis", "cha", "str"],
  sorcerer: ["cha", "con", "dex", "wis", "int", "str"],
  warlock: ["cha", "con", "dex", "wis", "int", "str"],
  wizard: ["int", "con", "dex", "wis", "cha", "str"],
};

/**
 * Lays a set of scores out across the abilities, best score to the ability the
 * class wants most — then nudges for the race.
 *
 * Racial bonuses are applied after assignment, so a +2 already lands on the
 * ability it lands on. What matters is the *odd* scores: a 15 with a +2 becomes
 * 17, which is the same modifier as 16, so the spare point is wasted. Where two
 * abilities are close in priority and one carries a racial bonus, this prefers
 * the arrangement that does not throw a point away.
 */
export function suggestAssignment(params: {
  classIndex: string;
  scores: number[];
  racialBonuses: Partial<Record<AbilityKey, number>>;
}): Record<AbilityKey, number> {
  const order = SUGGESTED_ABILITY_ORDER[params.classIndex] ?? [...ABILITIES];
  const pool = [...params.scores].sort((a, b) => b - a);

  const assignment = {} as Record<AbilityKey, number>;
  order.forEach((ability, i) => {
    assignment[ability] = pool[i] ?? 10;
  });

  // Look for a swap between neighbouring priorities that raises the total of
  // the final modifiers — that is exactly the wasted-odd-point case.
  const finalModifier = (ability: AbilityKey, score: number) =>
    Math.floor((score + (params.racialBonuses[ability] ?? 0) - 10) / 2);

  for (let i = 0; i < order.length - 1; i++) {
    const a = order[i];
    const b = order[i + 1];
    const now = finalModifier(a, assignment[a]) + finalModifier(b, assignment[b]);
    const swapped = finalModifier(a, assignment[b]) + finalModifier(b, assignment[a]);
    if (swapped > now) {
      const keep = assignment[a];
      assignment[a] = assignment[b];
      assignment[b] = keep;
    }
  }

  return assignment;
}

/**
 * Rolls a set of ability scores: 4d6, drop the lowest, six times (PHB 13).
 *
 * The dice come from the caller's RNG, which server-side is `crypto.randomInt`.
 * Every face is returned, including the one dropped, so the roll can be shown
 * to the table and audited later — a rolled character should be as inspectable
 * as a rolled attack.
 */
export function rollAbilityScores(rng: Rng = cryptoRng): {
  scores: number[];
  rolls: { dice: number[]; dropped: number; total: number }[];
} {
  const rolls: { dice: number[]; dropped: number; total: number }[] = [];

  for (let i = 0; i < 6; i++) {
    const dice = [rng(6), rng(6), rng(6), rng(6)];
    const sorted = [...dice].sort((a, b) => a - b);
    const dropped = sorted[0];
    const total = sorted.slice(1).reduce((sum, d) => sum + d, 0);
    rolls.push({ dice, dropped, total });
  }

  // Sorted together, so scores[i] is the total of rolls[i]. Sorting only the
  // totals left the two arrays disagreeing, and any display pairing them by
  // index attributed the wrong dice to the wrong score.
  rolls.sort((a, b) => b.total - a.total);

  return { scores: rolls.map((r) => r.total), rolls };
}
