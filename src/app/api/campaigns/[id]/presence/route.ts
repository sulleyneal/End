import { requireMembership } from "@/server/auth";
import { listPresence, touchPresence } from "@/server/presence";
import { route } from "@/server/http";

/**
 * Who is at the table: `GET /api/campaigns/:id/presence`.
 *
 * Polled rather than pushed, because going away is not an event. Every other
 * indicator in the app rides the SSE stream, but nobody emits "I closed my
 * laptop" — absence is only ever noticed by a clock running past a threshold,
 * so this is read on a timer.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(
  async (_req: Request, ctx: RouteContext<"/api/campaigns/[id]/presence">) => {
    const { id } = await ctx.params;
    const { user } = await requireMembership(id);

    // Asking who is here is itself proof of being here. Without this, the first
    // poll on page load races the stream's opening heartbeat and loses: a player
    // who had just opened the table was shown "Nobody here" and listed as "not
    // yet joined" — for up to a full poll interval, about themselves.
    await touchPresence(id, user.id);

    return Response.json({ members: await listPresence(id) });
  },
);
