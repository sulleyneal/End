import { and, eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";

/**
 * Web push delivery.
 *
 * Self-contained: no third-party service, no accounts, just VAPID keys and the
 * browser's own push service. The catch is iOS, which only permits push once
 * the site has been added to the Home Screen — hence the manifest, and hence
 * Discord existing alongside this rather than being replaced by it.
 */

let configured: boolean | null = null;

/**
 * Push stays dormant until the keys are set, rather than throwing.
 *
 * The app must run without them — they are configured in Vercel by hand, and a
 * missing key should degrade to "no push" rather than breaking a player's turn.
 */
function ensureConfigured(): boolean {
  if (configured !== null) return configured;

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:dm@example.com",
    publicKey,
    privateKey,
  );
  configured = true;
  return true;
}

export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

export function isPushConfigured(): boolean {
  return ensureConfigured();
}

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
};

/**
 * Sends to every device belonging to these users.
 *
 * Endpoints expire on their own, so 404 and 410 are not failures to retry —
 * they mean the subscription is dead and the row should go. Leaving them
 * behind means every future send pays for a guaranteed failure per stale
 * device, forever.
 */
export async function sendPush(userIds: string[], payload: PushPayload): Promise<number> {
  if (userIds.length === 0 || !ensureConfigured()) return 0;

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));

  if (subs.length === 0) return 0;

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(sub.id);
        else console.error(`Push to ${sub.endpoint.slice(0, 40)}… failed:`, status);
      }
    }),
  );

  if (dead.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, dead));
  }

  return sent;
}

export async function saveSubscription(params: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<void> {
  // Endpoints are unique, and a browser re-subscribing produces the same one.
  // Upserting keeps a re-grant from failing on the unique index.
  await db
    .insert(pushSubscriptions)
    .values(params)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId: params.userId, p256dh: params.p256dh, auth: params.auth },
    });
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(
      and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)),
    );
}
