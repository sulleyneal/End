import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  characterItems,
  characterProficiencies,
  characterSpells,
  characters,
  spellSlots,
} from "@/db/schema";
import { type BuildRequest, buildLevel1Character } from "@/rules/build";
import { type DerivedCharacter, deriveCharacter } from "@/rules/character";
import { srd, srdGet } from "@/srd/local";
import { NotFoundError } from "./http";
import { appendEvent } from "./events";

/**
 * Characters are built and read on the server. The client sends *choices*;
 * every derived number on the sheet is recomputed here from base scores,
 * equipment and SRD data on each read, so a tampered request cannot inflate a
 * bonus and stored state can never drift out of agreement with the rules.
 */

export type CharacterSheet = {
  id: string;
  campaignId: string;
  userId: string | null;
  name: string;
  race: string;
  subrace: string | null;
  class: string;
  subclass: string | null;
  background: string | null;
  alignment: string | null;
  level: number;
  xp: number;
  hpCurrent: number;
  hpMax: number;
  tempHp: number;
  hitDiceRemaining: number;
  deathSuccesses: number;
  deathFailures: number;
  stable: boolean;
  conditions: string[];
  exhaustion: number;
  inspiration: boolean;
  notes: string | null;
  /** Display names resolved from the SRD so the client never has to look them up. */
  labels: { race: string; class: string; subrace: string | null };
  slots: { level: number; max: number; used: number }[];
  spells: { spellIndex: string; prepared: boolean; alwaysPrepared: boolean }[];
  items: { itemIndex: string; name: string; quantity: number; equipped: boolean; attuned: boolean }[];
  proficiencies: { kind: string; proficiencyIndex: string; expertise: boolean }[];
  derived: DerivedCharacter;
};

export async function createCharacter(params: {
  campaignId: string;
  userId: string;
  request: BuildRequest;
}): Promise<CharacterSheet> {
  const { request } = params;

  const classDoc = srdGet.class(request.classIndex);
  const raceDoc = srdGet.race(request.raceIndex);
  const subraceDoc = request.subraceIndex ? srdGet.subrace(request.subraceIndex) : null;
  const levelDoc = srd.levels().find((l) => l.index === `${request.classIndex}-1`) ?? null;

  // Throws BuildError on any illegal choice; nothing is written until it passes.
  const built = buildLevel1Character(request, {
    classDoc,
    raceDoc,
    subraceDoc,
    levelDoc,
    equipmentCategories: srd.equipmentCategories(),
    equipmentDocs: srd.equipment(),
  });

  const [row] = await db
    .insert(characters)
    .values({
      ...built.character,
      campaignId: params.campaignId,
      userId: params.userId,
    })
    .returning({ id: characters.id });

  if (built.proficiencies.length > 0) {
    await db.insert(characterProficiencies).values(
      built.proficiencies.map((p) => ({
        characterId: row.id,
        kind: p.kind,
        proficiencyIndex: p.proficiencyIndex,
        source: p.source,
      })),
    );
  }

  if (built.items.length > 0) {
    await db.insert(characterItems).values(
      built.items.map((i) => ({
        characterId: row.id,
        itemIndex: i.itemIndex,
        quantity: i.quantity,
        equipped: i.equipped,
      })),
    );
  }

  if (built.spellSlots.length > 0) {
    await db.insert(spellSlots).values(
      built.spellSlots.map((s) => ({
        characterId: row.id,
        level: s.level,
        max: s.max,
        used: s.used,
      })),
    );
  }

  const sheet = await getCharacterSheet(row.id);
  await appendEvent(params.campaignId, "character.created", {
    characterId: sheet.id,
    name: sheet.name,
    userId: params.userId,
  });
  return sheet;
}

/** Loads a character and derives every sheet value from scratch. */
export async function getCharacterSheet(characterId: string): Promise<CharacterSheet> {
  const [row] = await db.select().from(characters).where(eq(characters.id, characterId)).limit(1);
  if (!row) throw new NotFoundError("No such character.");

  const [profRows, itemRows, spellRows, slotRows] = await Promise.all([
    db
      .select()
      .from(characterProficiencies)
      .where(eq(characterProficiencies.characterId, characterId)),
    db.select().from(characterItems).where(eq(characterItems.characterId, characterId)),
    db.select().from(characterSpells).where(eq(characterSpells.characterId, characterId)),
    db.select().from(spellSlots).where(eq(spellSlots.characterId, characterId)),
  ]);

  const classDoc = srdGet.class(row.class);
  const raceDoc = srdGet.race(row.race);
  const subraceDoc = row.subrace ? srdGet.subrace(row.subrace) : null;
  const levelDoc = srd.levels().find((l) => l.index === `${row.class}-${row.level}`) ?? null;

  const equipmentDocs = srd.equipment();
  const items = itemRows.flatMap((item) => {
    const doc = equipmentDocs.find((e) => e.index === item.itemIndex);
    // An item the SRD no longer knows about is skipped rather than crashing the sheet.
    return doc ? [{ ...item, doc }] : [];
  });

  const derived = deriveCharacter(
    {
      name: row.name,
      race: row.race,
      subrace: row.subrace,
      class: row.class,
      subclass: row.subclass,
      level: row.level,
      str: row.str,
      dex: row.dex,
      con: row.con,
      int: row.int,
      wis: row.wis,
      cha: row.cha,
      hpMax: row.hpMax,
      hpCurrent: row.hpCurrent,
      conditions: row.conditions,
      exhaustion: row.exhaustion,
    },
    {
      classDoc,
      raceDoc,
      subraceDoc,
      levelDoc,
      skills: srd.skills(),
      proficiencyDocs: srd.proficiencies(),
      proficiencies: profRows.map((p) => ({
        kind: p.kind,
        proficiencyIndex: p.proficiencyIndex,
        expertise: p.expertise,
      })),
      items: items.map((i) => ({
        itemIndex: i.itemIndex,
        quantity: i.quantity,
        equipped: i.equipped,
        attuned: i.attuned,
        doc: i.doc,
      })),
    },
  );

  return {
    id: row.id,
    campaignId: row.campaignId,
    userId: row.userId,
    name: row.name,
    race: row.race,
    subrace: row.subrace,
    class: row.class,
    subclass: row.subclass,
    background: row.background,
    alignment: row.alignment,
    level: row.level,
    xp: row.xp,
    hpCurrent: row.hpCurrent,
    hpMax: row.hpMax,
    tempHp: row.tempHp,
    hitDiceRemaining: row.hitDiceRemaining,
    deathSuccesses: row.deathSuccesses,
    deathFailures: row.deathFailures,
    stable: row.stable,
    conditions: row.conditions,
    exhaustion: row.exhaustion,
    inspiration: row.inspiration,
    notes: row.notes,
    labels: {
      race: raceDoc.name,
      class: classDoc.name,
      subrace: subraceDoc?.name ?? null,
    },
    slots: slotRows
      .map((s) => ({ level: s.level, max: s.max, used: s.used }))
      .sort((a, b) => a.level - b.level),
    spells: spellRows.map((s) => ({
      spellIndex: s.spellIndex,
      prepared: s.prepared,
      alwaysPrepared: s.alwaysPrepared,
    })),
    items: items.map((i) => ({
      itemIndex: i.itemIndex,
      name: i.doc.name,
      quantity: i.quantity,
      equipped: i.equipped,
      attuned: i.attuned,
    })),
    proficiencies: profRows.map((p) => ({
      kind: p.kind,
      proficiencyIndex: p.proficiencyIndex,
      expertise: p.expertise,
    })),
    derived,
  };
}

export async function listCharacters(campaignId: string): Promise<CharacterSheet[]> {
  const rows = await db
    .select({ id: characters.id })
    .from(characters)
    .where(eq(characters.campaignId, campaignId));
  return Promise.all(rows.map((row) => getCharacterSheet(row.id)));
}

/** Equipping changes AC and attacks, so it goes through the server like any other rule. */
export async function setItemEquipped(params: {
  characterId: string;
  itemIndex: string;
  equipped: boolean;
}): Promise<CharacterSheet> {
  const updated = await db
    .update(characterItems)
    .set({ equipped: params.equipped })
    .where(
      and(
        eq(characterItems.characterId, params.characterId),
        eq(characterItems.itemIndex, params.itemIndex),
      ),
    )
    .returning({ id: characterItems.id });

  // Silently succeeding here would let the client believe it changed an AC that
  // never moved, because the character does not carry that item.
  if (updated.length === 0) {
    throw new NotFoundError(`This character is not carrying "${params.itemIndex}".`);
  }

  const sheet = await getCharacterSheet(params.characterId);
  await appendEvent(sheet.campaignId, "character.updated", {
    characterId: sheet.id,
    armorClass: sheet.derived.armorClass.value,
  });
  return sheet;
}
