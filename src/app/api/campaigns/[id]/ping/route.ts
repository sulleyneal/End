import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { campaignMembers } from "@/db/schema";
import { pingAllowed, pingCooldownRemaining } from "@/lib/notify-rules";
import { requireMembership } from "@/server/auth";
import { readJson, route, RuleError } from "@/server/http";
import { markPinged, notify } from "@/server/notify";

/**
 * "Anyone about?" — a deliberate nudge to the table.
 *
 * The one notification that ignores presence, because the sender is explicitly
 * asking for attention and "online" only means a tab is connected — quite
 * possibly backgrounded on a phone, which is exactly when a poke is wanted.
 *
 * Rate-limited server-side. A cooldown enforced only by a disabled button is
 * not a cooldown; anyone can POST this route directly.
 */

export const runtime = "nodejs";

const pingSchema = z.object({
  message: z.string().max(200).optional(),
});

export const POST = route(
  async (request: Request, ctx: RouteContext<"/api/campaigns/[id]/ping">) => {
    const { id } = await ctx.params;
    const { user } = await requireMembership(id);
    const body = pingSchema.parse(await readJson(request));

    const [me] = await db
      .select({ lastPingedAt: campaignMembers.lastPingedAt })
      .from(campaignMembers)
      .where(
        and(eq(campaignMembers.campaignId, id), eq(campaignMembers.userId, user.id)),
      )
      .limit(1);

    const now = new Date();
    if (!pingAllowed(me?.lastPingedAt ?? null, now)) {
      const wait = pingCooldownRemaining(me?.lastPingedAt ?? null, now);
      throw new RuleError(
        `You pinged the table recently. Try again in ${Math.ceil(wait / 60)} min.`,
      );
    }

    // Claimed before sending, so two taps in the same second cannot both pass.
    await markPinged(id, user.id);

    const note = body.message?.trim();
    const result = await notify({
      campaignId: id,
      reason: "ping",
      actorUserId: user.id,
      title: `${user.displayName} is looking for the party`,
      body: note && note.length > 0 ? note : "Anyone around to play?",
    });

    return Response.json({ ok: true, ...result });
  },
);
