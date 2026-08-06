import { z } from "zod";
import { requireUser } from "@/server/auth";
import { readJson, route } from "@/server/http";
import { pushPublicKey, removeSubscription, saveSubscription } from "@/server/push";

/**
 * Browser push subscriptions.
 *
 * The public VAPID key is served at runtime rather than inlined at build time,
 * so configuring push in Vercel does not require a rebuild — and so the app
 * still boots, with push simply dormant, when no keys are set at all.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await requireUser();
  return Response.json({ publicKey: pushPublicKey() });
});

const subscribeSchema = z.object({
  endpoint: z.string().url().max(600),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(200) }),
});

export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const body = subscribeSchema.parse(await readJson(request));

  await saveSubscription({
    userId: user.id,
    endpoint: body.endpoint,
    p256dh: body.keys.p256dh,
    auth: body.keys.auth,
  });

  return Response.json({ ok: true });
});

const unsubscribeSchema = z.object({ endpoint: z.string().max(600) });

export const DELETE = route(async (request: Request) => {
  const user = await requireUser();
  const body = unsubscribeSchema.parse(await readJson(request));
  await removeSubscription(user.id, body.endpoint);
  return Response.json({ ok: true });
});
