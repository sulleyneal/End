import { applyLevelUps, getCharacterSheet } from "@/server/characters";
import { db } from "@/db";
import { characters, spellSlots } from "@/db/schema";
import { eq } from "drizzle-orm";

const id = process.argv[2];
const xp = Number(process.argv[3]);
await db.update(characters).set({ xp }).where(eq(characters.id, id));
const before = await getCharacterSheet(id);
const gained = await applyLevelUps(id);
const after = await getCharacterSheet(id);
const slots = await db.select().from(spellSlots).where(eq(spellSlots.characterId, id));
console.log(JSON.stringify({
  name: before.name, class: before.class, xp,
  before: { level: before.level, hpMax: before.hpMax, hpCurrent: before.hpCurrent, hitDice: before.hitDiceRemaining, prof: before.derived.proficiencyBonus },
  gained,
  after: { level: after.level, hpMax: after.hpMax, hpCurrent: after.hpCurrent, hitDice: after.hitDiceRemaining, prof: after.derived.proficiencyBonus, effHpMax: after.derived.effectiveHpMax },
  slots: slots.map(s => ({ level: s.level, max: s.max, used: s.used })).sort((a,b)=>a.level-b.level),
  spellsKnown: after.spells.length,
  saveDc: after.derived.spellcasting?.saveDc ?? null,
}, null, 0));
