import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/**
 * Every SRD table is `(index, name, data)`. Filterable fields are Postgres
 * generated columns derived from `data`, so they cannot drift from the source
 * document — there is no code path that can write one without the other.
 */
const srdTable = <T extends string>(name: T) =>
  pgTable(name, {
    index: text("index").primaryKey(),
    name: text("name").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  });

/* ------------------------------------------------------------------ *
 * SRD reference data (imported, read-only)
 * ------------------------------------------------------------------ */

export const srdClasses = srdTable("srd_classes");
export const srdSubclasses = srdTable("srd_subclasses");
export const srdRaces = srdTable("srd_races");
export const srdSubraces = srdTable("srd_subraces");
export const srdTraits = srdTable("srd_traits");
export const srdBackgrounds = srdTable("srd_backgrounds");
export const srdEquipmentCategories = srdTable("srd_equipment_categories");
export const srdMagicItems = srdTable("srd_magic_items");
export const srdConditions = srdTable("srd_conditions");
export const srdSkills = srdTable("srd_skills");
export const srdProficiencies = srdTable("srd_proficiencies");
export const srdLanguages = srdTable("srd_languages");
export const srdDamageTypes = srdTable("srd_damage_types");
export const srdWeaponProperties = srdTable("srd_weapon_properties");
export const srdRuleSections = srdTable("srd_rule_sections");
export const srdRules = srdTable("srd_rules");
export const srdAbilityScores = srdTable("srd_ability_scores");
export const srdAlignments = srdTable("srd_alignments");
export const srdMagicSchools = srdTable("srd_magic_schools");
export const srdFeats = srdTable("srd_feats");

export const srdSpells = pgTable(
  "srd_spells",
  {
    index: text("index").primaryKey(),
    name: text("name").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    level: integer("level").generatedAlwaysAs(
      sql`((data ->> 'level'))::integer`,
    ),
    school: text("school").generatedAlwaysAs(
      sql`((data -> 'school') ->> 'index')`,
    ),
    concentration: boolean("concentration").generatedAlwaysAs(
      sql`((data ->> 'concentration'))::boolean`,
    ),
    ritual: boolean("ritual").generatedAlwaysAs(
      sql`((data ->> 'ritual'))::boolean`,
    ),
    /** Denormalized by the seed script — a subquery is illegal in a generated column. */
    classes: text("classes").array().notNull().default(sql`'{}'::text[]`),
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
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    cr: numeric("cr").generatedAlwaysAs(
      sql`((data ->> 'challenge_rating'))::numeric`,
    ),
    type: text("type").generatedAlwaysAs(sql`(data ->> 'type')`),
    size: text("size").generatedAlwaysAs(sql`(data ->> 'size')`),
  },
  (t) => [index("srd_monsters_cr_idx").on(t.cr), index("srd_monsters_type_idx").on(t.type)],
);

export const srdEquipment = pgTable(
  "srd_equipment",
  {
    index: text("index").primaryKey(),
    name: text("name").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    category: text("category").generatedAlwaysAs(
      sql`((data -> 'equipment_category') ->> 'index')`,
    ),
    /** Cost normalized to copper so ordering and budgets work across cp/sp/ep/gp/pp. */
    costCp: integer("cost_cp").generatedAlwaysAs(
      sql`(((data -> 'cost') ->> 'quantity')::integer * CASE ((data -> 'cost') ->> 'unit')
            WHEN 'cp' THEN 1
            WHEN 'sp' THEN 10
            WHEN 'ep' THEN 50
            WHEN 'gp' THEN 100
            WHEN 'pp' THEN 1000
            ELSE 1 END)`,
    ),
  },
  (t) => [index("srd_equipment_category_idx").on(t.category)],
);

export const srdFeatures = pgTable(
  "srd_features",
  {
    index: text("index").primaryKey(),
    name: text("name").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    className: text("class_name").generatedAlwaysAs(
      sql`((data -> 'class') ->> 'index')`,
    ),
    subclassName: text("subclass_name").generatedAlwaysAs(
      sql`((data -> 'subclass') ->> 'index')`,
    ),
    level: integer("level").generatedAlwaysAs(sql`((data ->> 'level'))::integer`),
  },
  (t) => [index("srd_features_class_level_idx").on(t.className, t.level)],
);

export const srdLevels = pgTable(
  "srd_levels",
  {
    index: text("index").primaryKey(),
    name: text("name").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    className: text("class_name").generatedAlwaysAs(
      sql`((data -> 'class') ->> 'index')`,
    ),
    subclassName: text("subclass_name").generatedAlwaysAs(
      sql`((data -> 'subclass') ->> 'index')`,
    ),
    level: integer("level").generatedAlwaysAs(sql`((data ->> 'level'))::integer`),
  },
  (t) => [index("srd_levels_class_level_idx").on(t.className, t.level)],
);

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  /** SHA-256 of the personal reclaim code; the plaintext is shown once, never stored. */
  reclaimCodeHash: text("reclaim_code_hash").notNull(),
  createdAt: createdAt(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("auth_sessions_token_hash_idx").on(t.tokenHash),
    index("auth_sessions_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ *
 * Campaign
 * ------------------------------------------------------------------ */

export type CampaignStatus = "lobby" | "active" | "paused" | "ended";
export type MemberRole = "player" | "co_dm" | "observer";

/**
 * Failed credential attempts, for throttling.
 *
 * A reclaim code is a full credential, so guessing must cost something. Serverless
 * functions share no memory, which leaves the database as the only place a
 * counter can actually be shared between them.
 */
export const authAttempts = pgTable(
  "auth_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Client IP, or "unknown" when the platform gives us nothing. */
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("auth_attempts_lookup_idx").on(t.fingerprint, t.kind, t.createdAt)],
);

/**
 * Ability scores a player rolled for a character they have not built yet.
 *
 * Rolling happens server-side like every other die, and the result is stored
 * so the build can be checked against it. Without that a client could simply
 * claim it had rolled six 18s.
 */
export const abilityRolls = pgTable(
  "ability_rolls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    /** The six totals, highest first. */
    scores: jsonb("scores").$type<number[]>().notNull(),
    /** Every die face, including the dropped one, so the roll is auditable. */
    rolls: jsonb("rolls").$type<{ dice: number[]; dropped: number; total: number }[]>().notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("ability_rolls_lookup_idx").on(t.userId, t.campaignId, t.createdAt)],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    joinCode: text("join_code").notNull(),
    status: text("status").$type<CampaignStatus>().notNull().default("lobby"),
    srdVersion: text("srd_version").notNull().default("2014"),
    tone: text("tone"),
    genre: text("genre"),
    premise: text("premise"),
    /** Monotonic per-campaign event cursor. Bumped under a row lock; see appendEvent. */
    eventSeq: bigint("event_seq", { mode: "number" }).notNull().default(0),
    currentLocationId: uuid("current_location_id"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("campaigns_join_code_idx").on(t.joinCode)],
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
    role: text("role").$type<MemberRole>().notNull().default("player"),
    /** When this member last opened the table, for the what-you-missed catch-up. */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.userId] })],
);

export const campaignSettings = pgTable("campaign_settings", {
  campaignId: uuid("campaign_id")
    .primaryKey()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  playMode: text("play_mode").$type<"live" | "async">().notNull().default("live"),
  difficulty: text("difficulty").notNull().default("standard"),
  variantFlanking: boolean("variant_flanking").notNull().default(false),
  /** "standard" = 5 ft per diagonal; "variant" = alternating 5/10. */
  diagonalMovement: text("diagonal_movement").notNull().default("standard"),
  encumbrance: boolean("encumbrance").notNull().default(false),
});

/* ------------------------------------------------------------------ *
 * Characters
 * ------------------------------------------------------------------ */

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    race: text("race").notNull(),
    subrace: text("subrace"),
    class: text("class").notNull(),
    subclass: text("subclass"),
    background: text("background"),
    alignment: text("alignment"),
    level: integer("level").notNull().default(1),
    xp: integer("xp").notNull().default(0),

    str: integer("str").notNull(),
    dex: integer("dex").notNull(),
    con: integer("con").notNull(),
    int: integer("int").notNull(),
    wis: integer("wis").notNull(),
    cha: integer("cha").notNull(),

    hpCurrent: integer("hp_current").notNull(),
    hpMax: integer("hp_max").notNull(),
    tempHp: integer("temp_hp").notNull().default(0),
    hitDiceRemaining: integer("hit_dice_remaining").notNull().default(1),

    deathSuccesses: integer("death_successes").notNull().default(0),
    deathFailures: integer("death_failures").notNull().default(0),
    stable: boolean("stable").notNull().default(false),

    conditions: jsonb("conditions").$type<string[]>().notNull().default([]),
    exhaustion: integer("exhaustion").notNull().default(0),
    inspiration: boolean("inspiration").notNull().default(false),

    portrait: bytea("portrait"),
    portraitMime: text("portrait_mime"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("characters_campaign_idx").on(t.campaignId)],
);

export const characterProficiencies = pgTable(
  "character_proficiencies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    /** skill | saving-throw | armor | weapon | tool | language */
    kind: text("kind").notNull(),
    proficiencyIndex: text("proficiency_index").notNull(),
    expertise: boolean("expertise").notNull().default(false),
    source: text("source"),
  },
  (t) => [index("character_proficiencies_character_idx").on(t.characterId)],
);

export const characterItems = pgTable(
  "character_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    itemIndex: text("item_index").notNull(),
    quantity: integer("quantity").notNull().default(1),
    equipped: boolean("equipped").notNull().default(false),
    attuned: boolean("attuned").notNull().default(false),
    custom: jsonb("custom").$type<Record<string, unknown>>(),
  },
  (t) => [index("character_items_character_idx").on(t.characterId)],
);

export const characterSpells = pgTable(
  "character_spells",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    spellIndex: text("spell_index").notNull(),
    prepared: boolean("prepared").notNull().default(false),
    alwaysPrepared: boolean("always_prepared").notNull().default(false),
    source: text("source"),
  },
  (t) => [index("character_spells_character_idx").on(t.characterId)],
);

export const spellSlots = pgTable(
  "spell_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    max: integer("max").notNull(),
    used: integer("used").notNull().default(0),
  },
  (t) => [uniqueIndex("spell_slots_character_level_idx").on(t.characterId, t.level)],
);

/* ------------------------------------------------------------------ *
 * Play
 * ------------------------------------------------------------------ */

export const maps = pgTable(
  "maps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    width: integer("width").notNull().default(20),
    height: integer("height").notNull().default(20),
    cellSizeFt: integer("cell_size_ft").notNull().default(5),
    /** { walls: [[x,y]...], difficult: [[x,y]...], cover: {"x,y": "half"|"three-quarters"|"total"} } */
    terrain: jsonb("terrain").$type<MapTerrain>().notNull().default({}),
    background: text("background"),
    createdAt: createdAt(),
  },
  (t) => [index("maps_campaign_idx").on(t.campaignId)],
);

export type MapTerrain = {
  walls?: [number, number][];
  difficult?: [number, number][];
  cover?: Record<string, "half" | "three-quarters" | "total">;
};

export const mapTokens = pgTable(
  "map_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mapId: uuid("map_id")
      .notNull()
      .references(() => maps.id, { onDelete: "cascade" }),
    characterId: uuid("character_id").references(() => characters.id, {
      onDelete: "cascade",
    }),
    combatantId: uuid("combatant_id"),
    label: text("label").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    /** Cells occupied per side: 1 = Medium/Small, 2 = Large, 3 = Huge. */
    size: integer("size").notNull().default(1),
    color: text("color").notNull().default("#64748b"),
    visible: boolean("visible").notNull().default(true),
  },
  (t) => [index("map_tokens_map_idx").on(t.mapId)],
);

export type EncounterStatus = "planned" | "active" | "resolved";

export const encounters = pgTable(
  "encounters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    mapId: uuid("map_id").references(() => maps.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    status: text("status").$type<EncounterStatus>().notNull().default("planned"),
    round: integer("round").notNull().default(0),
    turnIndex: integer("turn_index").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("encounters_campaign_idx").on(t.campaignId)],
);

export type Concentration = { spellIndex: string; spellName: string; level: number } | null;

export const combatants = pgTable(
  "combatants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id, { onDelete: "cascade" }),
    characterId: uuid("character_id").references(() => characters.id, {
      onDelete: "cascade",
    }),
    monsterIndex: text("monster_index"),
    name: text("name").notNull(),
    side: text("side").$type<"party" | "foe" | "neutral">().notNull().default("foe"),

    initiative: integer("initiative"),
    /** Dex score, used as the deterministic tiebreak before a coin flip. */
    initiativeTiebreak: integer("initiative_tiebreak").notNull().default(0),

    hpCurrent: integer("hp_current").notNull(),
    hpMax: integer("hp_max").notNull(),
    tempHp: integer("temp_hp").notNull().default(0),
    ac: integer("ac").notNull(),
    speed: integer("speed").notNull().default(30),

    conditions: jsonb("conditions").$type<string[]>().notNull().default([]),
    exhaustion: integer("exhaustion").notNull().default(0),
    concentration: jsonb("concentration").$type<Concentration>(),

    movementUsed: integer("movement_used").notNull().default(0),
    actionUsed: boolean("action_used").notNull().default(false),
    bonusUsed: boolean("bonus_used").notNull().default(false),
    reactionUsed: boolean("reaction_used").notNull().default(false),

    deathSuccesses: integer("death_successes").notNull().default(0),
    deathFailures: integer("death_failures").notNull().default(0),
    stable: boolean("stable").notNull().default(false),
    defeated: boolean("defeated").notNull().default(false),

    x: integer("x"),
    y: integer("y"),
    size: integer("size").notNull().default(1),

    /** Monster stat block snapshot, or derived character stats at roll-in time. */
    stats: jsonb("stats").$type<Record<string, unknown>>(),
  },
  (t) => [index("combatants_encounter_idx").on(t.encounterId)],
);

export type RollDie = { sides: number; value: number; kept: boolean };

export const rolls = pgTable(
  "rolls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    encounterId: uuid("encounter_id").references(() => encounters.id, {
      onDelete: "set null",
    }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    actorName: text("actor_name").notNull(),
    /** attack | damage | save | check | initiative | death_save | hit_dice | raw */
    kind: text("kind").notNull(),
    formula: text("formula").notNull(),
    dice: jsonb("dice").$type<RollDie[]>().notNull(),
    modifier: integer("modifier").notNull().default(0),
    advantage: text("advantage").$type<"normal" | "advantage" | "disadvantage">()
      .notNull()
      .default("normal"),
    total: integer("total").notNull(),
    targetName: text("target_name"),
    dc: integer("dc"),
    outcome: text("outcome"),
    createdAt: createdAt(),
  },
  (t) => [index("rolls_campaign_idx").on(t.campaignId, t.createdAt)],
);

export type MessageKind = "narration" | "dialogue" | "ooc" | "system" | "ruling" | "action";

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    authorType: text("author_type").$type<"player" | "dm" | "system">().notNull(),
    authorId: text("author_id"),
    authorName: text("author_name").notNull(),
    kind: text("kind").$type<MessageKind>().notNull().default("narration"),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_campaign_idx").on(t.campaignId, t.createdAt)],
);

/**
 * The realtime spine. Clients tail this with `?since=<seq>`; `seq` is allocated
 * per campaign under a row lock so it is gapless and strictly ordered, which is
 * what makes reconnection lossless.
 */
export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("events_campaign_seq_idx").on(t.campaignId, t.seq)],
);

export const asyncTurns = pgTable(
  "async_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    characterId: uuid("character_id").references(() => characters.id, {
      onDelete: "cascade",
    }),
    content: text("content").notNull(),
    submittedAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    dmResponseMessageId: uuid("dm_response_message_id"),
  },
  (t) => [index("async_turns_campaign_idx").on(t.campaignId)],
);

/* ------------------------------------------------------------------ *
 * AI DM structured memory
 *
 * Every DM turn reads a compact projection of these tables — never raw chat
 * history — and writes back through a validated tool call.
 * ------------------------------------------------------------------ */

export const campaignArcs = pgTable("campaign_arcs", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  premise: text("premise").notNull(),
  acts: jsonb("acts").$type<{ title: string; summary: string }[]>().notNull().default([]),
  currentAct: integer("current_act").notNull().default(1),
  themes: text("themes").array().notNull().default(sql`'{}'::text[]`),
  plannedClimax: text("planned_climax"),
  createdAt: createdAt(),
});

export type ThreadStatus = "open" | "advanced" | "resolved" | "abandoned";

export const plotThreads = pgTable(
  "plot_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").$type<ThreadStatus>().notNull().default("open"),
    summary: text("summary").notNull(),
    urgency: integer("urgency").notNull().default(3),
    lastTouched: timestamp("last_touched", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("plot_threads_campaign_idx").on(t.campaignId)],
);

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type"),
    description: text("description"),
    discovered: boolean("discovered").notNull().default(false),
    parentId: uuid("parent_id"),
    notableFeatures: text("notable_features").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [index("locations_campaign_idx").on(t.campaignId)],
);

export const npcs = pgTable(
  "npcs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: text("role"),
    /** -100 (hostile) .. 100 (devoted). */
    disposition: integer("disposition").notNull().default(0),
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    description: text("description"),
    voice: text("voice"),
    secrets: text("secrets"),
    monsterIndex: text("monster_index"),
    alive: boolean("alive").notNull().default(true),
  },
  (t) => [index("npcs_campaign_idx").on(t.campaignId)],
);

export const npcRelationships = pgTable("npc_relationships", {
  id: uuid("id").primaryKey().defaultRandom(),
  npcId: uuid("npc_id")
    .notNull()
    .references(() => npcs.id, { onDelete: "cascade" }),
  subjectType: text("subject_type").$type<"npc" | "character">().notNull(),
  subjectId: uuid("subject_id").notNull(),
  nature: text("nature").notNull(),
  strength: integer("strength").notNull().default(1),
});

export const quests = pgTable(
  "quests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("offered"),
    giverNpcId: uuid("giver_npc_id").references(() => npcs.id, { onDelete: "set null" }),
    objectives: jsonb("objectives")
      .$type<{ text: string; done: boolean }[]>()
      .notNull()
      .default([]),
    rewards: text("rewards"),
    progress: integer("progress").notNull().default(0),
  },
  (t) => [index("quests_campaign_idx").on(t.campaignId)],
);

export const partyDecisions = pgTable("party_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  consequences: text("consequences"),
  sessionNumber: integer("session_number"),
  createdAt: createdAt(),
});

export const sessionLogs = pgTable("session_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  recap: text("recap"),
  highlights: text("highlights").array().notNull().default(sql`'{}'::text[]`),
  xpAwarded: integer("xp_awarded").notNull().default(0),
});

export const worldFacts = pgTable(
  "world_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    fact: text("fact").notNull(),
    category: text("category"),
    createdAt: createdAt(),
  },
  (t) => [index("world_facts_campaign_idx").on(t.campaignId)],
);
