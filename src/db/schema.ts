/**
 * Database schema — see PLAN.md §2.
 *
 * Two rules shape everything here:
 *   1. Derived character values (AC, saves, attack bonuses, spell save DC,
 *      proficiency bonus, passive perception, initiative) are NEVER columns.
 *      `deriveCharacter()` in src/rules is the single source of truth.
 *   2. Every state mutation writes an `events` row. That log is the realtime
 *      transport and the reconnect cursor.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ *
 * SRD reference data (imported, read-only)
 * ------------------------------------------------------------------ */

/**
 * Every SRD table has the same shape: a stable string index, a name, and the
 * raw document. Filterable fields are pulled out per-table where we need them.
 */
const srdTable = (name: string) =>
  pgTable(name, {
    index: text("index").primaryKey(),
    name: text("name").notNull(),
    data: jsonb("data").notNull(),
  });

export const srdClasses = srdTable("srd_classes");
export const srdSubclasses = srdTable("srd_subclasses");
export const srdRaces = srdTable("srd_races");
export const srdSubraces = srdTable("srd_subraces");
export const srdTraits = srdTable("srd_traits");
export const srdBackgrounds = srdTable("srd_backgrounds");
export const srdFeatures = srdTable("srd_features");
export const srdLevels = srdTable("srd_levels");
export const srdConditions = srdTable("srd_conditions");
export const srdSkills = srdTable("srd_skills");
export const srdProficiencies = srdTable("srd_proficiencies");
export const srdLanguages = srdTable("srd_languages");
export const srdDamageTypes = srdTable("srd_damage_types");
export const srdWeaponProperties = srdTable("srd_weapon_properties");
export const srdMagicItems = srdTable("srd_magic_items");
export const srdEquipmentCategories = srdTable("srd_equipment_categories");
export const srdRuleSections = srdTable("srd_rule_sections");

export const srdSpells = pgTable(
  "srd_spells",
  {
    index: text("index").primaryKey(),
    name: text("name").notNull(),
    data: jsonb("data").notNull(),
    level: smallint("level").notNull(),
    school: text("school").notNull(),
    classes: text("classes").array().notNull().default(sql`'{}'::text[]`),
    ritual: boolean("ritual").notNull().default(false),
    concentration: boolean("concentration").notNull().default(false),
  },
  (t) => [
    index("srd_spells_level_idx").on(t.level),
    index("srd_spells_school_idx").on(t.school),
  ],
);

export const srdMonsters = pgTable(
  "srd_monsters",
  {
    index: text("index").primaryKey(),
    name: text("name").notNull(),
    data: jsonb("data").notNull(),
    /** CR is stored x100 so 1/8 (0.125) stays exact and sortable. */
    crX100: integer("cr_x100").notNull(),
    type: text("type").notNull(),
    size: text("size").notNull(),
  },
  (t) => [
    index("srd_monsters_cr_idx").on(t.crX100),
    index("srd_monsters_type_idx").on(t.type),
  ],
);

export const srdEquipment = pgTable(
  "srd_equipment",
  {
    index: text("index").primaryKey(),
    name: text("name").notNull(),
    data: jsonb("data").notNull(),
    category: text("category").notNull(),
    costCp: integer("cost_cp"),
  },
  (t) => [index("srd_equipment_category_idx").on(t.category)],
);

/* ------------------------------------------------------------------ *
 * Identity & campaign
 * ------------------------------------------------------------------ */

/**
 * No passwords, no email. A player is a display name plus a device cookie;
 * `reclaimCode` is the escape hatch for moving to another device.
 */
export const users = pgTable(
  "users",
  {
    id: id(),
    displayName: text("display_name").notNull(),
    reclaimCode: text("reclaim_code").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_reclaim_code_key").on(t.reclaimCode)],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("auth_sessions_token_hash_key").on(t.tokenHash),
    index("auth_sessions_user_idx").on(t.userId),
  ],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    name: text("name").notNull(),
    joinCode: text("join_code").notNull(),
    status: text("status").notNull().default("active"),
    srdVersion: text("srd_version").notNull().default("2014"),
    tone: text("tone"),
    genre: text("genre"),
    currentLocationId: uuid("current_location_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("campaigns_join_code_key").on(t.joinCode)],
);

export const campaignMembers = pgTable(
  "campaign_members",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** player | co_dm | observer */
    role: text("role").notNull().default("player"),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.userId] })],
);

export const campaignSettings = pgTable("campaign_settings", {
  campaignId: uuid("campaign_id")
    .primaryKey()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  /** live | async */
  playMode: text("play_mode").notNull().default("live"),
  difficulty: text("difficulty").notNull().default("standard"),
  variantFlanking: boolean("variant_flanking").notNull().default(false),
  /** false = 5 ft per diagonal (PHB); true = 5/10/5 (DMG variant). */
  variantDiagonals: boolean("variant_diagonals").notNull().default(false),
  variantEncumbrance: boolean("variant_encumbrance").notNull().default(false),
});

/* ------------------------------------------------------------------ *
 * Characters
 * ------------------------------------------------------------------ */

export const characters = pgTable(
  "characters",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),

    race: text("race").notNull(),
    subrace: text("subrace"),
    class: text("class").notNull(),
    subclass: text("subclass"),
    background: text("background"),
    alignment: text("alignment"),
    level: smallint("level").notNull().default(1),
    xp: integer("xp").notNull().default(0),

    strength: smallint("strength").notNull(),
    dexterity: smallint("dexterity").notNull(),
    constitution: smallint("constitution").notNull(),
    intelligence: smallint("intelligence").notNull(),
    wisdom: smallint("wisdom").notNull(),
    charisma: smallint("charisma").notNull(),

    hpCurrent: integer("hp_current").notNull(),
    hpMax: integer("hp_max").notNull(),
    tempHp: integer("temp_hp").notNull().default(0),
    hitDiceRemaining: smallint("hit_dice_remaining").notNull().default(1),
    deathSaveSuccesses: smallint("death_save_successes").notNull().default(0),
    deathSaveFailures: smallint("death_save_failures").notNull().default(0),

    conditions: text("conditions").array().notNull().default(sql`'{}'::text[]`),
    exhaustion: smallint("exhaustion").notNull().default(0),
    inspiration: boolean("inspiration").notNull().default(false),

    portrait: text("portrait"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("characters_campaign_idx").on(t.campaignId)],
);

export const characterProficiencies = pgTable(
  "character_proficiencies",
  {
    id: id(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    /** skill | save | armor | weapon | tool | language */
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    expertise: boolean("expertise").notNull().default(false),
  },
  (t) => [
    uniqueIndex("character_proficiencies_key").on(t.characterId, t.kind, t.value),
  ],
);

export const characterItems = pgTable(
  "character_items",
  {
    id: id(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    itemIndex: text("item_index").notNull(),
    quantity: integer("quantity").notNull().default(1),
    equipped: boolean("equipped").notNull().default(false),
    attuned: boolean("attuned").notNull().default(false),
    customName: text("custom_name"),
    notes: text("notes"),
  },
  (t) => [index("character_items_character_idx").on(t.characterId)],
);

export const characterSpells = pgTable(
  "character_spells",
  {
    id: id(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    spellIndex: text("spell_index").notNull(),
    known: boolean("known").notNull().default(true),
    prepared: boolean("prepared").notNull().default(false),
    /** Domain/pact/racial spells that are always prepared and don't count to the limit. */
    alwaysPrepared: boolean("always_prepared").notNull().default(false),
  },
  (t) => [
    uniqueIndex("character_spells_key").on(t.characterId, t.spellIndex),
  ],
);

export const spellSlots = pgTable(
  "spell_slots",
  {
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    level: smallint("level").notNull(),
    max: smallint("max").notNull(),
    used: smallint("used").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.level] })],
);

/* ------------------------------------------------------------------ *
 * Play
 * ------------------------------------------------------------------ */

export const maps = pgTable(
  "maps",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    widthCells: integer("width_cells").notNull(),
    heightCells: integer("height_cells").notNull(),
    cellSizeFt: smallint("cell_size_ft").notNull().default(5),
    terrain: jsonb("terrain").notNull().default(sql`'{}'::jsonb`),
    background: text("background"),
    createdAt: createdAt(),
  },
  (t) => [index("maps_campaign_idx").on(t.campaignId)],
);

export const mapTokens = pgTable(
  "map_tokens",
  {
    id: id(),
    mapId: uuid("map_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    characterId: uuid("character_id").references(() => characters.id, {
      onDelete: "cascade",
    }),
    /** Set when the token is a monster rather than a PC. */
    monsterIndex: text("monster_index"),
    label: text("label"),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    /** Footprint in cells: 1 for Medium, 2 for Large, and so on. */
    sizeCells: smallint("size_cells").notNull().default(1),
    color: text("color"),
    image: text("image"),
    visible: boolean("visible").notNull().default(true),
  },
  (t) => [index("map_tokens_map_idx").on(t.mapId)],
);

export const encounters = pgTable(
  "encounters",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** pending | active | complete */
    status: text("status").notNull().default("pending"),
    round: integer("round").notNull().default(0),
    activeCombatantId: uuid("active_combatant_id"),
    mapId: uuid("map_id").references(() => maps.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("encounters_campaign_idx").on(t.campaignId)],
);

export const combatants = pgTable(
  "combatants",
  {
    id: id(),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    /** character | monster */
    source: text("source").notNull(),
    characterId: uuid("character_id").references(() => characters.id, {
      onDelete: "cascade",
    }),
    monsterIndex: text("monster_index"),
    name: text("name").notNull(),

    initiative: smallint("initiative"),
    /** Dex modifier, then a stable random, so ties resolve deterministically. */
    initiativeTiebreak: integer("initiative_tiebreak").notNull().default(0),

    hpCurrent: integer("hp_current").notNull(),
    hpMax: integer("hp_max").notNull(),
    tempHp: integer("temp_hp").notNull().default(0),
    ac: smallint("ac").notNull(),
    conditions: text("conditions").array().notNull().default(sql`'{}'::text[]`),

    concentrationSpell: text("concentration_spell"),
    concentrationDc: smallint("concentration_dc"),

    movementUsedFt: integer("movement_used_ft").notNull().default(0),
    actionUsed: boolean("action_used").notNull().default(false),
    bonusActionUsed: boolean("bonus_action_used").notNull().default(false),
    reactionUsed: boolean("reaction_used").notNull().default(false),

    deathSaveSuccesses: smallint("death_save_successes").notNull().default(0),
    deathSaveFailures: smallint("death_save_failures").notNull().default(0),

    x: integer("x"),
    y: integer("y"),
  },
  (t) => [index("combatants_encounter_idx").on(t.encounterId)],
);

/**
 * Every roll the server makes, kept forever. Individual die faces are stored so
 * a player can audit any total — house rule 3.
 */
export const rolls = pgTable(
  "rolls",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    encounterId: uuid("encounter_id").references(() => encounters.id, {
      onDelete: "set null",
    }),
    actorLabel: text("actor_label").notNull(),
    characterId: uuid("character_id").references(() => characters.id, {
      onDelete: "set null",
    }),
    /** attack | damage | save | check | initiative | death_save | hit_die | raw */
    kind: text("kind").notNull(),
    formula: text("formula").notNull(),
    dice: integer("dice").array().notNull(),
    /** Faces rolled and dropped by advantage/disadvantage, kept for the audit trail. */
    discarded: integer("discarded").array().notNull().default(sql`'{}'::int[]`),
    modifier: integer("modifier").notNull().default(0),
    /** normal | advantage | disadvantage */
    advantage: text("advantage").notNull().default("normal"),
    total: integer("total").notNull(),
    targetLabel: text("target_label"),
    dc: smallint("dc"),
    /** hit | miss | crit | crit_fail | success | failure */
    outcome: text("outcome"),
    createdAt: createdAt(),
  },
  (t) => [index("rolls_campaign_idx").on(t.campaignId, t.createdAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    /** player | dm | system */
    authorType: text("author_type").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** narration | dialogue | ooc | system | ruling */
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("messages_campaign_idx").on(t.campaignId, t.createdAt)],
);

/**
 * The realtime log. `seq` is per-campaign and monotonic; clients resume with
 * `?since=<seq>` after any disconnect, so a mid-combat refresh loses nothing.
 */
export const events = pgTable(
  "events",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("events_campaign_seq_key").on(t.campaignId, t.seq)],
);

export const asyncTurns = pgTable(
  "async_turns",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    submittedAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    dmResponseMessageId: uuid("dm_response_message_id").references(
      () => messages.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [index("async_turns_campaign_idx").on(t.campaignId, t.resolvedAt)],
);

/* ------------------------------------------------------------------ *
 * AI DM structured memory (house rule 6)
 *
 * The DM reads a compact projection of these tables, not raw chat history,
 * and writes back through a validated tool call.
 * ------------------------------------------------------------------ */

export const campaignArcs = pgTable("campaign_arcs", {
  id: id(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  premise: text("premise").notNull(),
  acts: jsonb("acts").notNull().default(sql`'[]'::jsonb`),
  currentAct: smallint("current_act").notNull().default(1),
  themes: text("themes").array().notNull().default(sql`'{}'::text[]`),
  plannedClimax: text("planned_climax"),
});

export const plotThreads = pgTable(
  "plot_threads",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** open | advanced | resolved | abandoned */
    status: text("status").notNull().default("open"),
    summary: text("summary").notNull(),
    urgency: smallint("urgency").notNull().default(3),
    lastTouchedAt: timestamp("last_touched_at", { withTimezone: true }),
  },
  (t) => [index("plot_threads_campaign_idx").on(t.campaignId, t.status)],
);

export const locations = pgTable(
  "locations",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type"),
    description: text("description"),
    discovered: boolean("discovered").notNull().default(false),
    parentId: uuid("parent_id"),
    notableFeatures: jsonb("notable_features").notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [index("locations_campaign_idx").on(t.campaignId)],
);

export const npcs = pgTable(
  "npcs",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role"),
    /** -100 (hostile) .. 100 (devoted) */
    dispositionToParty: smallint("disposition_to_party").notNull().default(0),
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    voiceNotes: text("voice_notes"),
    secrets: text("secrets"),
    alive: boolean("alive").notNull().default(true),
  },
  (t) => [index("npcs_campaign_idx").on(t.campaignId)],
);

export const npcRelationships = pgTable(
  "npc_relationships",
  {
    id: id(),
    npcId: uuid("npc_id")
      .notNull()
      .references(() => npcs.id, { onDelete: "cascade" }),
    subjectNpcId: uuid("subject_npc_id").references(() => npcs.id, {
      onDelete: "cascade",
    }),
    subjectCharacterId: uuid("subject_character_id").references(
      () => characters.id,
      { onDelete: "cascade" },
    ),
    nature: text("nature").notNull(),
    strength: smallint("strength").notNull().default(0),
  },
  (t) => [index("npc_relationships_npc_idx").on(t.npcId)],
);

export const quests = pgTable(
  "quests",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** offered | active | complete | failed */
    status: text("status").notNull().default("offered"),
    giverNpcId: uuid("giver_npc_id").references(() => npcs.id, {
      onDelete: "set null",
    }),
    objectives: jsonb("objectives").notNull().default(sql`'[]'::jsonb`),
    rewards: jsonb("rewards").notNull().default(sql`'{}'::jsonb`),
    progress: text("progress"),
  },
  (t) => [index("quests_campaign_idx").on(t.campaignId, t.status)],
);

export const sessionLogs = pgTable(
  "session_logs",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    recap: text("recap"),
    highlights: jsonb("highlights").notNull().default(sql`'[]'::jsonb`),
    xpAwarded: integer("xp_awarded").notNull().default(0),
  },
  (t) => [uniqueIndex("session_logs_campaign_number_key").on(t.campaignId, t.number)],
);

export const partyDecisions = pgTable(
  "party_decisions",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    sessionLogId: uuid("session_log_id").references(() => sessionLogs.id, {
      onDelete: "set null",
    }),
    summary: text("summary").notNull(),
    consequences: text("consequences"),
    createdAt: createdAt(),
  },
  (t) => [index("party_decisions_campaign_idx").on(t.campaignId)],
);

/** Durable canon the DM must not contradict. */
export const worldFacts = pgTable(
  "world_facts",
  {
    id: id(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    fact: text("fact").notNull(),
    category: text("category"),
    establishedAt: createdAt(),
  },
  (t) => [index("world_facts_campaign_idx").on(t.campaignId)],
);

/* ------------------------------------------------------------------ *
 * Relations
 * ------------------------------------------------------------------ */

export const campaignRelations = relations(campaigns, ({ many, one }) => ({
  members: many(campaignMembers),
  characters: many(characters),
  encounters: many(encounters),
  messages: many(messages),
  events: many(events),
  settings: one(campaignSettings, {
    fields: [campaigns.id],
    references: [campaignSettings.campaignId],
  }),
}));

export const characterRelations = relations(characters, ({ many, one }) => ({
  campaign: one(campaigns, {
    fields: [characters.campaignId],
    references: [campaigns.id],
  }),
  proficiencies: many(characterProficiencies),
  items: many(characterItems),
  spells: many(characterSpells),
  slots: many(spellSlots),
}));

export const encounterRelations = relations(encounters, ({ many, one }) => ({
  campaign: one(campaigns, {
    fields: [encounters.campaignId],
    references: [campaigns.id],
  }),
  combatants: many(combatants),
  map: one(maps, { fields: [encounters.mapId], references: [maps.id] }),
}));
