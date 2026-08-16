import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { combatants, encounters, messages, rolls, sessionLogs } from "@/db/schema";
import { appendEvent, postMessage } from "@/server/events";
import { PARSER_MODEL, anthropic } from "./client";
import { type LogEntry, renderEntries, splitPendingPrompt } from "./catchup-log";

/**
 * Session recaps and the campaign journal.
 *
 * A recap is summarisation of text that already exists, which is exactly the
 * kind of mechanical work the cheaper model should do — the expensive one is
 * for narration and invention.
 *
 * Recaps serve two audiences at once: the player who missed a session and opens
 * the journal, and the DM itself, whose memory projection reads the most recent
 * session log every turn. That second reader is why this writes to the database
 * rather than just posting a message.
 */

const RECAP_TOOL: Anthropic.Tool = {
  name: "write_recap",
  description: "Record the recap of the session that just ended.",
  input_schema: {
    type: "object",
    properties: {
      recap: {
        type: "string",
        description:
          "Two or three paragraphs, past tense, in the voice of a chronicler. What the party " +
          "did, what changed in the world, and what is still unresolved. Name the characters " +
          "who acted. Do not invent anything that did not happen in the log.",
      },
      highlights: {
        type: "array",
        items: { type: "string" },
        description:
          "Three to six one-line beats — the moments a player would retell. Specific, not generic.",
      },
      cliffhanger: {
        type: "string",
        description: "One sentence on what the party is walking into next, if the log implies one.",
      },
    },
    required: ["recap", "highlights"],
  },
};

const SYSTEM_PROMPT = `You write session recaps for a D&D campaign journal.

You are summarising a transcript, not inventing story. Every fact in your recap
must appear in the log you are given. If the party did not do something, it did
not happen. Prefer the concrete — names, places, what was said and decided — over
mood. No game statistics, no dice results, no hit points.

You will be given a COMBAT FACTS section. It is generated from the game's own
database and is the *only* source for what happened in a fight: who died, who
went down, who was still standing. Do not state that anyone was killed, wounded,
healed, saved or defeated unless that section says so. If a creature is not
listed as killed, it did not die. If nobody is listed as healed, nobody was
healed. When the log is thin, write less — a short accurate recap is worth more
than a full-looking invented one.`;

/**
 * Ends the current session and writes its recap into the journal.
 *
 * Returns null when there is nothing to summarise, so ending an empty session is
 * a no-op rather than an error.
 */
export async function endSessionWithRecap(campaignId: string): Promise<{
  number: number;
  recap: string;
  highlights: string[];
} | null> {
  const [open] = await db
    .select()
    .from(sessionLogs)
    .where(eq(sessionLogs.campaignId, campaignId))
    .orderBy(desc(sessionLogs.number))
    .limit(1);

  // Everything logged since this session opened, or the whole campaign if no
  // session has ever been opened.
  const since = open?.endedAt === null ? open.startedAt : (open?.endedAt ?? new Date(0));

  const transcript = await db
    .select()
    .from(messages)
    .where(and(eq(messages.campaignId, campaignId), gt(messages.createdAt, since)))
    .orderBy(asc(messages.createdAt))
    .limit(400);

  const playable = transcript.filter((m) => m.kind !== "ooc" && m.kind !== "system");
  if (playable.length < 2) return null;

  // Combat writes to `rolls`, not to `messages`, so a recap built from the
  // story log alone described only what the AI narrated and nothing about the
  // fight the party actually had. Feed it the mechanical record too.
  const [combatRolls, fights] = await Promise.all([
    db
      .select()
      .from(rolls)
      .where(and(eq(rolls.campaignId, campaignId), gt(rolls.createdAt, since)))
      .orderBy(asc(rolls.createdAt))
      .limit(300),
    db
      .select()
      .from(encounters)
      .where(and(eq(encounters.campaignId, campaignId), gt(encounters.createdAt, since)))
      .orderBy(asc(encounters.createdAt))
      .limit(10),
  ]);

  // A digest of what the database actually says, not a pile of dice lines.
  //
  // Feeding raw rolls let the model confabulate: it wrote that a cleric "pulled
  // Cyra back from death's edge" when the only healing in the log targeted
  // someone else, and that a monster "finally fell" when it ended at 330 of 400
  // hit points. Bare numbers with no linkage are an invitation to fill gaps, so
  // the outcomes are computed here and stated flatly instead.
  const fightFacts: string[] = [];
  for (const fight of fights) {
    const roster = await db
      .select()
      .from(combatants)
      .where(eq(combatants.encounterId, fight.id));

    const fallen = roster.filter((c) => c.defeated).map((c) => c.name);
    const downed = roster
      .filter((c) => !c.defeated && c.hpCurrent === 0)
      .map((c) => c.name);
    const survivors = roster
      .filter((c) => !c.defeated && c.hpCurrent > 0)
      .map((c) => `${c.name} on ${c.hpCurrent} of ${c.hpMax}`);

    fightFacts.push(
      [
        `Encounter "${fight.name}" (${fight.status}, ${fight.round} rounds).`,
        fallen.length > 0 ? `Killed or destroyed: ${fallen.join(", ")}.` : "Nobody died.",
        downed.length > 0 ? `Left unconscious at 0 HP: ${downed.join(", ")}.` : "",
        survivors.length > 0 ? `Still standing at the end: ${survivors.join("; ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  const deathSaves = combatRolls
    .filter((r) => r.kind === "death_save")
    .map((r) => `${r.actorName} rolled a death save: ${r.outcome ?? "unknown"}.`);

  const mechanical = [...fightFacts, ...deathSaves].join("\n").slice(0, 12000);

  const rendered = playable
    .map((m) => `${m.authorName} (${m.kind}): ${m.content}`)
    .join("\n\n")
    .slice(0, 60000);

  const response = await anthropic().messages.create({
    model: PARSER_MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    tools: [RECAP_TOOL],
    tool_choice: { type: "tool", name: "write_recap" },
    messages: [
      {
        role: "user",
        content: [
          `Session log:\n\n${rendered}`,

          mechanical
            ? `\n\nCOMBAT FACTS (authoritative; nothing else about combat may be claimed):\n${mechanical}`
            : "\n\nCOMBAT FACTS: no combat took place this session.",
        ].join(""),
      },
    ],
  });

  const call = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!call) return null;

  const result = call.input as { recap: string; highlights: string[]; cliffhanger?: string };
  const number = open?.endedAt === null ? open.number : (open?.number ?? 0) + 1;
  const body = result.cliffhanger ? `${result.recap}\n\n${result.cliffhanger}` : result.recap;

  if (open && open.endedAt === null) {
    await db
      .update(sessionLogs)
      .set({ endedAt: new Date(), recap: body, highlights: result.highlights ?? [] })
      .where(eq(sessionLogs.id, open.id));
  } else {
    await db.insert(sessionLogs).values({
      campaignId,
      number,
      startedAt: since,
      endedAt: new Date(),
      recap: body,
      highlights: result.highlights ?? [],
    });
  }

  await postMessage({
    campaignId,
    authorType: "system",
    authorName: "Session recap",
    kind: "system",
    content: body,
    metadata: { sessionNumber: number, highlights: result.highlights ?? [] },
  });

  await appendEvent(campaignId, "session.ended", { number, highlights: result.highlights ?? [] });

  return { number, recap: body, highlights: result.highlights ?? [] };
}

/** Opens a session if none is open, so the recap knows where to start. */
export async function ensureOpenSession(campaignId: string): Promise<void> {
  const [latest] = await db
    .select()
    .from(sessionLogs)
    .where(eq(sessionLogs.campaignId, campaignId))
    .orderBy(desc(sessionLogs.number))
    .limit(1);

  if (latest && latest.endedAt === null) return;

  await db.insert(sessionLogs).values({
    campaignId,
    number: (latest?.number ?? 0) + 1,
    startedAt: new Date(),
  });
}

/** The campaign journal: every completed session, newest first. */
export async function listJournal(campaignId: string) {
  const rows = await db
    .select()
    .from(sessionLogs)
    .where(eq(sessionLogs.campaignId, campaignId))
    .orderBy(desc(sessionLogs.number));

  return rows.map((r) => ({
    number: r.number,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    recap: r.recap,
    highlights: r.highlights,
  }));
}

const CATCHUP_PROMPT = `You catch a player up on what happened at their D&D table
while they were away.

Three or four sentences. Past tense, plain and specific. No dice results, no hit
points, no statistics.

What counts as having happened:

- A line labelled (action) is a player stating what their character does. Those
  are the only lines that establish a character's choices.
- A line from the Dungeon Master describes the consequences of those choices, or
  what the world does. Those happened too.
- A line labelled (dialogue) is something that creature actually said.

What does NOT count, and is the single most important rule here:

- When the Dungeon Master offers the party options — "you could knock, or ask him
  what he means" — those options are possibilities, not events. A character who
  was merely offered the chance to say something did not say it.
- You will be given a PENDING section holding a question the party has not
  answered yet. Nothing in it has happened. Do not report any of it as an event,
  and never invent the answer.

Close by saying where the party is now and what is waiting on them. If the
PENDING section is present, that is what is waiting on them — say so plainly,
and make clear nobody has answered it yet.

When the log is thin, write less. A short accurate catch-up is worth more than a
full-looking invented one.

Format: plain prose only. No heading, no title, no restating the question back.
No markdown — no asterisks, no bold, no bullets. It is rendered as plain text
under a heading that already says "While you were away", so anything of that
sort appears to the player as clutter or as literal asterisks.`;

/**
 * A short catch-up for a player who has been away.
 *
 * Separate from the session recap: this is not a journal entry, it is the few
 * sentences someone needs before they can take their turn. Runs on the cheap
 * model — it is summarisation, not invention.
 *
 * The unanswered prompt at the end of a log is split out rather than left
 * inline. Inline, the DM's offered options were coming back as completed
 * actions: a returning player was told a character had asked a question he had
 * only been offered the chance to ask, and that the NPC had answered it.
 */
export async function summariseMissed(entries: LogEntry[]): Promise<string | null> {
  if (entries.length === 0) return null;

  const { events, pending } = splitPendingPrompt(entries);

  // Nothing but an unanswered question means nothing has happened to report.
  if (events.length === 0) return null;

  const response = await anthropic().messages.create({
    model: PARSER_MODEL,
    max_tokens: 400,
    system: CATCHUP_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          `TABLE LOG — everything below happened:\n\n${renderEntries(events).slice(0, 30000)}`,
          pending.length > 0
            ? `\n\nPENDING — the table has been asked this and has NOT answered. ` +
              `None of it has happened:\n${renderEntries(pending).slice(0, 4000)}`
            : "",
        ].join(""),
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  return text.length > 0 ? text : null;
}

/** A gap this long between beats means the group stopped playing. */
const SESSION_GAP_HOURS = 6;

/**
 * Closes a session that has clearly ended, and opens the next one.
 *
 * The done-bar asks for the recap to generate "automatically at session end",
 * and a virtual table has no obvious end — nobody pushes back a chair. The
 * usable signal is a gap: when the next thing happens hours after the last, the
 * session that came before it is over. Called at the start of a DM turn, so the
 * player who comes back on Thursday finds Tuesday already written up.
 *
 * Returns the session number written, or null when nothing needed closing.
 */
export async function closeStaleSession(campaignId: string): Promise<number | null> {
  const [open] = await db
    .select()
    .from(sessionLogs)
    .where(eq(sessionLogs.campaignId, campaignId))
    .orderBy(desc(sessionLogs.number))
    .limit(1);

  if (!open || open.endedAt !== null) return null;

  const [last] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.campaignId, campaignId), gt(messages.createdAt, open.startedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(1);

  if (!last) return null;

  const idleHours = (Date.now() - last.createdAt.getTime()) / 3_600_000;
  if (idleHours < SESSION_GAP_HOURS) return null;

  const session = await endSessionWithRecap(campaignId);
  await ensureOpenSession(campaignId);
  return session?.number ?? null;
}
