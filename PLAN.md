# AI Dungeon Master — Foundation Plan

A multiplayer D&D 5e virtual tabletop with a built-in AI DM. The app is the referee:
it owns the rules, the dice, and the sheets. The AI owns the story.

---

## 1. Architecture

| Concern | Decision | Why |
|---|---|---|
| Framework | Next.js 15 (App Router), TypeScript, React 19 | Vercel-native; server actions + route handlers keep all rules logic server-side by construction |
| Database | Neon Postgres + Drizzle ORM | Required by house rule 8; Drizzle gives typed migrations and works with both the Neon serverless driver and plain `pg` |
| Realtime | SSE stream over a Postgres event log, cursor-based | No third-party realtime service, no extra credential, and cursor resume means a mid-combat refresh loses nothing (house rule 4) |
| AI | Anthropic API, two-tier | `claude-haiku-4-5` for intent parsing + state updates; `claude-opus-5` for narration and campaign generation |
| Dice | `crypto.randomInt` server-side only, every roll persisted | House rule 3 |
| 3D dice | `@3d-dice/dice-box-threejs` with **predetermined results** | The animation replays the server's roll; it never generates one |
| Map | React + Canvas, 5 ft grid | Movement/range validated server-side, not in the renderer |
| Auth | Join code + display name + signed httpOnly cookie, plus a personal reclaim code for cross-device | A D&D group should not need to make accounts; still gives stable player identity across refreshes and devices |
| Styling | Tailwind v4, system font stack, mobile-first | House rule 7 — no parchment, no gothic body text |

### Why SSE + an event log instead of WebSockets

Vercel's serverless runtime has no long-lived socket server. The options were a paid
third-party (Pusher/Ably — another credential, another dependency) or something built
on the database I already need. I chose the latter:

Every state mutation writes a row to `events (campaign_id, seq, type, payload)`. Clients
open `GET /api/campaigns/[id]/stream?since=<seq>` — a Node-runtime streaming route that
tails the event log and pushes deltas. `EventSource` reconnects on its own, and the
`since` cursor makes reconnection lossless. The same cursor endpoint doubles as the
polling fallback and as the "catch me up" query for async players.

Consequence: updates land in well under a second rather than truly instantly. For a
tabletop — where the slow part is a human deciding what to do — that is the right
trade for zero external services and no lost state.

### Trust boundary

The AI DM never returns numbers that matter. It returns **intents** via tool-use
(`attack(actor, target, weapon)`, `cast(actor, spell, targets, slot_level)`,
`apply_condition(target, condition)`, `move(actor, x, y)`). The server validates each
intent against the rules engine, rolls the dice, applies the result, and hands the
outcome back to the AI to narrate. An AI that hallucinates "you hit for 14" cannot
change a single hit point.

Anything the engine can't adjudicate is escalated to the AI and rendered in the log as
a visually distinct **DM Ruling** card (house rule 2).

---

## 2. Schema

### SRD reference data (imported, read-only)
`srd_classes`, `srd_subclasses`, `srd_races`, `srd_subraces`, `srd_traits`,
`srd_backgrounds`, `srd_spells`, `srd_monsters`, `srd_equipment`,
`srd_equipment_categories`, `srd_magic_items`, `srd_features`, `srd_levels`,
`srd_conditions`, `srd_skills`, `srd_proficiencies`, `srd_languages`,
`srd_damage_types`, `srd_weapon_properties`, `srd_rule_sections`

Each: `(index text primary key, name text, data jsonb)` plus generated columns for the
fields we filter on (spell `level`/`school`/`classes`, monster `cr`/`type`, equipment
`category`/`cost_cp`). Loaded by a seed script from the cloned `5e-bits/5e-database`
snapshot vendored into the repo, so the build never depends on a live third party.

### Identity & campaign
- `users` — id, display_name, reclaim_code, created_at
- `auth_sessions` — token hash, user_id, expires_at
- `campaigns` — id, name, join_code (6 char), status, srd_version, tone/genre prefs, current_location_id, created_by
- `campaign_members` — campaign_id, user_id, role (`player` | `co_dm` | `observer`), joined_at
- `campaign_settings` — play_mode default, difficulty, variant rules (flanking, diagonal movement)

### Characters
- `characters` — campaign_id, user_id, name, race/subrace, class/subclass, level, xp,
  ability scores, hp_current/hp_max/temp_hp, hit_dice_remaining, death_saves,
  conditions, exhaustion, inspiration, portrait, alignment, background, notes
- `character_proficiencies`, `character_items` (equipped/attuned/quantity),
  `character_spells` (known/prepared), `spell_slots` (level, max, used)
- Derived values (AC, saves, attack bonuses, spell save DC, proficiency bonus, passive
  perception, initiative) are **computed, never stored** — one pure function,
  `deriveCharacter()`, is the single source of truth and the thing the audit tests.

### Play
- `maps` — campaign_id, width/height in cells, cell_size_ft (5), terrain jsonb, background
- `map_tokens` — map_id, character_id | monster ref, x, y, size, color, image, visible
- `encounters` — campaign_id, name, status, round, active_combatant_id, map_id
- `combatants` — encounter_id, source (character | monster), initiative, initiative_tiebreak,
  hp, ac, conditions, concentration (spell + dc), movement_used, action/bonus/reaction used,
  death_saves, position
- `rolls` — campaign_id, encounter_id, actor, kind, formula, individual die faces,
  modifiers, advantage state, total, target, dc, outcome, created_at
- `messages` — campaign_id, author_type (`player` | `dm` | `system`), kind
  (`narration` | `dialogue` | `ooc` | `system` | `ruling`), content, metadata
- `events` — the realtime log described above
- `async_turns` — campaign_id, character_id, submitted_at, content, resolved_at,
  dm_response_message_id

### AI DM structured memory (house rule 6)
- `campaign_arcs` — title, premise, acts, current_act, themes, planned_climax
- `plot_threads` — title, status (`open`/`advanced`/`resolved`/`abandoned`), summary, urgency, last_touched
- `npcs` — name, role, disposition_to_party (-100..100), location, description, voice notes, secrets, alive
- `npc_relationships` — npc_id, subject (npc or character), nature, strength
- `locations` — name, type, description, discovered, parent_id, notable_features
- `quests` — title, status, giver, objectives jsonb, rewards, progress
- `party_decisions` — summary, consequences, session_id
- `session_logs` — number, started_at, ended_at, recap, highlights, xp_awarded
- `world_facts` — durable canon the DM must not contradict

Every DM turn **reads** a compact projection of this (not raw chat history) and
**writes** updates through a tool call the server validates before persisting.

---

## 3. Rules automated in code (the 90%)

Ability modifiers · proficiency bonus by level · AC from armor + Dex cap + shield ·
initiative with Dex tiebreak · attack rolls with advantage/disadvantage and crit on 20 ·
crit damage dice doubling · damage with resistance/vulnerability/immunity · saving
throws · spell attack bonus and save DC · spell slots by class and level · ritual and
cantrip handling · concentration (Con save, DC = max(10, half damage), one at a time) ·
all 15 SRD conditions with their mechanical effects · exhaustion levels · death saves
(3/3, nat 20 revives at 1 HP, nat 1 counts double, damage at 0 auto-fails, crit
auto-fails twice) · instant death from massive damage · temp HP rules · grid movement
with a speed budget and difficult terrain · weapon reach and spell range validation ·
opportunity attack prompts · cover · short/long rest with hit dice · XP and leveling ·
encumbrance (optional) · legal level-1 character construction per class and race.

Everything else — improvised stunts, environmental creativity, ambiguous interactions —
goes to the AI as a labeled ruling.

---

## 4. Verification (before anything is called done)

1. **Unit tests** (Vitest) across the rules engine, with the SRD data as fixtures.
2. **Character sheet audit** — generates characters across every SRD class and a spread
   of levels, asserts every derived value against an independently written expectation
   table, not against the same code that produced it.
3. **E2E** — Playwright, four independent browser contexts, driving a real production
   build against a real Postgres. Covers the full done-bar combat, mid-combat refresh,
   and an async turn taken with nobody else connected.
4. **House-rules sub-agent** — checks the build against all ten house rules.
5. **Adversarial sub-agent** — fresh context, told to break it: wrong math, desyncs,
   forgotten rules, ways to forge a roll.
6. **Status page** at `/status` on the deployment — current state, screenshots, known
   gaps, what's in progress. Phone-readable.

Loop: build → adversarial check → close the biggest gap → repeat.

---

## 5. Blockers and questions (front-loaded)

### Hard blockers — I cannot proceed past scaffolding without these

**1. `ANTHROPIC_API_KEY`.** There is no key in this environment. The deployed app needs
its own key to call the API for DM narration. I'll store it as an encrypted Vercel
environment variable, server-side only, never exposed to the client.

**2. A Neon `DATABASE_URL`.** I can't create the database myself: `console.neon.tech` is
403 from this session's egress policy and there's no Neon API key. Fastest path is
Vercel dashboard → Storage → Neon → Create, then paste me the connection string.
I'll run migrations through a secret-guarded admin route on the deployment itself,
since I also can't reach `*.neon.tech` directly from here.

### Would materially improve verification, but I have a workaround

**3. Egress allowlist for `*.vercel.app` and `*.neon.tech`.** Right now I cannot point
a browser at the deployed URL from this container. Without it, the adversarial agent
clicks through a byte-identical production build running locally against real Postgres,
and the live deployment is verified through Vercel's fetch and log tools. With it, the
adversarial agent tests the actual deployment, which is what the done-bar asks for.
If this isn't something you control, say so and I'll take the workaround.

### Defaults I'll take unless you say otherwise

- **SRD 2014 (5.1)** dataset, as specified — the 2024 data is also in the snapshot if
  you ever want it.
- **No passwords or email.** Join code + display name + device cookie, plus a personal
  reclaim code to move between devices.
- **AI DM runs the table**, but any member can be promoted to co-DM with override
  powers — I need that escape hatch for rulings anyway.
- **Model split and spend.** Haiku 4.5 for parsing and state updates, Opus 5 for
  narration and campaign generation, prompt caching on the system + memory projection,
  structured memory instead of transcript stuffing. Rough estimate: **$0.05–0.20 per
  hour of play per table**, with campaign generation a one-time ~$0.10.
- **Portraits stored in Postgres** as bytes with a client-side resize and a ~500 KB cap,
  to avoid needing a Vercel Blob token. Say the word and I'll use Blob instead.
- **Done-bar "four people on four devices"** is verified as four fully independent
  browser contexts with separate cookie jars, each joining by code — functionally
  identical, and something I can re-run on every build.
