import { skillOptionsFor } from "@/rules/build";
import { spellListFor, spellcastingPlan } from "@/rules/spells";
import { equipmentChoicesFor } from "@/rules/equipment";
import { route } from "@/server/http";
import { srd } from "@/srd/local";

/**
 * Everything the character builder needs to render its choices, in one call.
 *
 * The server still re-validates every choice on submit — this endpoint only
 * decides what the form *offers*, never what is legal.
 */

export const dynamic = "force-static";

export const GET = route(async () => {
  const categories = srd.equipmentCategories();
  const allSpells = srd.spells();
  const levels = srd.levels();
  const equipmentNames = new Map(srd.equipment().map((e) => [e.index, e.name]));

  const classes = srd.classes().map((doc) => ({
    index: doc.index,
    name: doc.name,
    hitDie: doc.hit_die,
    savingThrows: doc.saving_throws.map((s) => s.index),
    spellcastingAbility: doc.spellcasting?.spellcasting_ability.index ?? null,
    // The spell list a level-1 caster picks from, plus how many of each they
    // choose. The count depends on the caster's ability modifier for prepared
    // classes, so the form recomputes it as scores change; this is the shape.
    spells: (() => {
      const casting = levels.find((l) => l.index === `${doc.index}-1`)?.spellcasting;
      if (!casting || !doc.spellcasting) return null;
      const list = spellListFor(allSpells, doc.index, 1);
      return {
        cantripsKnown: casting.cantrips_known ?? 0,
        spellsKnown: casting.spells_known ?? null,
        prepares: casting.spells_known === undefined,
        cantrips: list
          .filter((s) => s.level === 0)
          .map((s) => ({ index: s.index, name: s.name, school: s.school.name })),
        level1: list
          .filter((s) => s.level === 1)
          .map((s) => ({
            index: s.index,
            name: s.name,
            school: s.school.name,
            concentration: s.concentration,
          })),
      };
    })(),
    skills: skillOptionsFor(doc),
    equipment: equipmentChoicesFor(doc, categories).map((block) => ({
      ...block,
      options: block.options.map((option) => ({
        ...option,
        picks: option.picks.map((pick) => ({
          ...pick,
          from: pick.from.map((index) => ({
            index,
            name: equipmentNames.get(index) ?? index,
          })),
        })),
      })),
    })),
  }));

  const subracesByRace = new Map<string, { index: string; name: string }[]>();
  for (const sub of srd.subraces()) {
    const list = subracesByRace.get(sub.race.index) ?? [];
    list.push({ index: sub.index, name: sub.name });
    subracesByRace.set(sub.race.index, list);
  }

  const races = srd.races().map((doc) => ({
    index: doc.index,
    name: doc.name,
    speed: doc.speed,
    size: doc.size,
    abilityBonuses: doc.ability_bonuses.map((b) => ({
      ability: b.ability_score.index,
      bonus: b.bonus,
    })),
    subraces: subracesByRace.get(doc.index) ?? [],
    proficiencyChoice: doc.starting_proficiency_options
      ? {
          choose: doc.starting_proficiency_options.choose,
          options: (doc.starting_proficiency_options.from.options ?? [])
            .map((o) => o.item?.index)
            .filter((i): i is string => Boolean(i)),
        }
      : null,
  }));

  const skills = srd.skills().map((doc) => ({
    index: doc.index,
    name: doc.name,
    ability: doc.ability_score.index,
  }));

  return Response.json({ classes, races, skills });
});
