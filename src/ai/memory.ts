import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  campaignArcs,
  campaigns,
  locations,
  messages,
  npcs,
  plotThreads,
  quests,
  sessionLogs,
  worldFacts,
} from "@/db/schema";
import { listCharacters } from "@/server/characters";
import { getActiveEncounter } from "@/server/encounters";

/**
 * The DM's memory projection.
 *
 * A DM turn never reads raw chat history. It reads *this* — a compact,
 * structured summary of who the party is, where they are, what is unresolved
 * and what must not be contradicted. That keeps a long campaign inside a small,
 * cacheable prompt and stops the model from re-deriving the world from a
 * transcript that will eventually not fit.
 */

export type MemoryProjection = {
  campaign: { name: string; tone: string | null; genre: string | null; premise: string | null };
  arc: { title: string; premise: string; act: number; themes: string[]; climax: string | null } | null;
  party: {
    name: string;
    race: string;
    class: string;
    level: number;
    hp: string;
    ac: number;
    conditions: string[];
    passivePerception: number;
  }[];
  location: { name: string; type: string | null; description: string | null } | null;
  npcsPresent: { name: string; role: string | null; disposition: number; voice: string | null }[];
  openThreads: { title: string; summary: string; urgency: number }[];
  quests: { title: string; status: string; objectives: string[] }[];
  facts: string[];
  lastSession: { number: number; recap: string | null } | null;
  recentBeats: { author: string; kind: string; content: string }[];
  encounter: {
    name: string;
    round: number;
    active: string | null;
    combatants: { name: string; hp: string; conditions: string[]; defeated: boolean }[];
  } | null;
};

/** How many recent log lines to include. Deliberately small — memory carries the weight. */
const RECENT_BEATS = 12;

export async function buildProjection(campaignId: string): Promise<MemoryProjection> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) throw new Error("No such campaign.");

  const [arcRows, npcRows, threadRows, questRows, factRows, sessionRows, beatRows, sheets, encounter] =
    await Promise.all([
      db.select().from(campaignArcs).where(eq(campaignArcs.campaignId, campaignId)).limit(1),
      db.select().from(npcs).where(and(eq(npcs.campaignId, campaignId), eq(npcs.alive, true))),
      db
        .select()
        .from(plotThreads)
        .where(eq(plotThreads.campaignId, campaignId))
        .orderBy(desc(plotThreads.urgency))
        .limit(8),
      db.select().from(quests).where(eq(quests.campaignId, campaignId)).limit(8),
      db.select().from(worldFacts).where(eq(worldFacts.campaignId, campaignId)).limit(30),
      db
        .select()
        .from(sessionLogs)
        .where(eq(sessionLogs.campaignId, campaignId))
        .orderBy(desc(sessionLogs.number))
        .limit(1),
      db
        .select()
        .from(messages)
        .where(eq(messages.campaignId, campaignId))
        .orderBy(desc(messages.createdAt))
        .limit(RECENT_BEATS),
      listCharacters(campaignId),
      getActiveEncounter(campaignId),
    ]);

  let location: MemoryProjection["location"] = null;
  if (campaign.currentLocationId) {
    const [row] = await db
      .select()
      .from(locations)
      .where(eq(locations.id, campaign.currentLocationId))
      .limit(1);
    if (row) location = { name: row.name, type: row.type, description: row.description };
  }

  const arc = arcRows[0]
    ? {
        title: arcRows[0].title,
        premise: arcRows[0].premise,
        act: arcRows[0].currentAct,
        themes: arcRows[0].themes,
        climax: arcRows[0].plannedClimax,
      }
    : null;

  return {
    campaign: {
      name: campaign.name,
      tone: campaign.tone,
      genre: campaign.genre,
      premise: campaign.premise,
    },
    arc,
    party: sheets.map((s) => ({
      name: s.name,
      race: s.labels.race,
      class: s.labels.class,
      level: s.level,
      hp: `${s.hpCurrent}/${s.hpMax}`,
      ac: s.derived.armorClass.value,
      conditions: s.conditions,
      passivePerception: s.derived.passive.perception,
    })),
    location,
    // An NPC with no location is campaign-wide, not absent. Filtering those out
    // once the party enters a location hid every NPC the DM had just created,
    // which made it invent a fresh near-duplicate for the same person.
    npcsPresent: npcRows
      .filter((n) => n.locationId === null || n.locationId === campaign.currentLocationId)
      .slice(0, 12)
      .map((n) => ({
        name: n.name,
        role: n.role,
        disposition: n.disposition,
        voice: n.voice,
      })),
    openThreads: threadRows
      .filter((t) => t.status === "open" || t.status === "advanced")
      .map((t) => ({ title: t.title, summary: t.summary, urgency: t.urgency })),
    quests: questRows.map((q) => ({
      title: q.title,
      status: q.status,
      objectives: q.objectives.filter((o) => !o.done).map((o) => o.text),
    })),
    facts: factRows.map((f) => f.fact),
    lastSession: sessionRows[0]
      ? { number: sessionRows[0].number, recap: sessionRows[0].recap }
      : null,
    // Oldest first, so the model reads them in the order they happened.
    recentBeats: beatRows.reverse().map((m) => ({
      author: m.authorName,
      kind: m.kind,
      content: m.content.slice(0, 600),
    })),
    encounter: encounter
      ? {
          name: encounter.name,
          round: encounter.round,
          active:
            encounter.combatants.find((c) => c.id === encounter.activeCombatantId)?.name ?? null,
          combatants: encounter.combatants.map((c) => ({
            name: c.name,
            hp: `${c.hpCurrent}/${c.hpMax}`,
            conditions: c.conditions,
            defeated: c.defeated,
          })),
        }
      : null,
  };
}

/** Renders the projection as the compact text block the DM actually reads. */
export function renderProjection(p: MemoryProjection): string {
  const lines: string[] = [];
  const section = (title: string, body: string[]) => {
    if (body.length === 0) return;
    lines.push(`## ${title}`, ...body, "");
  };

  lines.push(`# ${p.campaign.name}`);
  if (p.campaign.genre) lines.push(`Genre: ${p.campaign.genre}`);
  if (p.campaign.tone) lines.push(`Tone: ${p.campaign.tone}`);
  if (p.campaign.premise) lines.push(`Premise: ${p.campaign.premise}`);
  lines.push("");

  if (p.arc) {
    section("Arc", [
      `${p.arc.title} — act ${p.arc.act}`,
      p.arc.premise,
      p.arc.themes.length ? `Themes: ${p.arc.themes.join(", ")}` : "",
      p.arc.climax ? `Planned climax: ${p.arc.climax}` : "",
    ].filter(Boolean));
  }

  section(
    "Party",
    p.party.map(
      (c) =>
        `- ${c.name}, level ${c.level} ${c.race} ${c.class} — HP ${c.hp}, AC ${c.ac}, passive Perception ${c.passivePerception}` +
        (c.conditions.length ? `, ${c.conditions.join(", ")}` : ""),
    ),
  );

  if (p.location) {
    section("Current location", [
      `${p.location.name}${p.location.type ? ` (${p.location.type})` : ""}`,
      p.location.description ?? "",
    ].filter(Boolean));
  }

  section(
    "NPCs here",
    p.npcsPresent.map(
      (n) =>
        `- ${n.name}${n.role ? `, ${n.role}` : ""} — disposition ${n.disposition}` +
        (n.voice ? ` — voice: ${n.voice}` : ""),
    ),
  );

  section(
    "Open threads",
    p.openThreads.map((t) => `- [urgency ${t.urgency}] ${t.title}: ${t.summary}`),
  );

  section(
    "Quests",
    p.quests.map(
      (q) => `- ${q.title} (${q.status})` + (q.objectives.length ? ` — todo: ${q.objectives.join("; ")}` : ""),
    ),
  );

  section("Established canon (must not be contradicted)", p.facts.map((f) => `- ${f}`));

  if (p.lastSession?.recap) {
    section(`Recap of session ${p.lastSession.number}`, [p.lastSession.recap]);
  }

  if (p.encounter) {
    section("Active encounter", [
      `${p.encounter.name} — round ${p.encounter.round}, active: ${p.encounter.active ?? "none"}`,
      ...p.encounter.combatants.map(
        (c) =>
          `- ${c.name}: ${c.defeated ? "out of the fight" : `HP ${c.hp}`}` +
          (c.conditions.length ? ` (${c.conditions.join(", ")})` : ""),
      ),
    ]);
  }

  section(
    "Recent beats",
    p.recentBeats.map((b) => `${b.author} [${b.kind}]: ${b.content}`),
  );

  return lines.join("\n").trim();
}
