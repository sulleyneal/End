import Anthropic from "@anthropic-ai/sdk";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { messages, sessionLogs } from "@/db/schema";
import { appendEvent, postMessage } from "@/server/events";
import { PARSER_MODEL, anthropic } from "./client";

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
mood. No game statistics, no dice results, no hit points.`;

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
    messages: [{ role: "user", content: `Session log:\n\n${rendered}` }],
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
