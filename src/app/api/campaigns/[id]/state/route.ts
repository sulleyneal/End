import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages, rolls } from "@/db/schema";
import { requireMembership } from "@/server/auth";
import { getCampaign } from "@/server/campaigns";
import { listCharacters } from "@/server/characters";
import { getActiveEncounter, redactEncounter } from "@/server/encounters";
import { currentSeq } from "@/server/events";
import { NotFoundError, route } from "@/server/http";

/**
 * Everything the play screen needs to render on first paint, plus the event
 * cursor it should resume the live stream from. Fetching the log and the cursor
 * together is what makes the handover to SSE lossless — anything that happens
 * between this response and the stream opening is replayed by the cursor.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/campaigns/[id]/state">) => {
  const { id } = await ctx.params;
  const { user, membership } = await requireMembership(id);

  const campaign = await getCampaign(id);
  if (!campaign) throw new NotFoundError("No such campaign.");

  const [log, recentRolls, characters, encounter, cursor] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(eq(messages.campaignId, id))
      .orderBy(asc(messages.createdAt))
      .limit(300),
    db.select().from(rolls).where(eq(rolls.campaignId, id)).orderBy(asc(rolls.createdAt)).limit(60),
    listCharacters(id),
    getActiveEncounter(id),
    currentSeq(id),
  ]);

  return Response.json({
    me: { ...user, role: membership.role },
    campaign: {
      id: campaign.id,
      name: campaign.name,
      joinCode: campaign.joinCode,
      genre: campaign.genre,
      premise: campaign.premise,
      status: campaign.status,
    },
    messages: log.map((m) => ({
      id: m.id,
      authorType: m.authorType,
      authorName: m.authorName,
      kind: m.kind,
      content: m.content,
      metadata: m.metadata,
      createdAt: m.createdAt.toISOString(),
    })),
    rolls: recentRolls.map((r) => ({
      id: r.id,
      actorName: r.actorName,
      kind: r.kind,
      formula: r.formula,
      dice: r.dice,
      modifier: r.modifier,
      advantage: r.advantage,
      total: r.total,
      dc: r.dc,
      outcome: r.outcome,
      createdAt: r.createdAt.toISOString(),
    })),
    characters,
    encounter: encounter ? redactEncounter(encounter, membership.role === "co_dm") : null,
    cursor,
  });
});
