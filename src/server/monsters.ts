import { averageOf } from "@/rules/dice";
import type { SrdMonster } from "@/srd/types";
import type { DerivedAttack } from "@/rules/character";
import { abilityModifier } from "@/rules/character";

/**
 * Turns an SRD stat block into the same shape a player character presents to
 * the combat engine, so `resolveAttack` and `applyDamage` never need to know
 * whether they are looking at a hero or a hobgoblin.
 */

export type CombatStats = {
  abilities: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  saveModifiers: Record<string, number>;
  attacks: DerivedAttack[];
  resistances: string[];
  immunities: string[];
  vulnerabilities: string[];
  conditionImmunities: string[];
  speed: number;
  size: number;
  cr: number;
  xp: number;
};

/** Cells occupied per side. Large creatures take a 2x2, huge a 3x3. */
function sizeToCells(size: string): number {
  switch (size) {
    case "Large":
      return 2;
    case "Huge":
      return 3;
    case "Gargantuan":
      return 4;
    default:
      return 1;
  }
}

function walkSpeed(speed: Record<string, string | boolean>): number {
  const walk = speed.walk;
  if (typeof walk !== "string") return 0;
  const match = walk.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

/**
 * Reads a monster's melee and ranged attacks out of its action list.
 *
 * The SRD gives an attack bonus and damage dice directly, so unlike a
 * character these are not re-derived — the stat block is the authority.
 */
export function monsterAttacks(monster: SrdMonster): DerivedAttack[] {
  const attacks: DerivedAttack[] = [];

  for (const action of monster.actions ?? []) {
    if (action.attack_bonus === undefined) continue;
    const damage = (action.damage ?? []).find((d) => d.damage_dice);
    if (!damage?.damage_dice) continue;

    // "Melee Weapon Attack: +7 to hit, reach 10 ft." — pull the reach or range out of the text.
    const reachMatch = action.desc.match(/reach (\d+)\s*ft/i);
    const rangeMatch = action.desc.match(/range (\d+)\/(\d+)\s*ft/i);
    const isRanged = /ranged weapon attack|ranged spell attack/i.test(action.desc);

    attacks.push({
      name: action.name,
      itemIndex: `monster:${monster.index}:${action.name.toLowerCase().replace(/\s+/g, "-")}`,
      kind: isRanged ? "ranged" : "melee",
      ability: "str",
      proficient: true,
      attackBonus: action.attack_bonus,
      damageDice: damage.damage_dice,
      // The stat block's dice already include the creature's modifier.
      damageBonus: 0,
      damageType: damage.damage_type?.index ?? "bludgeoning",
      reachFt: isRanged ? undefined : reachMatch ? Number(reachMatch[1]) : 5,
      rangeFt: rangeMatch
        ? { normal: Number(rangeMatch[1]), long: Number(rangeMatch[2]) }
        : undefined,
      properties: [],
    });
  }

  return attacks;
}

export function monsterCombatStats(monster: SrdMonster): CombatStats {
  const saveModifiers: Record<string, number> = {};
  for (const entry of monster.proficiencies ?? []) {
    const match = entry.proficiency.index.match(/^saving-throw-(\w+)$/);
    if (match) saveModifiers[match[1]] = entry.value;
  }

  const abilities = {
    str: monster.strength,
    dex: monster.dexterity,
    con: monster.constitution,
    int: monster.intelligence,
    wis: monster.wisdom,
    cha: monster.charisma,
  };

  // Fill in any save the stat block does not list as proficient.
  for (const [key, score] of Object.entries(abilities)) {
    if (saveModifiers[key] === undefined) saveModifiers[key] = abilityModifier(score);
  }

  return {
    abilities,
    saveModifiers,
    attacks: monsterAttacks(monster),
    resistances: monster.damage_resistances ?? [],
    immunities: monster.damage_immunities ?? [],
    vulnerabilities: monster.damage_vulnerabilities ?? [],
    conditionImmunities: (monster.condition_immunities ?? []).map((c) => c.index),
    speed: walkSpeed(monster.speed),
    size: sizeToCells(monster.size),
    cr: monster.challenge_rating,
    xp: monster.xp,
  };
}

/** Average hit points from the stat block's hit dice, so a group of orcs is not identical. */
export function monsterHitPoints(monster: SrdMonster): number {
  return monster.hit_points;
}

export function monsterArmorClass(monster: SrdMonster): number {
  return monster.armor_class?.[0]?.value ?? 10;
}

/** Expected HP for a rolled stat block, used only for display. */
export function monsterAverageHp(monster: SrdMonster): number {
  return monster.hit_points_roll ? Math.floor(averageOf(monster.hit_points_roll)) : monster.hit_points;
}
