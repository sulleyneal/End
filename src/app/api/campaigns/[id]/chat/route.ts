import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { requireMembership } from "@/server/auth";
import { postMessage } from "@/server/events";
import { readJson, route } from "@/server/http";

/**
 * Table chat.
 *
 * Deliberately its own route rather than a flag on the DM turn. Chat is what
 * players say to each other, not to the world: it must be instant, it must cost
 * nothing, and it must keep working on a deployment with no API key at all. It
 * also never reaches the DM's context or a session recap, so arguing about
 * pizza cannot end up in the campaign journal.
 */

export const runtime = "nodejs";

const chatSchema = z.object({ content: z.string().min(1).max(2000) });

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/campaigns/[id]/chat">) => {
  const { id } = await ctx.params;
  await requireMembership(id);

  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.campaignId, id), eq(messages.kind, "ooc")))
    .orderBy(asc(messages.createdAt))
    .limit(200);

  return Response.json({
    chat: rows.map((m) => ({
      id: m.id,
      authorName: m.authorName,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

export const POST = route(async (request: Request, ctx: RouteContext<"/api/campaigns/[id]/chat">) => {
  const { id } = await ctx.params;
  const { user } = await requireMembership(id);
  const { content } = chatSchema.parse(await readJson(request));

  const messageId = await postMessage({
    campaignId: id,
    authorType: "player",
    authorName: user.displayName,
    kind: "ooc",
    content: content.trim(),
  });

  return Response.json({ id: messageId }, { status: 201 });
});
