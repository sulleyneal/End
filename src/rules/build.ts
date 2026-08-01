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
  type SrdSubrace,
} from "@/srd/types";
import { abilityModifier } from "./character";
import { type EquipmentSelection, resolveStartingEquipment } from "./equipment";

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
export type ScoreMethod = "standard-array" | "point-buy" | "manual";

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
  const hpMax = Math.max(1, ctx.classDoc.hit_die + conMod);

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

  return {
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
