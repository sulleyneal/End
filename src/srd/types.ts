/** Shapes of the 5e-bits SRD 5.1 documents, narrowed to the fields the engine reads. */

export type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

export const ABILITIES: AbilityKey[] = ["str", "dex", "con", "int", "wis", "cha"];

export const ABILITY_NAMES: Record<AbilityKey, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

export type SrdRef = { index: string; name: string; url?: string };

export type SrdClass = {
  index: string;
  name: string;
  hit_die: number;
  saving_throws: SrdRef[];
  proficiencies?: SrdRef[];
  proficiency_choices?: SrdChoice[];
  starting_equipment?: { equipment: SrdRef; quantity: number }[];
  starting_equipment_options?: SrdChoice[];
  spellcasting?: {
    level: number;
    spellcasting_ability: SrdRef;
  };
  subclasses?: SrdRef[];
};

export type SrdChoice = {
  desc?: string;
  choose: number;
  type: string;
  from: {
    option_set_type: string;
    options?: SrdOption[];
    equipment_category?: SrdRef;
  };
};

export type SrdOption = {
  option_type: string;
  item?: SrdRef;
  count?: number;
  of?: SrdRef;
  choice?: SrdChoice;
};

export type SrdRace = {
  index: string;
  name: string;
  speed: number;
  size: string;
  ability_bonuses: { ability_score: SrdRef; bonus: number }[];
  starting_proficiencies?: SrdRef[];
  starting_proficiency_options?: SrdChoice;
  languages?: SrdRef[];
  traits?: SrdRef[];
  subraces?: SrdRef[];
};

export type SrdSubrace = {
  index: string;
  name: string;
  race: SrdRef;
  ability_bonuses: { ability_score: SrdRef; bonus: number }[];
  starting_proficiencies?: SrdRef[];
  racial_traits?: SrdRef[];
};

export type SrdLevel = {
  index: string;
  level: number;
  prof_bonus?: number;
  class: SrdRef;
  subclass?: SrdRef;
  ability_score_bonuses?: number;
  features?: SrdRef[];
  spellcasting?: {
    cantrips_known?: number;
    spells_known?: number;
    spell_slots_level_1?: number;
    spell_slots_level_2?: number;
    spell_slots_level_3?: number;
    spell_slots_level_4?: number;
    spell_slots_level_5?: number;
    spell_slots_level_6?: number;
    spell_slots_level_7?: number;
    spell_slots_level_8?: number;
    spell_slots_level_9?: number;
  };
  class_specific?: Record<string, unknown>;
};

export type SrdArmorClass = { base: number; dex_bonus: boolean; max_bonus?: number };

export type SrdEquipment = {
  index: string;
  name: string;
  equipment_category: SrdRef;
  weight?: number;
  cost?: { quantity: number; unit: string };

  // Armor
  armor_category?: "Light" | "Medium" | "Heavy" | "Shield";
  armor_class?: SrdArmorClass;
  str_minimum?: number;
  stealth_disadvantage?: boolean;

  // Weapon
  weapon_category?: string;
  weapon_range?: "Melee" | "Ranged";
  category_range?: string;
  damage?: { damage_dice: string; damage_type: SrdRef };
  two_handed_damage?: { damage_dice: string; damage_type: SrdRef };
  range?: { normal: number; long?: number };
  throw_range?: { normal: number; long: number };
  properties?: SrdRef[];
};

export type SrdProficiency = {
  index: string;
  name: string;
  type:
    | "Armor"
    | "Weapons"
    | "Skills"
    | "Saving Throws"
    | "Artisan's Tools"
    | "Gaming Sets"
    | "Musical Instruments"
    | "Vehicles"
    | "Other";
  /** Points at the equipment, equipment-category, skill or ability this grants. */
  reference?: SrdRef;
};

export type SrdSkill = {
  index: string;
  name: string;
  ability_score: SrdRef;
};

export type SrdSpell = {
  index: string;
  name: string;
  level: number;
  school: SrdRef;
  casting_time: string;
  range: string;
  duration: string;
  concentration: boolean;
  ritual: boolean;
  components: string[];
  desc: string[];
  higher_level?: string[];
  attack_type?: "melee" | "ranged";
  damage?: {
    damage_type?: SrdRef;
    damage_at_slot_level?: Record<string, string>;
    damage_at_character_level?: Record<string, string>;
  };
  heal_at_slot_level?: Record<string, string>;
  dc?: { dc_type: SrdRef; dc_success: string };
  area_of_effect?: { type: string; size: number };
  classes?: SrdRef[];
};

export type SrdMonster = {
  index: string;
  name: string;
  size: string;
  type: string;
  alignment: string;
  armor_class: { type: string; value: number }[];
  hit_points: number;
  hit_dice: string;
  hit_points_roll?: string;
  speed: Record<string, string | boolean>;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  proficiencies: { value: number; proficiency: SrdRef }[];
  damage_vulnerabilities: string[];
  damage_resistances: string[];
  damage_immunities: string[];
  condition_immunities: SrdRef[];
  senses: Record<string, string | number>;
  languages: string;
  challenge_rating: number;
  xp: number;
  actions?: MonsterAction[];
  special_abilities?: MonsterAction[];
  legendary_actions?: MonsterAction[];
  reactions?: MonsterAction[];
};

export type MonsterAction = {
  name: string;
  desc: string;
  attack_bonus?: number;
  damage?: {
    damage_type?: SrdRef;
    damage_dice?: string;
  }[];
  dc?: { dc_type: SrdRef; dc_value: number; success_type: string };
  usage?: { type: string; times?: number; dice?: string; min_value?: number };
};

export type SrdCondition = {
  index: string;
  name: string;
  desc: string[];
};
