import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { campaignMembers, campaignSettings, campaigns } from "@/db/schema";
import { presenceOf } from "@/lib/presence";
import { type NotifyReason, selectRecipients } from "@/lib/notify-rules";
import { sendDiscord } from "./discord";
import { sendPush } from "./push";

/**
 * One funnel for every notification.
 *
 * Transports are interchangeable behind this: Discord because it needs nothing
 * installed, web push because it stands on its own. Callers say who should know
 * and why — never which channel — so adding or dropping a transport is a change
 * in one file rather than at every trigger site.
 *
 * Nothing in here is allowed to throw. A notification is a courtesy attached to
 * a real action, and a dead webhook must never be the reason somebody's turn
 * fails to submit.
 */

export type NotifyInput = {
  campaignId: string;
  reason: NotifyReason;
  title: string;
  body: string;
  /** Restrict to specific members; omit for everyone who opted in. */
  targetUserIds?: string[];
  /** Whoever caused this; never notified about their own action. */
  actorUserId?: string;
};

export type NotifyResult = {
  recipients: number;
  discord: boolean;
  push: number;
};

const EMPTY: NotifyResult = { recipients: 0, discord: false, push: 0 };

function campaignUrl(campaignId: string): string {
  const base =
    process.env.PUBLIC_BASE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "");
  return `${base}/campaign/${campaignId}`;
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  try {
    return await deliver(input);
  } catch (error) {
    console.error("Notification failed:", error);
    return EMPTY;
  }
}

async function deliver(input: NotifyInput): Promise<NotifyResult> {
  const members = await db
    .select()
    .from(campaignMembers)
    .where(eq(campaignMembers.campaignId, input.campaignId));

  if (members.length === 0) return EMPTY;

  const now = new Date();
  const recipients = selectRecipients(
    members.map((m) => ({
      userId: m.userId,
      presence: presenceOf(m.lastActiveAt, now),
      notifyOnTurn: m.notifyOnTurn,
      notifyOnDm: m.notifyOnDm,
      notifyOnChat: m.notifyOnChat,
      notifyOnPing: m.notifyOnPing,
    })),
    {
      reason: input.reason,
      targetUserIds: input.targetUserIds,
      actorUserId: input.actorUserId,
    },
  );

  if (recipients.length === 0) return EMPTY;

  const url = campaignUrl(input.campaignId);
  const [settings] = await db
    .select()
    .from(campaignSettings)
    .where(eq(campaignSettings.campaignId, input.campaignId))
    .limit(1);

  const [campaign] = await db
    .select({ name: campaigns.name })
    .from(campaigns)
    .where(eq(campaigns.id, input.campaignId))
    .limit(1);

  const title = campaign ? `${campaign.name} — ${input.title}` : input.title;

  // Only mention the recipients, not every member who happens to have linked an
  // account: a Discord post goes to one channel everybody reads, so the mention
  // list is the only thing separating "for you" from noise.
  const mentionUserIds = members
    .filter((m) => recipients.includes(m.userId) && m.discordUserId)
    .map((m) => m.discordUserId!);

  const [discord, push] = await Promise.all([
    settings?.discordWebhookUrl
      ? sendDiscord({
          webhookUrl: settings.discordWebhookUrl,
          mentionUserIds,
          title,
          body: input.body,
          url,
        })
      : Promise.resolve(false),
    sendPush(recipients, { title, body: input.body, url, tag: input.reason }),
  ]);

  return { recipients: recipients.length, discord, push };
}

/** Records that a member pinged, for the cooldown. */
export async function markPinged(campaignId: string, userId: string): Promise<void> {
  await db
    .update(campaignMembers)
    .set({ lastPingedAt: new Date() })
    .where(
      and(eq(campaignMembers.campaignId, campaignId), eq(campaignMembers.userId, userId)),
    );
}

/** The members a turn notification is for, given the characters in play. */
export async function ownersOfCharacters(
  campaignId: string,
  userIds: (string | null)[],
): Promise<string[]> {
  const ids = userIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];
  const rows = await db
    .select({ userId: campaignMembers.userId })
    .from(campaignMembers)
    .where(
      and(
        eq(campaignMembers.campaignId, campaignId),
        inArray(campaignMembers.userId, ids),
      ),
    );
  return rows.map((r) => r.userId);
}
