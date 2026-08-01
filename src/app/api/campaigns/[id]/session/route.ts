import { requireMembership } from "@/server/auth";
import { route } from "@/server/http";
import { endSessionWithRecap, listJournal } from "@/ai/recap";
import { isAiConfigured } from "@/ai/client";

/**
 * The campaign journal, and the button that closes a session.
 *
 * Ending a session is a co-DM action: it draws a line under everything since
 * the last one and writes the recap the next player to arrive will read.
 */

export const runtime = "nodejs";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/campaigns/[id]/session">) => {
  const { id } = await ctx.params;
  await requireMembership(id);
  return Response.json({ journal: await listJournal(id) });
});

export const POST = route(async (_req: Request, ctx: RouteContext<"/api/campaigns/[id]/session">) => {
  const { id } = await ctx.params;
  const { membership } = await requireMembership(id);
  if (membership.role !== "co_dm") {
    return Response.json({ error: "Only a co-DM can end the session." }, { status: 403 });
  }
  if (!isAiConfigured()) {
    return Response.json({ error: "The DM is not configured to write recaps." }, { status: 503 });
  }

  const session = await endSessionWithRecap(id);
  if (!session) {
    return Response.json({ error: "Nothing has happened yet to recap." }, { status: 400 });
  }
  return Response.json({ session });
});
