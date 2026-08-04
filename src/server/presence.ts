import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { campaignMembers, characters, users } from "@/db/schema";
import { type Presence, presenceOf } from "@/lib/presence";

/**
 * Who is at the table.
 *
 * The heartbeat is the SSE stream itself. Every play screen already holds one
 * open and reconnects on its own, so it is a truthful signal of "this person
 * has the table in front of them" — more truthful than anything the client
 * could volunteer, and it costs no extra request. A client-driven ping would
 * also be trivially forgeable into looking present while away; this is not.
 */

export type PresentMember = {
  userId: string;
  displayName: string;
  role: string;
  characterName: string | null;
  lastActiveAt: string | null;
  presence: Presence;
};

/**
 * Records that a member's play screen is open.
 *
 * Writes `lastActiveAt` only — never `lastSeenAt`, which belongs to the async
 * catch-up and means something different. Conflating them would make opening
 * the page delete the summary of what you missed while it was closed.
 */
export async function touchPresence(campaignId: string, userId: string): Promise<void> {
  await db
    .update(campaignMembers)
    .set({ lastActiveAt: new Date() })
    .where(
      and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, userId)),
    );
}

/**
 * The roster with each member's presence resolved against a single `now`.
 *
 * One timestamp for the whole list, so two members whose heartbeats landed in
 * the same second can never be classified against different clocks and render
 * inconsistently beside each other.
 */
export async function listPresence(campaignId: string): Promise<PresentMember[]> {
  const rows = await db
    .select({
      userId: campaignMembers.userId,
      role: campaignMembers.role,
      lastActiveAt: campaignMembers.lastActiveAt,
      displayName: users.displayName,
    })
    .from(campaignMembers)
    .innerJoin(users, eq(users.id, campaignMembers.userId))
    .where(eq(campaignMembers.campaignId, campaignId));

  // Members are people; characters are what the table calls them. Showing both
  // means "Alex · Thorin is here" rather than a display name nobody uses.
  //
  // Sorted, and every character listed rather than an arbitrary one: a member
  // may own more than one, and picking whichever the database happened to
  // return first would rename them at random on each poll.
  const sheets = await db
    .select({ userId: characters.userId, name: characters.name })
    .from(characters)
    .where(eq(characters.campaignId, campaignId))
    .orderBy(asc(characters.name));

  const now = new Date();

  return rows
    .map((row) => ({
      userId: row.userId,
      displayName: row.displayName,
      role: row.role,
      characterName:
        sheets
          .filter((s) => s.userId === row.userId)
          .map((s) => s.name)
          .join(", ") || null,
      lastActiveAt: row.lastActiveAt ? row.lastActiveAt.toISOString() : null,
      presence: presenceOf(row.lastActiveAt, now),
    }))
    .sort((a, b) => {
      // Here first, then recently here, then everyone else — alphabetical
      // within each band so the list does not reshuffle on every poll.
      const rank = { online: 0, recent: 1, away: 2 } as const;
      return (
        rank[a.presence] - rank[b.presence] || a.displayName.localeCompare(b.displayName)
      );
    });
}
