import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { characters, combatants, encounters, maps, rolls as rollsTable } from "@/db/schema";
import type { MapTerrain } from "@/db/schema";
import type { DerivedAttack } from "@/rules/character";
import { abilityModifier } from "@/rules/character";
import {
  type CombatantState,
  applyDamage,
  concentrationDc,
  resolveAttack,
  rollDeathSave,
  rollInitiative,
  rollWeaponDamage,
  resolveSave,
  sortInitiative,
} from "@/rules/combat";
import { canTakeActions, effectiveSpeed, rangedInMeleeDisadvantage } from "@/rules/conditions";
import { checkMeleeReach, checkRange, distanceFt, provokesOpportunityAttacks, validatePath } from "@/rules/movement";
import { selfAreaFt } from "@/rules/spells";
import { advanceTurn, resolveTurn } from "@/rules/turn-order";
import type { RollResult } from "@/rules/dice";
import { srd } from "@/srd/local";
import { listCharacters } from "./characters";
import { appendEvent, postMessage } from "./events";
import { notify } from "./notify";
import { NotFoundError, RuleError } from "./http";
import { type CombatStats, monsterArmorClass, monsterCombatStats, monsterHitPoints } from "./monsters";
import { type CastReport, castSpell, knownSpells, slotsFor } from "./casting";

/**
 * Encounter orchestration.
 *
 * The rules engine decides outcomes; this module decides *whether an action is
 * allowed to happen at all* — whose turn it is, whether the actor still has the
 * action, whether the target is in reach — then persists the result and
 * announces it on the event log.
 */

type CombatantRow = typeof combatants.$inferSelect;

export type CombatantView = CombatantRow & {
  stats: CombatStats | null;
  attacks: DerivedAttack[];
  /** Spell list and remaining slots, for a character who casts. */
  spellcasting: {
    saveDc: number;
    attackBonus: number;
    slots: { level: number; max: number; used: number }[];
    spells: {
      index: string;
      name: string;
      level: number;
      concentration: boolean;
      areaFt: number | null;
    }[];
  } | null;
};

export type MapView = {
  id: string;
  width: number;
  height: number;
  cellSizeFt: number;
  terrain: MapTerrain;
  background: string | null;
};

export type EncounterView = {
  id: string;
  campaignId: string;
  mapId: string | null;
  name: string;
  status: string;
  round: number;
  turnIndex: number;
  combatants: CombatantView[];
  /** The battlefield itself, so the client can draw terrain it must not invent. */
  map: MapView | null;
  /** The combatant whose turn it is, or null outside an active encounter. */
  activeCombatantId: string | null;
};

const asState = (row: CombatantRow): CombatantState => ({
  name: row.name,
  hpCurrent: row.hpCurrent,
  hpMax: row.hpMax,
  tempHp: row.tempHp,
  ac: row.ac,
  conditions: row.conditions,
  exhaustion: row.exhaustion,
  deathSuccesses: row.deathSuccesses,
  deathFailures: row.deathFailures,
  stable: row.stable,
  defeated: row.defeated,
  concentration: row.concentration ?? null,
  resistances: (row.stats as CombatStats | null)?.resistances ?? [],
  immunities: (row.stats as CombatStats | null)?.immunities ?? [],
  vulnerabilities: (row.stats as CombatStats | null)?.vulnerabilities ?? [],
  isPlayerCharacter: row.characterId !== null,
});

/**
 * Mirrors a combatant's condition back onto its character sheet.
 *
 * The combatant row is the authority during a fight, but the sheet is what the
 * party panel renders and what the DM's memory projection reads. Without this
 * write-back the two drift: a dying player shows full HP to the table, the AI
 * is told the party is uninjured, and every wound evaporates when the encounter
 * ends. Call this after anything that changes a combatant's hit points or
 * death-save track.
 */
async function syncSheet(combatantId: string) {
  const [row] = await db.select().from(combatants).where(eq(combatants.id, combatantId)).limit(1);
  if (!row?.characterId) return;

  await db
    .update(characters)
    .set({
      hpCurrent: row.hpCurrent,
      tempHp: row.tempHp,
      conditions: row.conditions,
      exhaustion: row.exhaustion,
      deathSuccesses: row.deathSuccesses,
      deathFailures: row.deathFailures,
      stable: row.stable,
    })
    .where(eq(characters.id, row.characterId));
}

/* ------------------------------------------------------------------ *
 * Starting an encounter
 * ------------------------------------------------------------------ */

export type EncounterRequest = {
  name: string;
  /** Monster index plus how many, e.g. `{ index: "goblin", count: 4 }`. */
  monsters: { index: string; count: number }[];
  /** Character ids to roll in. Defaults to every character in the campaign. */
  characterIds?: string[];
  mapId?: string | null;
};

/**
 * Rolls initiative for everyone and opens the encounter.
 *
 * Initiative is rolled here, once, server-side — a client never submits its own
 * initiative result.
 */
export async function startEncounter(
  campaignId: string,
  request: EncounterRequest,
): Promise<EncounterView> {
  // One fight at a time. Starting a second left both active, put characters in
  // two encounters with two independent HP rows, and made whichever one
  // getActiveEncounter happened to return the only reachable fight — so a
  // double-click on the DM's control silently corrupted the table.
  const running = await getActiveEncounter(campaignId);
  if (running) {
    throw new RuleError(
      `"${running.name}" is still running. Finish it before starting another encounter.`,
    );
  }

  const sheets = await listCharacters(campaignId);
  const chosen = request.characterIds
    ? sheets.filter((s) => request.characterIds!.includes(s.id))
    : sheets;

  if (chosen.length === 0) {
    throw new RuleError("There are no characters in this campaign to fight.");
  }

  let mapId = request.mapId ?? null;
  if (!mapId) {
    const [map] = await db
      .insert(maps)
      .values({ campaignId, name: `${request.name} — battlefield`, width: 20, height: 20 })
      .returning({ id: maps.id });
    mapId = map.id;
  }

  const [encounter] = await db
    .insert(encounters)
    .values({ campaignId, mapId, name: request.name, status: "active", round: 1 })
    .returning();

  const rows: (typeof combatants.$inferInsert)[] = [];
  const rollLog: { name: string; roll: RollResult }[] = [];

  chosen.forEach((sheet, i) => {
    const state = { conditions: sheet.conditions, exhaustion: sheet.exhaustion };
    const roll = rollInitiative({ modifier: sheet.derived.initiative, creature: state });
    rollLog.push({ name: sheet.name, roll });

    rows.push({
      encounterId: encounter.id,
      characterId: sheet.id,
      name: sheet.name,
      side: "party",
      initiative: roll.total,
      initiativeTiebreak: sheet.derived.abilities.dex.score,
      hpCurrent: sheet.hpCurrent,
      hpMax: sheet.hpMax,
      tempHp: sheet.tempHp,
      ac: sheet.derived.armorClass.value,
      speed: sheet.derived.speed.base,
      conditions: sheet.conditions,
      exhaustion: sheet.exhaustion,
      x: 2,
      y: 2 + i * 2,
      size: 1,
      stats: {
        abilities: {
          str: sheet.derived.abilities.str.score,
          dex: sheet.derived.abilities.dex.score,
          con: sheet.derived.abilities.con.score,
          int: sheet.derived.abilities.int.score,
          wis: sheet.derived.abilities.wis.score,
          cha: sheet.derived.abilities.cha.score,
        },
        saveModifiers: Object.fromEntries(
          Object.entries(sheet.derived.saves).map(([k, v]) => [k, v.modifier]),
        ),
        attacks: sheet.derived.attacks,
        // Racial resistances travel with the character into the fight; without
        // this a tiefling takes full fire damage despite Hellish Resistance.
        resistances: sheet.derived.resistances,
        immunities: [],
        vulnerabilities: [],
        conditionImmunities: [],
        speed: sheet.derived.speed.base,
        size: 1,
        cr: 0,
        xp: 0,
      } satisfies CombatStats,
    });
  });

  let foeIndex = 0;
  for (const entry of request.monsters) {
    const monster = srd.monsters().find((m) => m.index === entry.index);
    if (!monster) throw new RuleError(`No SRD monster called "${entry.index}".`);
    const count = Math.max(1, Math.min(20, entry.count));
    const stats = monsterCombatStats(monster);

    for (let n = 0; n < count; n++) {
      const state = { conditions: [], exhaustion: 0 };
      const roll = rollInitiative({
        modifier: abilityModifier(monster.dexterity),
        creature: state,
      });
      const name = count > 1 ? `${monster.name} ${n + 1}` : monster.name;
      rollLog.push({ name, roll });

      rows.push({
        encounterId: encounter.id,
        monsterIndex: monster.index,
        name,
        side: "foe",
        initiative: roll.total,
        initiativeTiebreak: monster.dexterity,
        hpCurrent: monsterHitPoints(monster),
        hpMax: monsterHitPoints(monster),
        ac: monsterArmorClass(monster),
        speed: stats.speed,
        x: 12 + (foeIndex % 4),
        y: 2 + Math.floor(foeIndex / 4) * 2,
        size: stats.size,
        stats,
      });
      foeIndex += 1;
    }
  }

  await db.insert(combatants).values(rows);

  // Persist every initiative roll so the log can show how the order was decided.
  await db.insert(rollsTable).values(
    rollLog.map((entry) => ({
      campaignId,
      encounterId: encounter.id,
      actorType: "combatant",
      actorName: entry.name,
      kind: "initiative",
      formula: entry.roll.formula,
      dice: entry.roll.dice,
      modifier: entry.roll.modifier,
      advantage: entry.roll.advantage,
      total: entry.roll.total,
    })),
  );

  const view = await getEncounter(encounter.id);
  await appendEvent(campaignId, "encounter.started", {
    encounterId: encounter.id,
    name: encounter.name,
    order: view.combatants.map((c) => ({ id: c.id, name: c.name, initiative: c.initiative })),
  });
  return view;
}

/* ------------------------------------------------------------------ *
 * Reading an encounter
 * ------------------------------------------------------------------ */

export async function getEncounter(encounterId: string): Promise<EncounterView> {
  const [encounter] = await db
    .select()
    .from(encounters)
    .where(eq(encounters.id, encounterId))
    .limit(1);
  if (!encounter) throw new NotFoundError("No such encounter.");

  const rows = await db
    .select()
    .from(combatants)
    .where(eq(combatants.encounterId, encounterId));

  const ordered = sortInitiative(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      initiative: row.initiative ?? 0,
      tiebreak: row.initiativeTiebreak,
      row,
    })),
  ).map((entry) => entry.row);

  const view: CombatantView[] = ordered.map((row) => ({
    ...row,
    stats: row.stats as CombatStats | null,
    attacks: (row.stats as CombatStats | null)?.attacks ?? [],
    spellcasting: null,
  }));

  // Casters carry their spell list and remaining slots so the combat panel can
  // offer them without a second round trip. Read live rather than snapshotted:
  // a slot spent this turn must be gone from the next render.
  const casterIds = view.filter((c) => c.characterId).map((c) => c.characterId!);
  if (casterIds.length > 0) {
    const sheets = await listCharacters(encounter.campaignId);
    const spellDocs = srd.spells();

    for (const combatant of view) {
      if (!combatant.characterId) continue;
      const sheet = sheets.find((s) => s.id === combatant.characterId);
      if (!sheet?.derived.spellcasting) continue;

      const [slots, known] = await Promise.all([
        slotsFor(combatant.characterId),
        knownSpells(combatant.characterId),
      ]);

      combatant.spellcasting = {
        saveDc: sheet.derived.spellcasting.saveDc,
        attackBonus: sheet.derived.spellcasting.attackBonus,
        slots,
        spells: known
          .filter((k) => k.prepared)
          .map((k) => spellDocs.find((d) => d.index === k.spellIndex))
          .filter((d): d is NonNullable<typeof d> => Boolean(d))
          .map((d) => ({
            index: d.index,
            name: d.name,
            level: d.level,
            concentration: d.concentration,
            areaFt: selfAreaFt(d),
          }))
          .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
      };
    }
  }

  // The turn pointer skips the dead rather than resting on them.
  //
  // It used to be `view[turnIndex]` flat, so a character who died on their own
  // turn became the active combatant forever: requireTurn rejects a defeated
  // actor, so they could not end their turn, nobody else could act out of turn,
  // and the one-active-encounter rule meant the campaign could never fight
  // again. Dying is the outcome the death-save system exists to produce, so it
  // must not be the thing that ends the game.
  // Skipping past a corpse is *committed*, not recomputed on every read.
  //
  // Scanning without persisting left `turnIndex` pointing at the dead and the
  // round bump owed until the next endTurn — so for that whole turn the stored
  // round was one behind what was actually being played. Players saw the wrong
  // round, the DM's memory projection was handed the wrong round every turn,
  // and the journal understated how long a fight ran. Writing the corrected
  // pointer here keeps the invariant that `round` is always the round of the
  // combatant whose turn it is. It self-heals once and then stops writing.
  const pointer =
    encounter.status === "active"
      ? resolveTurn(view, encounter.turnIndex, encounter.round)
      : { activeId: null, turnIndex: encounter.turnIndex, round: encounter.round, moved: false };

  // Committed when it moves, so the stored round is never behind the round
  // actually being played. See src/rules/turn-order.ts.
  if (pointer.moved) {
    await db
      .update(encounters)
      .set({ turnIndex: pointer.turnIndex, round: pointer.round })
      .where(eq(encounters.id, encounter.id));
  }

  const active = pointer.activeId;
  const turnIndex = pointer.turnIndex;
  const round = pointer.round;

  const [mapRow] = encounter.mapId
    ? await db.select().from(maps).where(eq(maps.id, encounter.mapId)).limit(1)
    : [];

  return {
    id: encounter.id,
    campaignId: encounter.campaignId,
    mapId: encounter.mapId,
    name: encounter.name,
    status: encounter.status,
    round,
    turnIndex,
    combatants: view,
    map: mapRow
      ? {
          id: mapRow.id,
          width: mapRow.width,
          height: mapRow.height,
          cellSizeFt: mapRow.cellSizeFt,
          terrain: mapRow.terrain,
          background: mapRow.background,
        }
      : null,
    activeCombatantId: active,
  };
}

export async function getActiveEncounter(campaignId: string): Promise<EncounterView | null> {
  const [row] = await db
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.campaignId, campaignId), eq(encounters.status, "active")))
    // Oldest first, so a campaign left with two actives by earlier code always
    // resolves to the same one rather than whatever Postgres returns first.
    .orderBy(asc(encounters.createdAt))
    .limit(1);
  return row ? getEncounter(row.id) : null;
}

/* ------------------------------------------------------------------ *
 * Turn gating
 * ------------------------------------------------------------------ */

/**
 * Gates an action on it being this combatant's turn.
 *
 * `allowIncapacitated` exists because an unconscious creature still *has* a
 * turn — it makes a death save and passes. Blocking incapacitated actors from
 * ending their own turn deadlocks the encounter permanently the first time
 * anyone drops to 0 HP, since nothing else can advance the pointer past them.
 * Only rolling a death save and ending the turn may set it.
 */
async function requireTurn(
  encounterId: string,
  combatantId: string,
  options: { allowIncapacitated?: boolean } = {},
) {
  const encounter = await getEncounter(encounterId);
  if (encounter.status !== "active") throw new RuleError("This encounter is not running.");
  if (encounter.activeCombatantId !== combatantId) {
    const active = encounter.combatants.find((c) => c.id === encounter.activeCombatantId);
    throw new RuleError(`It is ${active?.name ?? "someone else"}'s turn.`);
  }

  const actor = encounter.combatants.find((c) => c.id === combatantId);
  if (!actor) throw new NotFoundError("No such combatant.");
  if (actor.defeated) throw new RuleError(`${actor.name} is out of the fight.`);
  if (
    !options.allowIncapacitated &&
    !canTakeActions({ conditions: actor.conditions, exhaustion: actor.exhaustion })
  ) {
    throw new RuleError(`${actor.name} is incapacitated and cannot act.`);
  }

  return { encounter, actor };
}

/* ------------------------------------------------------------------ *
 * Attacking
 * ------------------------------------------------------------------ */

export type AttackReport = {
  encounter: EncounterView;
  attack: {
    attackerName: string;
    targetName: string;
    weapon: string;
    attackRoll: RollResult;
    hit: boolean;
    critical: boolean;
    targetAc: number;
    damage: RollResult | null;
    damageTaken: number;
    targetHpAfter: number;
    droppedToZero: boolean;
    instantDeath: boolean;
  };
};

export async function performAttack(params: {
  encounterId: string;
  actorId: string;
  targetId: string;
  attackIndex: number;
}): Promise<AttackReport> {
  const { encounter, actor } = await requireTurn(params.encounterId, params.actorId);

  // Claim the action atomically. Checking `actor.actionUsed` and updating it
  // later leaves a window in which two simultaneous attacks both pass the check
  // and one action pays for two swings.
  const claimed = await db
    .update(combatants)
    .set({ actionUsed: true })
    .where(and(eq(combatants.id, actor.id), eq(combatants.actionUsed, false)))
    .returning({ id: combatants.id });

  if (claimed.length === 0) {
    throw new RuleError(`${actor.name} has already taken an action this turn.`);
  }

  const target = encounter.combatants.find((c) => c.id === params.targetId);
  if (!target) throw new NotFoundError("No such target.");
  if (target.defeated) throw new RuleError(`${target.name} is already out of the fight.`);
  if (target.id === actor.id) throw new RuleError("A combatant cannot attack itself.");

  const attack = actor.attacks[params.attackIndex];
  if (!attack) throw new RuleError(`${actor.name} has no attack ready in that slot.`);

  // Range is enforced against the map, not trusted from the request.
  const from = { x: actor.x ?? 0, y: actor.y ?? 0 };
  const to = { x: target.x ?? 0, y: target.y ?? 0 };
  const rangeFt = distanceFt(from, to);

  let longRange = false;
  if (attack.kind === "melee") {
    const reach = checkMeleeReach(from, to, attack.reachFt ?? 5);
    if (!reach.inRange) throw new RuleError(reach.reason ?? "Target is out of reach.");
  } else {
    const range = checkRange(from, to, attack.rangeFt ?? { normal: 20, long: 60 });
    if (!range.inRange) throw new RuleError(range.reason ?? "Target is out of range.");
    longRange = range.longRange;
  }

  // Shooting with an enemy breathing down your neck is harder (PHB 195).
  const adjacentEnemies =
    attack.kind === "ranged" && actor.x !== null && actor.y !== null
      ? encounter.combatants.filter(
          (c) =>
            c.side !== actor.side &&
            !c.defeated &&
            c.x !== null &&
            c.y !== null &&
            distanceFt({ x: actor.x!, y: actor.y! }, { x: c.x!, y: c.y! }) <= 5,
        )
      : [];
  const crowded = rangedInMeleeDisadvantage({
    adjacentEnemies: adjacentEnemies.map((c) => ({
      conditions: c.conditions,
      exhaustion: c.exhaustion,
    })),
  });

  const outcome = resolveAttack({
    attackBonus: attack.attackBonus,
    attacker: { conditions: actor.conditions, exhaustion: actor.exhaustion },
    target: { conditions: target.conditions, exhaustion: target.exhaustion, ac: target.ac },
    rangeFt,
    situational: { disadvantage: longRange || crowded.disadvantage },
  });

  let damageRoll: RollResult | null = null;
  let damageTaken = 0;
  let droppedToZero = false;
  let instantDeath = false;
  let targetHpAfter = target.hpCurrent;

  if (outcome.hit) {
    const { roll, packet } = rollWeaponDamage(attack, { critical: outcome.critical });
    damageRoll = roll;

    const result = applyDamage(asState(target), packet, { critical: outcome.critical });
    damageTaken = result.adjusted;
    droppedToZero = result.droppedToZero;
    instantDeath = result.instantDeath;

    await db.update(combatants).set(result.patch).where(eq(combatants.id, target.id));
    targetHpAfter = result.patch.hpCurrent ?? target.hpCurrent;

    await syncSheet(target.id);
    await checkConcentration({
      campaignId: encounter.campaignId,
      encounterId: encounter.id,
      combatantId: target.id,
      damage: damageTaken,
    });
  }

  await db.insert(rollsTable).values([
    {
      campaignId: encounter.campaignId,
      encounterId: encounter.id,
      actorType: "combatant",
      actorId: actor.id,
      actorName: actor.name,
      kind: "attack",
      formula: outcome.roll.formula,
      dice: outcome.roll.dice,
      modifier: outcome.roll.modifier,
      advantage: outcome.advantage,
      total: outcome.roll.total,
      targetName: target.name,
      dc: target.ac,
      outcome: outcome.critical ? "critical" : outcome.hit ? "hit" : "miss",
    },
    ...(damageRoll
      ? [
          {
            campaignId: encounter.campaignId,
            encounterId: encounter.id,
            actorType: "combatant",
            actorId: actor.id,
            actorName: actor.name,
            kind: "damage",
            formula: damageRoll.formula,
            dice: damageRoll.dice,
            modifier: damageRoll.modifier,
            advantage: "normal" as const,
            total: damageRoll.total,
            targetName: target.name,
            outcome: `${damageTaken} ${attack.damageType}`,
          },
        ]
      : []),
  ]);

  const updated = await getEncounter(params.encounterId);
  await appendEvent(encounter.campaignId, "combatant.updated", {
    encounterId: encounter.id,
    attackerName: actor.name,
    targetName: target.name,
    weapon: attack.name,
    natural: outcome.natural,
    total: outcome.roll.total,
    hit: outcome.hit,
    critical: outcome.critical,
    damage: damageTaken,
    targetHpAfter,
    droppedToZero,
    instantDeath,
  });

  return {
    encounter: updated,
    attack: {
      attackerName: actor.name,
      targetName: target.name,
      weapon: attack.name,
      attackRoll: outcome.roll,
      hit: outcome.hit,
      critical: outcome.critical,
      targetAc: target.ac,
      damage: damageRoll,
      damageTaken,
      targetHpAfter,
      droppedToZero,
      instantDeath,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Movement
 * ------------------------------------------------------------------ */

export async function moveCombatant(params: {
  encounterId: string;
  combatantId: string;
  path: { x: number; y: number }[];
}): Promise<{
  encounter: EncounterView;
  costFt: number;
  provoked: { id: string; name: string }[];
  opportunityAttacks: { attackerName: string; hit: boolean; damage: number }[];
}> {
  const { encounter, actor } = await requireTurn(params.encounterId, params.combatantId);

  const [map] = encounter.mapId
    ? await db.select().from(maps).where(eq(maps.id, encounter.mapId)).limit(1)
    : [];
  if (!map) throw new RuleError("This encounter has no battlefield.");

  const budget =
    effectiveSpeed(actor.speed, { conditions: actor.conditions, exhaustion: actor.exhaustion }) -
    actor.movementUsed;

  const from = { x: actor.x ?? 0, y: actor.y ?? 0 };
  const occupied = encounter.combatants
    .filter((c) => c.id !== actor.id && !c.defeated && c.x !== null && c.y !== null)
    .map((c) => ({ x: c.x!, y: c.y! }));

  const validation = validatePath(from, params.path, {
    map: { width: map.width, height: map.height },
    terrain: map.terrain,
    occupied,
    budgetFt: budget,
  });

  if (!validation.ok) throw new RuleError(validation.reason);

  // Leaving an enemy's reach is announced so a reaction can be offered.
  const enemies = encounter.combatants
    .filter((c) => c.side !== actor.side && !c.defeated && c.x !== null && c.y !== null)
    .map((c) => ({
      id: c.id,
      name: c.name,
      cell: { x: c.x!, y: c.y! },
      reachFt: c.attacks.find((a) => a.kind === "melee")?.reachFt ?? 5,
    }));
  const provoked = provokesOpportunityAttacks(from, params.path, enemies);

  // Opportunity attacks resolve before the move lands, which is the order the
  // rules use: you are struck as you leave reach, not after you have arrived.
  const opportunityAttacks: { attackerName: string; hit: boolean; damage: number }[] = [];
  for (const enemy of provoked) {
    const attacker = encounter.combatants.find((c) => c.id === enemy.id);
    if (!attacker) continue;
    const result = await resolveOpportunityAttack({
      campaignId: encounter.campaignId,
      encounterId: encounter.id,
      attacker,
      target: actor,
    });
    if (result) opportunityAttacks.push(result);
  }

  // A mover dropped by an opportunity attack does not complete the move.
  const [afterReactions] = await db
    .select()
    .from(combatants)
    .where(eq(combatants.id, actor.id))
    .limit(1);

  if (afterReactions && afterReactions.hpCurrent === 0) {
    const stopped = await getEncounter(params.encounterId);
    return { encounter: stopped, costFt: 0, provoked, opportunityAttacks };
  }

  const destination = params.path[params.path.length - 1] ?? from;
  await db
    .update(combatants)
    .set({
      x: destination.x,
      y: destination.y,
      movementUsed: actor.movementUsed + validation.costFt,
    })
    .where(eq(combatants.id, actor.id));

  const updated = await getEncounter(params.encounterId);
  await appendEvent(encounter.campaignId, "token.moved", {
    encounterId: encounter.id,
    combatantId: actor.id,
    name: actor.name,
    to: destination,
    costFt: validation.costFt,
    provoked,
  });

  return { encounter: updated, costFt: validation.costFt, provoked, opportunityAttacks };
}

/* ------------------------------------------------------------------ *
 * Turns and death saves
 * ------------------------------------------------------------------ */

export async function endTurn(encounterId: string, combatantId: string): Promise<EncounterView> {
  const { encounter, actor } = await requireTurn(encounterId, combatantId, {
    allowIncapacitated: true,
  });

  // Reset the outgoing combatant's economy.
  await db
    .update(combatants)
    .set({ movementUsed: 0, actionUsed: false, bonusUsed: false, reactionUsed: false })
    .where(eq(combatants.id, actor.id));

  // Advance from whoever actually just acted, not from the stored index — those
  // differ the moment somebody dies on their own turn, and stepping from the
  // stale one handed the next combatant a second turn. See src/rules/turn-order.ts.
  const actorIndex = encounter.combatants.findIndex((c) => c.id === actor.id);
  const next = advanceTurn(
    encounter.combatants,
    actorIndex >= 0 ? actorIndex : encounter.turnIndex,
    encounter.round,
  );

  await db
    .update(encounters)
    .set({ turnIndex: next.turnIndex, round: next.round })
    .where(eq(encounters.id, encounterId));

  const updated = await getEncounter(encounterId);
  const nowActive = updated.combatants.find((c) => c.id === updated.activeCombatantId);
  await appendEvent(encounter.campaignId, "turn.changed", {
    encounterId,
    round: updated.round,
    activeCombatantId: updated.activeCombatantId,
    activeName: nowActive?.name ?? null,
  });

  // Tell whoever is up, if they are not already watching. `notify` swallows its
  // own failures — a turn must still end when a webhook is dead.
  if (nowActive?.characterId) {
    const [sheet] = await db
      .select({ userId: characters.userId })
      .from(characters)
      .where(eq(characters.id, nowActive.characterId))
      .limit(1);

    if (sheet?.userId) {
      await notify({
        campaignId: encounter.campaignId,
        reason: "turn",
        targetUserIds: [sheet.userId],
        title: "Your turn",
        body: `${nowActive.name} is up — round ${updated.round}.`,
      });
    }
  }

  return maybeEndEncounter(updated);
}

export async function performDeathSave(params: {
  encounterId: string;
  combatantId: string;
}): Promise<{ encounter: EncounterView; roll: RollResult; result: string }> {
  // A death save is a turn's worth of action, so it is gated exactly like an
  // attack or a move. Without this a dying client could POST repeatedly and
  // burn the whole three-and-three track inside one round.
  const { encounter, actor } = await requireTurn(params.encounterId, params.combatantId, {
    allowIncapacitated: true,
  });
  if (actor.defeated) throw new RuleError(`${actor.name} is beyond saving.`);
  if (actor.hpCurrent > 0) throw new RuleError(`${actor.name} is still on their feet.`);
  if (actor.stable) throw new RuleError(`${actor.name} is stable and no longer rolling.`);

  // One death save per turn, claimed atomically. Reading actionUsed and writing
  // it afterwards left a window in which eight parallel requests each rolled a
  // fresh d20 and the last write won — four failures rolled, none retained, and
  // a natural 20 fished out to stand back up at 1 HP.
  const claimedSave = await db
    .update(combatants)
    .set({ actionUsed: true })
    .where(and(eq(combatants.id, actor.id), eq(combatants.actionUsed, false)))
    .returning({ id: combatants.id });

  if (claimedSave.length === 0) {
    throw new RuleError(`${actor.name} has already rolled a death save this turn.`);
  }

  const outcome = rollDeathSave(asState(actor));
  await db.update(combatants).set(outcome.patch).where(eq(combatants.id, actor.id));
  await syncSheet(actor.id);

  await db.insert(rollsTable).values({
    campaignId: encounter.campaignId,
    encounterId: encounter.id,
    actorType: "combatant",
    actorId: actor.id,
    actorName: actor.name,
    kind: "death_save",
    formula: outcome.roll.formula,
    dice: outcome.roll.dice,
    modifier: 0,
    advantage: "normal",
    total: outcome.roll.total,
    dc: 10,
    outcome: outcome.result,
  });

  const updated = await getEncounter(params.encounterId);
  await appendEvent(encounter.campaignId, "combatant.updated", {
    encounterId: encounter.id,
    combatantId: actor.id,
    name: actor.name,
    deathSave: outcome.result,
    revived: outcome.revived,
    stabilized: outcome.stabilized,
    dead: outcome.dead,
  });

  return { encounter: await maybeEndEncounter(updated), roll: outcome.roll, result: outcome.result };
}

/** Closes the encounter once one side has nobody left standing. */
async function maybeEndEncounter(view: EncounterView): Promise<EncounterView> {
  if (view.status !== "active") return view;

  const standing = (side: string) =>
    view.combatants.some((c) => c.side === side && !c.defeated && c.hpCurrent > 0);

  if (standing("party") && standing("foe")) return view;

  await db.update(encounters).set({ status: "resolved" }).where(eq(encounters.id, view.id));
  const outcome = standing("party") ? "victory" : "defeat";

  // Belt and braces: the sheet is already written back after every hit, but the
  // fight is over here and the sheet is what the party carries forward, so make
  // the invariant hold even if some future path forgets to sync.
  for (const c of view.combatants) {
    if (c.characterId) await syncSheet(c.id);
  }

  await appendEvent(view.campaignId, "encounter.ended", {
    encounterId: view.id,
    outcome,
    survivors: view.combatants.filter((c) => !c.defeated).map((c) => c.name),
  });

  return { ...view, status: "resolved", activeCombatantId: null };
}

/* ------------------------------------------------------------------ *
 * Casting
 * ------------------------------------------------------------------ */

/**
 * Assembles the caster and targets from the encounter, then hands off to the
 * casting engine. Turn order, action economy and ownership are enforced here
 * exactly as they are for a weapon attack — a spell is not a way around them.
 */
export async function castSpellAction(params: {
  encounterId: string;
  combatantId: string;
  spellIndex: string;
  slotLevel: number;
  targetIds: string[];
}): Promise<{ encounter: EncounterView; cast: CastReport }> {
  const { encounter, actor } = await requireTurn(params.encounterId, params.combatantId);
  if (!actor.characterId) throw new RuleError(`${actor.name} has no spellcasting.`);

  // Claimed atomically, as for a weapon attack: two simultaneous casts must not
  // both pass a read of actionUsed.
  const claimed = await db
    .update(combatants)
    .set({ actionUsed: true })
    .where(and(eq(combatants.id, actor.id), eq(combatants.actionUsed, false)))
    .returning({ id: combatants.id });

  if (claimed.length === 0) {
    throw new RuleError(`${actor.name} has already taken an action this turn.`);
  }

  const sheets = await listCharacters(encounter.campaignId);
  const sheet = sheets.find((s) => s.id === actor.characterId);
  if (!sheet?.derived.spellcasting) throw new RuleError(`${actor.name} cannot cast spells.`);

  const targets = params.targetIds.map((id) => {
    const row = encounter.combatants.find((c) => c.id === id);
    if (!row) throw new NotFoundError("No such target.");
    const saves = (row.stats as CombatStats | null)?.saveModifiers ?? {};
    return {
      id: row.id,
      name: row.name,
      state: asState(row),
      x: row.x,
      y: row.y,
      // The whole spread, so the spell applies the ability it actually names.
      // Taking the maximum here handed every target its single best save.
      saveModifiers: saves,
    };
  });

  const cast = await castSpell({
    campaignId: encounter.campaignId,
    encounterId: encounter.id,
    caster: {
      id: actor.id,
      characterId: actor.characterId,
      name: actor.name,
      level: sheet.level,
      x: actor.x,
      y: actor.y,
      spellAttackBonus: sheet.derived.spellcasting.attackBonus,
      spellSaveDc: sheet.derived.spellcasting.saveDc,
      spellModifier: sheet.derived.spellcasting.modifier,
      conditions: actor.conditions,
      exhaustion: actor.exhaustion,
    },
    spellIndex: params.spellIndex,
    slotLevel: params.slotLevel,
    targets,
    onConcentrationCheck: (combatantId, damage) =>
      checkConcentration({
        campaignId: encounter.campaignId,
        encounterId: encounter.id,
        combatantId,
        damage,
      }),
  });

  // Damage from a spell moves hit points, so the sheets follow.
  for (const target of targets) await syncSheet(target.id);
  await syncSheet(actor.id);

  // A spell the engine would not resolve reaches the table as a ruling card,
  // clearly marked as the DM deciding rather than the rules computing.
  if (cast.needsRuling) {
    await postMessage({
      campaignId: encounter.campaignId,
      authorType: "system",
      authorName: "Dungeon Master",
      kind: "ruling",
      content: cast.needsRuling,
      metadata: {
        question: `${actor.name} casts ${cast.spellName}. What happens?`,
        mechanic: "The engine does not resolve this spell; the DM adjudicates it.",
      },
    });
  }

  const updated = await maybeEndEncounter(await getEncounter(params.encounterId));
  return { encounter: updated, cast };
}

/**
 * An opportunity attack.
 *
 * Deliberately not routed through `performAttack`, which requires it to be the
 * attacker's turn — the whole point of a reaction is that it happens on someone
 * else's. It costs the attacker their reaction, uses their melee attack, and is
 * rolled by the server like every other attack.
 */
async function resolveOpportunityAttack(params: {
  campaignId: string;
  encounterId: string;
  attacker: CombatantView;
  target: CombatantView;
}): Promise<{ attackerName: string; hit: boolean; damage: number } | null> {
  const { attacker, target } = params;
  if (attacker.reactionUsed || attacker.defeated) return null;
  if (!canTakeActions({ conditions: attacker.conditions, exhaustion: attacker.exhaustion })) {
    return null;
  }

  const attack = attacker.attacks.find((a) => a.kind === "melee");
  if (!attack) return null;

  await db.update(combatants).set({ reactionUsed: true }).where(eq(combatants.id, attacker.id));

  const outcome = resolveAttack({
    attackBonus: attack.attackBonus,
    attacker: { conditions: attacker.conditions, exhaustion: attacker.exhaustion },
    target: asState(target),
    rangeFt: 5,
  });

  let damage = 0;
  if (outcome.hit) {
    const { roll, packet } = rollWeaponDamage(attack, { critical: outcome.critical });
    const result = applyDamage(asState(target), packet, { critical: outcome.critical });
    damage = result.adjusted;
    await db.update(combatants).set(result.patch).where(eq(combatants.id, target.id));
    await syncSheet(target.id);
    await checkConcentration({
      campaignId: params.campaignId,
      encounterId: params.encounterId,
      combatantId: target.id,
      damage,
    });

    await db.insert(rollsTable).values({
      campaignId: params.campaignId,
      encounterId: params.encounterId,
      actorType: "combatant",
      actorId: attacker.id,
      actorName: attacker.name,
      kind: "damage",
      formula: roll.formula,
      dice: roll.dice,
      modifier: roll.modifier,
      advantage: "normal",
      total: roll.total,
      targetName: target.name,
      dc: null,
      outcome: "opportunity attack",
    });
  }

  await db.insert(rollsTable).values({
    campaignId: params.campaignId,
    encounterId: params.encounterId,
    actorType: "combatant",
    actorId: attacker.id,
    actorName: attacker.name,
    kind: "attack",
    formula: outcome.roll.formula,
    dice: outcome.roll.dice,
    modifier: outcome.roll.modifier,
    advantage: outcome.advantage,
    total: outcome.roll.total,
    targetName: target.name,
    dc: target.ac,
    outcome: outcome.hit ? (outcome.critical ? "critical hit" : "hit") : "miss",
  });

  await appendEvent(params.campaignId, "combatant.updated", {
    encounterId: params.encounterId,
    combatantId: target.id,
    name: target.name,
    opportunityAttack: { by: attacker.name, hit: outcome.hit, damage },
  });

  return { attackerName: attacker.name, hit: outcome.hit, damage };
}

/**
 * A concentrating creature that takes damage must hold the spell or lose it.
 *
 * DC 10 or half the damage, whichever is higher. Rolled here rather than left
 * to the AI, because losing concentration changes what is on the battlefield.
 */
async function checkConcentration(params: {
  campaignId: string;
  encounterId: string;
  combatantId: string;
  damage: number;
}): Promise<{ spellName: string; held: boolean } | null> {
  if (params.damage <= 0) return null;

  const [row] = await db
    .select()
    .from(combatants)
    .where(eq(combatants.id, params.combatantId))
    .limit(1);
  if (!row?.concentration) return null;

  const dc = concentrationDc(params.damage);
  const saves = (row.stats as CombatStats | null)?.saveModifiers ?? {};
  const save = resolveSave({
    ability: "con",
    modifier: saves.con ?? 0,
    dc,
    creature: asState(row),
  });

  await db.insert(rollsTable).values({
    campaignId: params.campaignId,
    encounterId: params.encounterId,
    actorType: "combatant",
    actorId: row.id,
    actorName: row.name,
    kind: "save",
    formula: save.roll?.formula ?? "1d20",
    dice: save.roll?.dice ?? [],
    modifier: saves.con ?? 0,
    advantage: save.advantage,
    total: save.total,
    dc,
    outcome: save.success ? "concentration held" : "concentration broken",
  });

  const spellName = row.concentration.spellName;
  if (!save.success) {
    await db.update(combatants).set({ concentration: null }).where(eq(combatants.id, row.id));
    await appendEvent(params.campaignId, "combatant.updated", {
      encounterId: params.encounterId,
      combatantId: row.id,
      name: row.name,
      concentrationBroken: spellName,
    });
  }

  return { spellName, held: save.success };
}

/**
 * Strips what a player is not supposed to know before an encounter leaves the
 * server.
 *
 * A monster's stat block — saves, immunities, attack bonuses, CR — was sent
 * verbatim to every member. The AI DM refuses to read those numbers out when
 * asked, which made the refusal theatre while the API handed them over. A
 * player sees a foe's name, position and how hurt it looks; a co-DM runs the
 * monsters and needs their attacks.
 */
export function redactEncounter(view: EncounterView, canCommandMonsters: boolean): EncounterView {
  return {
    ...view,
    combatants: view.combatants.map((c) => {
      if (c.characterId || canCommandMonsters) return c;
      // Nulling `stats` hid saves, immunities and attack bonuses but left exact
      // hit points and armour class in the clear, so a table could still work
      // out the number they need to hit and how many points were left. The
      // client only draws a wound bar, so it gets the ratio and nothing else:
      // hpMax is normalised to 100 and hpCurrent becomes the percentage.
      const share = c.hpMax > 0 ? Math.round((c.hpCurrent / c.hpMax) * 100) : 0;
      return {
        ...c,
        stats: null,
        attacks: [],
        hpCurrent: c.hpCurrent > 0 ? Math.max(1, share) : 0,
        hpMax: 100,
        tempHp: 0,
        ac: 0,
      };
    }),
  };
}
