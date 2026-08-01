CREATE TABLE "async_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"character_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"dm_response_message_id" uuid
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_arcs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"title" text NOT NULL,
	"premise" text NOT NULL,
	"acts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_act" smallint DEFAULT 1 NOT NULL,
	"themes" text[] DEFAULT '{}'::text[] NOT NULL,
	"planned_climax" text
);
--> statement-breakpoint
CREATE TABLE "campaign_members" (
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'player' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_members_campaign_id_user_id_pk" PRIMARY KEY("campaign_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "campaign_settings" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"play_mode" text DEFAULT 'live' NOT NULL,
	"difficulty" text DEFAULT 'standard' NOT NULL,
	"variant_flanking" boolean DEFAULT false NOT NULL,
	"variant_diagonals" boolean DEFAULT false NOT NULL,
	"variant_encumbrance" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"join_code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"srd_version" text DEFAULT '2014' NOT NULL,
	"tone" text,
	"genre" text,
	"current_location_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"item_index" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"equipped" boolean DEFAULT false NOT NULL,
	"attuned" boolean DEFAULT false NOT NULL,
	"custom_name" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "character_proficiencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"expertise" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "character_spells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"spell_index" text NOT NULL,
	"known" boolean DEFAULT true NOT NULL,
	"prepared" boolean DEFAULT false NOT NULL,
	"always_prepared" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"race" text NOT NULL,
	"subrace" text,
	"class" text NOT NULL,
	"subclass" text,
	"background" text,
	"alignment" text,
	"level" smallint DEFAULT 1 NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"strength" smallint NOT NULL,
	"dexterity" smallint NOT NULL,
	"constitution" smallint NOT NULL,
	"intelligence" smallint NOT NULL,
	"wisdom" smallint NOT NULL,
	"charisma" smallint NOT NULL,
	"hp_current" integer NOT NULL,
	"hp_max" integer NOT NULL,
	"temp_hp" integer DEFAULT 0 NOT NULL,
	"hit_dice_remaining" smallint DEFAULT 1 NOT NULL,
	"death_save_successes" smallint DEFAULT 0 NOT NULL,
	"death_save_failures" smallint DEFAULT 0 NOT NULL,
	"conditions" text[] DEFAULT '{}'::text[] NOT NULL,
	"exhaustion" smallint DEFAULT 0 NOT NULL,
	"inspiration" boolean DEFAULT false NOT NULL,
	"portrait" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "combatants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"source" text NOT NULL,
	"character_id" uuid,
	"monster_index" text,
	"name" text NOT NULL,
	"initiative" smallint,
	"initiative_tiebreak" integer DEFAULT 0 NOT NULL,
	"hp_current" integer NOT NULL,
	"hp_max" integer NOT NULL,
	"temp_hp" integer DEFAULT 0 NOT NULL,
	"ac" smallint NOT NULL,
	"conditions" text[] DEFAULT '{}'::text[] NOT NULL,
	"concentration_spell" text,
	"concentration_dc" smallint,
	"movement_used_ft" integer DEFAULT 0 NOT NULL,
	"action_used" boolean DEFAULT false NOT NULL,
	"bonus_action_used" boolean DEFAULT false NOT NULL,
	"reaction_used" boolean DEFAULT false NOT NULL,
	"death_save_successes" smallint DEFAULT 0 NOT NULL,
	"death_save_failures" smallint DEFAULT 0 NOT NULL,
	"x" integer,
	"y" integer
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"active_combatant_id" uuid,
	"map_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"description" text,
	"discovered" boolean DEFAULT false NOT NULL,
	"parent_id" uuid,
	"notable_features" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"map_id" uuid NOT NULL,
	"character_id" uuid,
	"monster_index" text,
	"label" text,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"size_cells" smallint DEFAULT 1 NOT NULL,
	"color" text,
	"image" text,
	"visible" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"width_cells" integer NOT NULL,
	"height_cells" integer NOT NULL,
	"cell_size_ft" smallint DEFAULT 5 NOT NULL,
	"terrain" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"background" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"author_type" text NOT NULL,
	"author_user_id" uuid,
	"kind" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "npc_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"npc_id" uuid NOT NULL,
	"subject_npc_id" uuid,
	"subject_character_id" uuid,
	"nature" text NOT NULL,
	"strength" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "npcs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"disposition_to_party" smallint DEFAULT 0 NOT NULL,
	"location_id" uuid,
	"description" text,
	"voice_notes" text,
	"secrets" text,
	"alive" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "party_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"session_log_id" uuid,
	"summary" text NOT NULL,
	"consequences" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plot_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"summary" text NOT NULL,
	"urgency" smallint DEFAULT 3 NOT NULL,
	"last_touched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'offered' NOT NULL,
	"giver_npc_id" uuid,
	"objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rewards" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" text
);
--> statement-breakpoint
CREATE TABLE "rolls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"encounter_id" uuid,
	"actor_label" text NOT NULL,
	"character_id" uuid,
	"kind" text NOT NULL,
	"formula" text NOT NULL,
	"dice" integer[] NOT NULL,
	"discarded" integer[] DEFAULT '{}'::int[] NOT NULL,
	"modifier" integer DEFAULT 0 NOT NULL,
	"advantage" text DEFAULT 'normal' NOT NULL,
	"total" integer NOT NULL,
	"target_label" text,
	"dc" smallint,
	"outcome" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"recap" text,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"xp_awarded" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spell_slots" (
	"character_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"max" smallint NOT NULL,
	"used" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "spell_slots_character_id_level_pk" PRIMARY KEY("character_id","level")
);
--> statement-breakpoint
CREATE TABLE "srd_backgrounds" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_classes" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_conditions" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_damage_types" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_equipment" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"category" text NOT NULL,
	"cost_cp" integer
);
--> statement-breakpoint
CREATE TABLE "srd_equipment_categories" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_features" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_languages" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_levels" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_magic_items" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_monsters" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"cr_x100" integer NOT NULL,
	"type" text NOT NULL,
	"size" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_proficiencies" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_races" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_rule_sections" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_skills" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_spells" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"level" smallint NOT NULL,
	"school" text NOT NULL,
	"classes" text[] DEFAULT '{}'::text[] NOT NULL,
	"ritual" boolean DEFAULT false NOT NULL,
	"concentration" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_subclasses" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_subraces" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_traits" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "srd_weapon_properties" (
	"index" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"reclaim_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"fact" text NOT NULL,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "async_turns" ADD CONSTRAINT "async_turns_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "async_turns" ADD CONSTRAINT "async_turns_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "async_turns" ADD CONSTRAINT "async_turns_dm_response_message_id_messages_id_fk" FOREIGN KEY ("dm_response_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_arcs" ADD CONSTRAINT "campaign_arcs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_members" ADD CONSTRAINT "campaign_members_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_members" ADD CONSTRAINT "campaign_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_settings" ADD CONSTRAINT "campaign_settings_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_items" ADD CONSTRAINT "character_items_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_proficiencies" ADD CONSTRAINT "character_proficiencies_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_spells" ADD CONSTRAINT "character_spells_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combatants" ADD CONSTRAINT "combatants_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "combatants" ADD CONSTRAINT "combatants_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_tokens" ADD CONSTRAINT "map_tokens_map_id_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_tokens" ADD CONSTRAINT "map_tokens_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maps" ADD CONSTRAINT "maps_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_relationships" ADD CONSTRAINT "npc_relationships_npc_id_npcs_id_fk" FOREIGN KEY ("npc_id") REFERENCES "public"."npcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_relationships" ADD CONSTRAINT "npc_relationships_subject_npc_id_npcs_id_fk" FOREIGN KEY ("subject_npc_id") REFERENCES "public"."npcs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npc_relationships" ADD CONSTRAINT "npc_relationships_subject_character_id_characters_id_fk" FOREIGN KEY ("subject_character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npcs" ADD CONSTRAINT "npcs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "npcs" ADD CONSTRAINT "npcs_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_decisions" ADD CONSTRAINT "party_decisions_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "party_decisions" ADD CONSTRAINT "party_decisions_session_log_id_session_logs_id_fk" FOREIGN KEY ("session_log_id") REFERENCES "public"."session_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot_threads" ADD CONSTRAINT "plot_threads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quests" ADD CONSTRAINT "quests_giver_npc_id_npcs_id_fk" FOREIGN KEY ("giver_npc_id") REFERENCES "public"."npcs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rolls" ADD CONSTRAINT "rolls_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spell_slots" ADD CONSTRAINT "spell_slots_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_facts" ADD CONSTRAINT "world_facts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "async_turns_campaign_idx" ON "async_turns" USING btree ("campaign_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_join_code_key" ON "campaigns" USING btree ("join_code");--> statement-breakpoint
CREATE INDEX "character_items_character_idx" ON "character_items" USING btree ("character_id");--> statement-breakpoint
CREATE UNIQUE INDEX "character_proficiencies_key" ON "character_proficiencies" USING btree ("character_id","kind","value");--> statement-breakpoint
CREATE UNIQUE INDEX "character_spells_key" ON "character_spells" USING btree ("character_id","spell_index");--> statement-breakpoint
CREATE INDEX "characters_campaign_idx" ON "characters" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "combatants_encounter_idx" ON "combatants" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "encounters_campaign_idx" ON "encounters" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_campaign_seq_key" ON "events" USING btree ("campaign_id","seq");--> statement-breakpoint
CREATE INDEX "locations_campaign_idx" ON "locations" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "map_tokens_map_idx" ON "map_tokens" USING btree ("map_id");--> statement-breakpoint
CREATE INDEX "maps_campaign_idx" ON "maps" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "messages_campaign_idx" ON "messages" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "npc_relationships_npc_idx" ON "npc_relationships" USING btree ("npc_id");--> statement-breakpoint
CREATE INDEX "npcs_campaign_idx" ON "npcs" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "party_decisions_campaign_idx" ON "party_decisions" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "plot_threads_campaign_idx" ON "plot_threads" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "quests_campaign_idx" ON "quests" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "rolls_campaign_idx" ON "rolls" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_logs_campaign_number_key" ON "session_logs" USING btree ("campaign_id","number");--> statement-breakpoint
CREATE INDEX "srd_equipment_category_idx" ON "srd_equipment" USING btree ("category");--> statement-breakpoint
CREATE INDEX "srd_monsters_cr_idx" ON "srd_monsters" USING btree ("cr_x100");--> statement-breakpoint
CREATE INDEX "srd_monsters_type_idx" ON "srd_monsters" USING btree ("type");--> statement-breakpoint
CREATE INDEX "srd_spells_level_idx" ON "srd_spells" USING btree ("level");--> statement-breakpoint
CREATE INDEX "srd_spells_school_idx" ON "srd_spells" USING btree ("school");--> statement-breakpoint
CREATE UNIQUE INDEX "users_reclaim_code_key" ON "users" USING btree ("reclaim_code");--> statement-breakpoint
CREATE INDEX "world_facts_campaign_idx" ON "world_facts" USING btree ("campaign_id");