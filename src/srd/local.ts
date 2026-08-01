import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  SrdClass,
  SrdCondition,
  SrdEquipment,
  SrdEquipmentCategory,
  SrdLevel,
  SrdMonster,
  SrdProficiency,
  SrdRace,
  SrdSkill,
  SrdSpell,
  SrdSubrace,
  SrdTrait,
} from "./types";

/**
 * Reads the vendored SRD snapshot straight off disk.
 *
 * The database copy is what the app queries at runtime (it can filter and
 * paginate); this loader exists so the rules engine and its tests can work
 * against the same documents with no database at all.
 */

const DATA_DIR = join(process.cwd(), "data", "srd", "2014");
const cache = new Map<string, unknown>();

function load<T>(file: string): T[] {
  const hit = cache.get(file);
  if (hit) return hit as T[];
  const parsed = JSON.parse(readFileSync(join(DATA_DIR, `${file}.json`), "utf8"));
  const docs = Array.isArray(parsed) ? parsed : [parsed];
  cache.set(file, docs);
  return docs as T[];
}

export const srd = {
  classes: () => load<SrdClass>("5e-SRD-Classes"),
  races: () => load<SrdRace>("5e-SRD-Races"),
  subraces: () => load<SrdSubrace>("5e-SRD-Subraces"),
  levels: () => load<SrdLevel>("5e-SRD-Levels"),
  equipment: () => load<SrdEquipment>("5e-SRD-Equipment"),
  equipmentCategories: () => load<SrdEquipmentCategory>("5e-SRD-Equipment-Categories"),
  skills: () => load<SrdSkill>("5e-SRD-Skills"),
  proficiencies: () => load<SrdProficiency>("5e-SRD-Proficiencies"),
  spells: () => load<SrdSpell>("5e-SRD-Spells"),
  monsters: () => load<SrdMonster>("5e-SRD-Monsters"),
  conditions: () => load<SrdCondition>("5e-SRD-Conditions"),
  traits: () => load<SrdTrait>("5e-SRD-Traits"),
};

const byIndex = <T extends { index: string }>(docs: T[], index: string): T => {
  const doc = docs.find((d) => d.index === index);
  if (!doc) throw new Error(`No SRD document with index "${index}"`);
  return doc;
};

export const srdGet = {
  class: (index: string) => byIndex(srd.classes(), index),
  race: (index: string) => byIndex(srd.races(), index),
  subrace: (index: string) => byIndex(srd.subraces(), index),
  trait: (index: string) => byIndex(srd.traits(), index),
  equipment: (index: string) => byIndex(srd.equipment(), index),
  spell: (index: string) => byIndex(srd.spells(), index),
  monster: (index: string) => byIndex(srd.monsters(), index),
  /** The `srd_levels` document for a class at a level, e.g. ("wizard", 5). */
  level: (classIndex: string, level: number) =>
    byIndex(srd.levels(), `${classIndex}-${level}`),
};
