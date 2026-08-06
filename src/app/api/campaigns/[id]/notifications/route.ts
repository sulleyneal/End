import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { campaignMembers, campaignSettings } from "@/db/schema";
import { requireMembership } from "@/server/auth";
import { isDiscordWebhookUrl } from "@/server/discord";
import { readJson, route, RuleError } from "@/server/http";

/**
 * Per-member notification preferences, plus the table's Discord webhook.
 *
 * The webhook is only ever reported as configured or not — never echoed back.
 * Anyone holding that URL can post to the channel, so handing it to a client
 * would leak it to every member's browser and anything reading their traffic.
 */

export const runtime = "nodejs";

export const GET = route(
  async (_req: Request, ctx: RouteContext<"/api/campaigns/[id]/notifications">) => {
    const { id } = await ctx.params;
    const { user, membership } = await requireMembership(id);

    const [me] = await db
      .select()
      .from(campaignMembers)
      .where(
        and(eq(campaignMembers.campaignId, id), eq(campaignMembers.userId, user.id)),
      )
      .limit(1);

    const [settings] = await db
      .select({ discordWebhookUrl: campaignSettings.discordWebhookUrl })
      .from(campaignSettings)
      .where(eq(campaignSettings.campaignId, id))
      .limit(1);

    return Response.json({
      prefs: {
        onTurn: me?.notifyOnTurn ?? true,
        onDm: me?.notifyOnDm ?? true,
        onChat: me?.notifyOnChat ?? false,
        onPing: me?.notifyOnPing ?? true,
        discordUserId: me?.discordUserId ?? null,
      },
      discord: {
        configured: Boolean(settings?.discordWebhookUrl),
        // Only a co-DM may change it, so the client knows whether to offer.
        canEdit: membership.role === "co_dm",
      },
    });
  },
);

const patchSchema = z.object({
  onTurn: z.boolean().optional(),
  onDm: z.boolean().optional(),
  onChat: z.boolean().optional(),
  onPing: z.boolean().optional(),
  /** A Discord snowflake: digits only. Empty string unlinks. */
  discordUserId: z.string().max(32).nullable().optional(),
  /** Null clears the webhook. Co-DM only. */
  discordWebhookUrl: z.string().max(300).nullable().optional(),
});

export const PATCH = route(
  async (request: Request, ctx: RouteContext<"/api/campaigns/[id]/notifications">) => {
    const { id } = await ctx.params;
    const { user, membership } = await requireMembership(id);
    const body = patchSchema.parse(await readJson(request));

    const mine: Record<string, unknown> = {};
    if (body.onTurn !== undefined) mine.notifyOnTurn = body.onTurn;
    if (body.onDm !== undefined) mine.notifyOnDm = body.onDm;
    if (body.onChat !== undefined) mine.notifyOnChat = body.onChat;
    if (body.onPing !== undefined) mine.notifyOnPing = body.onPing;

    if (body.discordUserId !== undefined) {
      const value = body.discordUserId?.trim() ?? "";
      if (value.length > 0 && !/^\d{5,32}$/.test(value)) {
        throw new RuleError(
          "That is not a Discord user ID. Turn on Developer Mode in Discord, right-click yourself, and Copy User ID.",
        );
      }
      mine.discordUserId = value.length > 0 ? value : null;
    }

    if (Object.keys(mine).length > 0) {
      await db
        .update(campaignMembers)
        .set(mine)
        .where(
          and(eq(campaignMembers.campaignId, id), eq(campaignMembers.userId, user.id)),
        );
    }

    if (body.discordWebhookUrl !== undefined) {
      if (membership.role !== "co_dm") {
        throw new RuleError("Only the DM can set the table's Discord webhook.");
      }
      const url = body.discordWebhookUrl?.trim() ?? "";
      if (url.length > 0 && !isDiscordWebhookUrl(url)) {
        throw new RuleError(
          "That is not a Discord webhook URL. It should start with https://discord.com/api/webhooks/",
        );
      }
      await db
        .insert(campaignSettings)
        .values({ campaignId: id, discordWebhookUrl: url.length > 0 ? url : null })
        .onConflictDoUpdate({
          target: campaignSettings.campaignId,
          set: { discordWebhookUrl: url.length > 0 ? url : null },
        });
    }

    return Response.json({ ok: true });
  },
);
