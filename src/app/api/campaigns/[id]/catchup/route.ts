import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { campaignMembers, messages } from "@/db/schema";
import { requireMembership } from "@/server/auth";
import { route } from "@/server/http";
import { isAiConfigured } from "@/ai/client";
import { summariseMissed } from "@/ai/recap";

/**
 * What you missed.
 *
 * Async play only works if someone who was away for two days can open the table
 * and understand it. Reading forty messages is not understanding, so this
 * summarises everything since they last looked and marks them caught up.
 *
 * Deliberately a GET the client fires on load rather than something the player
 * has to ask for — the point is that catching up costs nothing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fewer beats than this and the log is short enough to simply read. */
const WORTH_SUMMARISING = 4;

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/campaigns/[id]/catchup">) => {
  const { id } = await ctx.params;
  const { user, membership } = await requireMembership(id);

  const since = membership.lastSeenAt;
  const markSeen = () =>
    db
      .update(campaignMembers)
      .set({ lastSeenAt: new Date() })
      .where(and(eq(campaignMembers.campaignId, id), eq(campaignMembers.userId, user.id)));

  // First visit: there is nothing to have missed.
  if (!since) {
    await markSeen();
    return Response.json({ missed: null });
  }

  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.campaignId, id), gt(messages.createdAt, since)))
    .orderBy(asc(messages.createdAt))
    .limit(200);

  const narrative = rows.filter((m) => m.kind !== "ooc" && m.kind !== "system");

  if (narrative.length < WORTH_SUMMARISING || !isAiConfigured()) {
    await markSeen();
    return Response.json({ missed: null, count: narrative.length });
  }

  // Marked seen only once the summary exists. Marking first meant a failed AI
  // call, or a second tab racing the first, consumed the catch-up and lost it.
  const summary = await summariseMissed(
    narrative.map((m) => ({
      authorName: m.authorName,
      kind: m.kind,
      content: m.content,
    })),
  );
  await markSeen();

  return Response.json({
    missed: summary ? { summary, count: narrative.length, since: since.toISOString() } : null,
  });
});
