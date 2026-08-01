import Link from "next/link";
import { sqlClient } from "@/db";
import { isAiConfigured } from "@/ai/client";
import { srd } from "@/srd/local";

/**
 * The build status page, phone-readable.
 *
 * It reports what this deployment can actually do right now — checked live
 * against the database and the environment, not a hand-written claim that can
 * drift from reality.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { label: string; ok: boolean; detail: string };

async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];

  try {
    const rows = (await sqlClient.query(
      `select
         (select count(*) from srd_spells)   as spells,
         (select count(*) from srd_monsters) as monsters,
         (select count(*) from campaigns)    as campaigns,
         (select count(*) from characters)   as characters,
         (select count(*) from rolls)        as rolls,
         (select count(*) from events)       as events`,
    )) as Record<string, string>[];
    const r = rows[0];
    checks.push({
      label: "Database",
      ok: true,
      detail: `connected · ${r.spells} spells, ${r.monsters} monsters seeded`,
    });
    checks.push({
      label: "Play so far",
      ok: true,
      detail: `${r.campaigns} campaigns, ${r.characters} characters, ${r.rolls} dice rolled, ${r.events} events`,
    });
  } catch (error) {
    checks.push({
      label: "Database",
      ok: false,
      detail: error instanceof Error ? error.message : "unreachable",
    });
  }

  try {
    checks.push({
      label: "SRD data",
      ok: true,
      detail: `${srd.classes().length} classes, ${srd.races().length} races, ${srd.equipment().length} items loaded from the vendored snapshot`,
    });
  } catch (error) {
    checks.push({
      label: "SRD data",
      ok: false,
      detail: error instanceof Error ? error.message : "not readable",
    });
  }

  checks.push({
    label: "AI Dungeon Master",
    ok: isAiConfigured(),
    detail: isAiConfigured()
      ? "API key present — the DM can narrate"
      : "no API key on this deployment; the rules engine still works",
  });

  return checks;
}

const DONE = [
  "Rules engine: dice, AC, saves, skills, attacks, damage with resistance, temp HP, death saves, all 15 conditions, exhaustion, grid movement, rests",
  "880 unit tests, including a sheet audit across all 12 classes and 10 levels against hand-written PHB tables",
  "SRD 5.1 seeded into Postgres with generated filter columns",
  "Racial traits: trait proficiencies, Dwarven Toughness, High Elf Cantrip, Hellish Resistance",
  "Identity without accounts: display name, device cookie, throttled reclaim code",
  "Campaigns, join codes, membership checks on every route",
  "Lossless realtime: per-campaign event log, cursor-resumed SSE",
  "Legal level-1 character creation with validated starting equipment and spells",
  "Encounters: server-rolled initiative, turn gating, reach and range, resolved opportunity attacks",
  "Spellcasting: known and prepared spells, slots that get spent, upcasting, concentration",
  "Campaign generation: arc, NPCs, locations, plot threads and an opening scene",
  "Session recaps written to a campaign journal, aware of what happened in combat",
  "Levelling from XP: hit points, hit dice and spell slots at the new level",
  "Short and long rests: hit dice spent server-side, slots and exhaustion restored",
  "Grid battle map with tap-to-move over server-validated movement",
  "Animated 3D dice that replay the roll the server already made",
  "Uploadable character portraits, resized in the browser and stored in Postgres",
  "AI DM over tool-use intents — it cannot express a number that matters",
  "Table chat between the players — instant, free, and invisible to the DM",
  "Play screen, character builder, dice audit log",
];

const NEXT = [
  "Async turns with a what-you-missed recap for the player who was away",
  "Rogue Expertise and Sneak Attack, Monk Martial Arts",
  "Choosing new spells on level-up — slots grow, the spell list does not",
  "Ranged attacks in melee do not yet take disadvantage",
  "Battle maps have no walls or difficult terrain yet — the engine enforces both, nothing authors them",
];

/** Deliberately listed: an honest status page has to include what is wrong. */
const KNOWN_GAPS = [
  "Every campaign generated before 1 Aug has no arc or opening scene",
  "A rogue may end up wielding the dagger rather than the rapier, and there is no equip control",
  "The AI DM can remove a condition it did not apply, which is a way around the engine",
];

export default async function StatusPage() {
  const checks = await runChecks();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link href="/" className="text-sm text-[var(--muted)] hover:underline">
        ← Back
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Build status</h1>
      <p className="mt-2 text-[var(--muted)]">
        Checked live against this deployment each time the page loads.
      </p>

      <section className="mt-6 space-y-2">
        {checks.map((check) => (
          <div
            key={check.label}
            className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <span
              className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: check.ok ? "var(--success)" : "var(--danger)" }}
              aria-hidden
            />
            <span>
              <span className="block font-medium">{check.label}</span>
              <span className="block text-sm text-[var(--muted)]">{check.detail}</span>
            </span>
          </div>
        ))}
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">Working</h2>
        <ul className="mt-2 space-y-1.5">
          {DONE.map((item) => (
            <li key={item} className="flex gap-2 text-sm">
              <span className="text-[var(--success)]" aria-hidden>
                ✓
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">Not built yet</h2>
        <ul className="mt-2 space-y-1.5">
          {NEXT.map((item) => (
            <li key={item} className="flex gap-2 text-sm text-[var(--muted)]">
              <span aria-hidden>·</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="font-semibold">Known gaps</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Things that are wrong right now, found by an adversarial pass rather than reported by
          the build.
        </p>
        <ul className="mt-2 space-y-1.5">
          {KNOWN_GAPS.map((item) => (
            <li key={item} className="flex gap-2 text-sm text-[var(--danger)]">
              <span aria-hidden>!</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 text-xs text-[var(--muted)]">
        Dice are rolled server-side with crypto.randomInt and every roll is persisted. The AI DM
        returns intents only — it has no way to assert a die result, a damage number or a hit point
        total.
      </p>
    </main>
  );
}
