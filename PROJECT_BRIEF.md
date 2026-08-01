# Project Brief — read this first

The authoritative spec for this repo. `PLAN.md` holds the architecture and schema;
this file holds the goal, the rules the build must satisfy, and the bar for "done".
If you are a fresh session, read both before writing code.

---

## Goal

A multiplayer web app: a D&D 5e virtual tabletop with a built-in AI Dungeon Master.
Friends join a campaign from their own devices with a join code, create real 5e
characters, and play together — either live in a shared session or asynchronously,
play-by-post style, taking turns whenever they're online.

The AI DM generates an original campaign from scratch (setting, plot arc, NPCs,
encounters), narrates, voices NPCs, runs combat, and remembers everything from session
to session. **The app is the referee**: it enforces the actual rules, rolls the actual
dice, and tracks the actual sheets, so the AI DM never has to be trusted with math.

This should feel like a real product a D&D group would choose over Roll20 for an
AI-run campaign — not a demo.

## House rules

1. **Import the SRD, don't hand-write it.** Use the open 5e SRD 5.1 data
   (dnd5eapi.co or an equivalent open JSON dataset) for all classes, races, spells,
   monsters, equipment, and conditions. No hand-transcribed rules content.
2. **Automate the common 90%, let the AI adjudicate the rest.** Attack rolls, saves,
   damage, spell slots, HP, conditions, concentration, death saves, initiative, and
   grid movement/range are enforced in code. Weird rules interactions go to the AI DM
   as a ruling, clearly labeled as a ruling.
3. **All dice roll server-side.** Clients never compute or submit their own results.
   Rolls are logged and visible to the whole table.
4. **Persistent by default.** Every character, campaign, message, roll, and map state
   lives in a real database. A page refresh mid-combat loses nothing. No
   localStorage-only state.
5. **Both play modes are first-class.** Live mode is real-time (everyone sees rolls,
   chat, and token movement instantly). Async mode lets one player act hours later and
   the DM responds to just them, keeping the shared narrative coherent.
6. **The AI DM has structured memory.** Campaign state (plot threads, NPC
   relationships, party decisions, current location, quest log) is stored as data the
   DM reads and updates every turn — not just raw chat history stuffed into context.
7. **Clean modern UI, readable first, flavor second.** No parchment textures, no gothic
   fonts for body text. It must be fully usable on a phone — players will absolutely
   take async turns from their phones.
8. **Deployable on Vercel with a Postgres database (Neon).** AI DM calls go through the
   Anthropic API.
9. **Included features:** grid battle map with tokens and movement, animated 3D dice,
   uploadable character portraits, auto-generated session recaps / campaign journal,
   and a shared initiative tracker + combat log.
10. **Before anything ships, spin up a sub-agent whose only job is checking the work
    against these house rules.**

## Done-bar

The app is done when all of the following are true and verified:

- Four people on four separate devices can: join a campaign via code, each build a
  legal 5e character (any SRD class/race, correct starting stats, equipment, and spells
  for level 1), and see each other in the party.
- The AI DM generates an original campaign on "new campaign" and opens the first
  session with a scene the party can act on.
- The group plays a full combat encounter — initiative, grid movement with real
  range/reach enforcement, attacks, a spell that consumes a slot, a condition applied
  and cleared, a character dropped to 0 HP rolling death saves — with zero manual
  bookkeeping by any player. Every number on every sheet is correct afterward.
- Mid-combat, one player closes their browser, reopens it, and is back in the same
  state within seconds.
- In async mode, a player takes a turn while nobody else is online; the DM responds;
  the next player to log in sees a coherent, updated narrative and a recap of what they
  missed.
- The session recap generates automatically at session end and is added to the
  campaign journal.
- A character sheet audit passes: for at least 5 randomly generated characters across
  different classes and levels, every derived value (AC, save bonuses, attack bonuses,
  spell save DC, proficiency) matches a hand calculation against the SRD.
- **The builder never grades itself.** A separate sub-agent with a fresh context window
  plays through the app as an actual user (real clicks, real running deployment) and
  actively tries to prove any of the above false — wrong math, desyncs, rules the app
  forgets, ways to cheat a roll. The build is done only when this adversarial checker
  genuinely cannot find a failure, or when the owner says so.

## Loop

Run build → adversarial check → identify the biggest gap → close it → repeat. Do not
stop at "works on the happy path." Maintain a simple deployed status page (current
state, latest screenshots, known gaps, what you're working on) checkable from a phone
during long runs.

## Autonomy grant

- Make your own technical decisions: framework, real-time transport, schema, 3D dice
  library, map rendering. Do not ask the owner to choose between technologies.
- Deploy to the owner's Vercel account; create the Neon database needed. Anthropic API
  calls for the DM are approved — be sensible about token usage, and use a
  cheaper/faster model for mechanical DM tasks (parsing player intent, updating state)
  and a stronger model for narration and campaign generation.
- Only go back to the owner if truly blocked (missing credential, spend beyond normal)
  or facing a product decision only they can make.

---

## Environment

All three credentials are configured and verified working.

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | Neon Postgres, pooled | Runtime queries |
| `DATABASE_URL_UNPOOLED` | Neon Postgres, direct | Migrations |
| `DM_ANTHROPIC_API_KEY` | Anthropic API | **Not** `ANTHROPIC_API_KEY` — see below |

**Why the key is named `DM_ANTHROPIC_API_KEY`:** the session runner strips
`ANTHROPIC_API_KEY` from cloud session containers, because Claude Code uses that name
for its own model authentication. A key set under that name silently never arrives.
Use `DM_ANTHROPIC_API_KEY` everywhere, including Vercel production, for one consistent
name.

### Sandbox constraints that shape the build

- Egress is allowlisted. Open: npm, GitHub, `api.anthropic.com`, `*.vercel.app`,
  `*.neon.tech`. Everything else 403s at CONNECT. Notably `vercel.com` and
  `dnd5eapi.co` are **not** reachable.
- **Raw Postgres TCP (port 5432) is blocked** — `psql` and `node-postgres` hang.
  Only Neon's HTTP driver (`@neondatabase/serverless`) works from the sandbox. Local
  migrations and seeding must execute SQL through that driver rather than
  `drizzle-kit migrate`. No impact in production; Vercel connects directly.
- Node's `fetch` ignores `HTTPS_PROXY`. Local scripts hitting proxied hosts need an
  `undici` `ProxyAgent` with the CA at `/root/.ccr/ca-bundle.crt`. Not needed for
  `api.anthropic.com`, which is in `no_proxy`.
- Vercel environment variables must be set by the owner in the dashboard — the
  available Vercel MCP tools cover deploys, logs, and protection settings, but expose
  no environment-variable API.
- Chromium and Playwright are preinstalled (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`).
  Do not run `playwright install`.

## Status

**Done**
- Plan, architecture, and schema design (`PLAN.md`)
- Next.js 16 scaffold — App Router, TypeScript, Tailwind v4
- SRD 5.1 vendored: 25 JSON files from `5e-bits/5e-database` (MIT) in `data/srd/2014`
- All three credentials verified against live services

**Next**
- Drizzle schema + migration applied over the Neon HTTP driver
- SRD import into Postgres
- Rules engine and `deriveCharacter()`
- Character-sheet audit suite
- Campaign/join flow, character builder, battle map, combat, AI DM layer
- Deploy, then the adversarial and house-rules sub-agent passes
