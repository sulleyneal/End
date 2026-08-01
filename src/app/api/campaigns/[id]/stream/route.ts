import type { NextRequest } from "next/server";
import { requireMembership } from "@/server/auth";
import { currentSeq, eventsSince } from "@/server/events";
import { route } from "@/server/http";

/**
 * The realtime feed: `GET /api/campaigns/:id/stream?since=41`.
 *
 * Vercel's serverless runtime has no long-lived socket server, so instead of a
 * WebSocket (or a paid third-party realtime service) this tails the Postgres
 * event log and pushes deltas down an SSE connection. `EventSource` reconnects
 * on its own, and because the cursor is a gapless per-campaign sequence, a
 * reconnect resumes exactly where it left off — refreshing mid-combat loses
 * nothing.
 *
 * The same cursor answers `GET .../events?since=` for the polling fallback and
 * for catching up an async player who was away.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How often to look for new events. Fast enough to feel live at a tabletop. */
const POLL_MS = 700;
/** Comment frames keep proxies from closing an idle connection. */
const HEARTBEAT_MS = 15_000;
/** Recycle the connection well inside serverless limits; EventSource reconnects with its cursor. */
const MAX_LIFETIME_MS = 4 * 60 * 1000;

export const GET = route(
  async (request: NextRequest, ctx: RouteContext<"/api/campaigns/[id]/stream">) => {
    const { id } = await ctx.params;
    await requireMembership(id);

    const sinceParam = request.nextUrl.searchParams.get("since");
    // `since` omitted means "only what happens from now on".
    let cursor =
      sinceParam === null ? await currentSeq(id) : Math.max(0, Number(sinceParam) || 0);

    const encoder = new TextEncoder();
    const startedAt = Date.now();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        let timer: ReturnType<typeof setTimeout> | undefined;

        const send = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };

        const close = () => {
          if (closed) return;
          closed = true;
          if (timer) clearTimeout(timer);
          try {
            controller.close();
          } catch {
            // Already closed by the client disconnecting.
          }
        };

        request.signal.addEventListener("abort", close);

        // Tell the client where it is, so it can resume from here after a drop.
        send(`retry: 2000\n`);
        send(`event: cursor\ndata: ${JSON.stringify({ seq: cursor })}\n\n`);

        let lastBeat = Date.now();

        const tick = async () => {
          if (closed) return;

          try {
            const batch = await eventsSince(id, cursor);
            for (const event of batch) {
              cursor = event.seq;
              send(
                `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              );
            }
            if (batch.length > 0) lastBeat = Date.now();
          } catch (error) {
            console.error("Stream poll failed:", error);
            send(`event: error\ndata: ${JSON.stringify({ message: "poll failed" })}\n\n`);
          }

          if (Date.now() - lastBeat >= HEARTBEAT_MS) {
            send(`: keep-alive ${cursor}\n\n`);
            lastBeat = Date.now();
          }

          // Hand the client back with its cursor intact before the platform
          // cuts us off mid-frame.
          if (Date.now() - startedAt > MAX_LIFETIME_MS) {
            send(`event: reconnect\ndata: ${JSON.stringify({ seq: cursor })}\n\n`);
            close();
            return;
          }

          if (!closed) timer = setTimeout(tick, POLL_MS);
        };

        await tick();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Disable proxy buffering, which would otherwise hold frames back.
        "X-Accel-Buffering": "no",
      },
    });
  },
);
