import { and, asc, eq, gt } from "drizzle-orm";
import { db, sqlClient } from "@/db";
import { events } from "@/db/schema";

/**
 * The realtime spine.
 *
 * Every state mutation appends a row here, and clients tail it with a cursor.
 * Sequence numbers are allocated per campaign so that "give me everything
 * after 41" is answerable exactly — which is what makes a mid-combat refresh
 * lose nothing.
 */

export type GameEvent = {
  id: number;
  campaignId: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type EventType =
  | "message"
  | "roll"
  | "character.updated"
  | "character.created"
  | "encounter.started"
  | "encounter.updated"
  | "encounter.ended"
  | "combatant.updated"
  | "turn.changed"
  | "token.moved"
  | "map.updated"
  | "member.joined"
  | "campaign.updated"
  | "dm.thinking"
  | "async.submitted";

/**
 * Appends an event and returns it with its allocated sequence number.
 *
 * The counter bump and the insert are one statement on purpose. The Neon HTTP
 * driver has no interactive transactions, so a read-then-write would race and
 * could hand two events the same sequence number — which would silently drop
 * one of them for any client resuming from that cursor. `UPDATE ... RETURNING`
 * feeding the `INSERT` is atomic and takes the campaign row lock for us.
 */
export async function appendEvent(
  campaignId: string,
  type: EventType,
  payload: Record<string, unknown> = {},
): Promise<GameEvent> {
  const rows = (await sqlClient.query(
    `with bumped as (
       update campaigns set event_seq = event_seq + 1
       where id = $1
       returning event_seq
     )
     insert into events (campaign_id, seq, type, payload)
     select $1, bumped.event_seq, $2, $3::jsonb from bumped
     returning id, campaign_id, seq, type, payload, created_at`,
    [campaignId, type, JSON.stringify(payload)],
  )) as Record<string, unknown>[];

  if (rows.length === 0) {
    throw new Error(`Cannot append event: campaign ${campaignId} does not exist`);
  }

  const row = rows[0];
  return {
    id: Number(row.id),
    campaignId: row.campaign_id as string,
    seq: Number(row.seq),
    type: row.type as string,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

/** Appends several events with one round trip, preserving order. */
export async function appendEvents(
  campaignId: string,
  batch: { type: EventType; payload?: Record<string, unknown> }[],
): Promise<GameEvent[]> {
  const out: GameEvent[] = [];
  for (const entry of batch) {
    out.push(await appendEvent(campaignId, entry.type, entry.payload ?? {}));
  }
  return out;
}

/** Everything after `since`, oldest first. `since = 0` returns the whole log. */
export async function eventsSince(
  campaignId: string,
  since: number,
  limit = 200,
): Promise<GameEvent[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.campaignId, campaignId), gt(events.seq, since)))
    .orderBy(asc(events.seq))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    campaignId: row.campaignId,
    seq: row.seq,
    type: row.type,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** The newest sequence number, so a fresh client can start at "now". */
export async function currentSeq(campaignId: string): Promise<number> {
  const rows = (await sqlClient.query(`select event_seq from campaigns where id = $1`, [
    campaignId,
  ])) as { event_seq: string | number }[];
  return rows.length > 0 ? Number(rows[0].event_seq) : 0;
}
