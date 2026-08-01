import { z } from "zod";
import { createUser, getSessionUser, reclaimUser, signOut } from "@/server/auth";
import { readJson, route } from "@/server/http";

const bodySchema = z.union([
  z.object({ displayName: z.string().min(1).max(40) }),
  z.object({ reclaimCode: z.string().min(3).max(60) }),
]);

/** Who am I? Returns `{ user: null }` rather than a 401 so the client can branch. */
export const GET = route(async () => {
  return Response.json({ user: await getSessionUser() });
});

/** Sign in: either register a new display name, or reclaim an existing player. */
export const POST = route(async (request: Request) => {
  const body = bodySchema.parse(await readJson(request));

  if ("reclaimCode" in body) {
    return Response.json({ user: await reclaimUser(body.reclaimCode), reclaimCode: null });
  }

  const { user, reclaimCode } = await createUser(body.displayName);
  return Response.json({ user, reclaimCode }, { status: 201 });
});

export const DELETE = route(async () => {
  await signOut();
  return Response.json({ ok: true });
});
