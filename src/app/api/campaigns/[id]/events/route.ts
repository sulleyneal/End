import type { NextRequest } from "next/server";
import { requireMembership } from "@/server/auth";
import { currentSeq, eventsSince } from "@/server/events";
import { route } from "@/server/http";

/**
 * The cursor endpoint behind the SSE stream.
 *
 * Same query, three jobs: the polling fallback when EventSource is unavailable,
 * the catch-up read after a long disconnect, and the "what did I miss?" query
 * for a player taking an async turn days later.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(
  async (request: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/events">) => {
    const { id } = await ctx.params;
    await requireMembership(id);

    const since = Math.max(0, Number(request.nextUrl.searchParams.get("since")) || 0);
    const limit = Math.min(500, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 200));

    const events = await eventsSince(id, since, limit);
    return Response.json({
      events,
      cursor: events.length > 0 ? events[events.length - 1].seq : since,
      latest: await currentSeq(id),
    });
  },
);
