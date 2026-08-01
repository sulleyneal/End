# AI Dungeon Master

A multiplayer D&D 5e virtual tabletop with a built-in AI DM.

**The app is the referee. The AI owns the story.**

The rules engine owns the dice, the character sheets, and every hit point. The
AI DM describes the world, plays the NPCs, and rules on things the rules do not
cover — but it cannot state a die result, a damage number, or a hit point total.
It returns *intents* (`attack(attacker, target)`, `call_for_check(character,
skill, dc)`); the server validates each one against the rules, rolls, applies
the outcome, and hands back what actually happened for the DM to narrate. There
is no field in any tool it can call that accepts a damage number, so it cannot
assert one.

## Running it

```bash
npm install
npm run db:push      # create the schema
npm run db:seed      # load the vendored SRD 5.1 snapshot
npm run dev
```

Environment:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `DM_ANTHROPIC_API_KEY` | Server-side Anthropic key for the DM. Without it the rules engine still works; the DM cannot narrate. |

## Verifying it

```bash
npm test         # 858 unit tests over the rules engine
npm run lint
npm run build
npm run test:e2e # Playwright: two browser contexts through a real turn (needs a server on :3100)
```

The unit suite includes a **character sheet audit** that generates characters
across all 12 SRD classes at ten levels and checks proficiency bonus, hit dice,
saving throws, spell slots, spellcasting DCs, racial bonuses, AC, skills and
attacks against expectation tables written out by hand from the Player's
Handbook — not read back from the same SRD documents the engine consumes, so a
wrong value in the data and a wrong reading of it both fail rather than agreeing
with each other.

`/status` reports what the running deployment can actually do, checked live on
each load.

## How it fits together

| Layer | Where | Notes |
|---|---|---|
| Rules engine | `src/rules` | Pure functions. Dice come from `crypto.randomInt`, server-side, in one module. RNG is injectable so tests assert exact outcomes. |
| SRD data | `data/srd/2014`, `src/srd` | Vendored snapshot, so a build never depends on a live third party. Seeded into Postgres with generated filter columns. |
| Server services | `src/server` | Auth, campaigns, characters, encounters, the event log. Decides whether an action is *allowed*; the rules engine decides its outcome. |
| AI DM | `src/ai` | Tool-use intents, structured memory projection, validated writes. |
| Realtime | `src/server/events.ts`, `.../stream` | Append-only per-campaign log with a gapless sequence; SSE tails it from a cursor, so reconnecting loses nothing. |
| UI | `src/app`, `src/components` | Mobile-first, system fonts. |

`deriveCharacter()` is the single source of truth for every sheet value. Nothing
derived is stored — AC, saves, attack bonuses, spell save DC, proficiency bonus
and passive scores are recomputed on every read, so stored state cannot drift
out of agreement with the rules.

## Licence

SRD content in `data/srd` is Wizards of the Coast's SRD 5.1 under CC-BY-4.0;
see `data/srd/LICENSE.md`.
