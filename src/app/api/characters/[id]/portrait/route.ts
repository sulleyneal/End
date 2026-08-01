import { eq } from "drizzle-orm";
import { db } from "@/db";
import { characters } from "@/db/schema";
import { requireMembership } from "@/server/auth";
import { getCharacterSheet } from "@/server/characters";
import { NotFoundError, route } from "@/server/http";

/**
 * Character portraits.
 *
 * Stored as bytes in Postgres rather than in blob storage: it keeps the app to
 * one stateful dependency, and a portrait that survives with the character row
 * cannot be orphaned by a failed delete. The client resizes before uploading,
 * and this rejects anything past the cap regardless — a client-side limit is a
 * convenience, never a control.
 */

export const runtime = "nodejs";

const MAX_BYTES = 512 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/characters/[id]/portrait">) => {
  const { id } = await ctx.params;
  const [row] = await db
    .select({ portrait: characters.portrait, mime: characters.portraitMime, campaignId: characters.campaignId })
    .from(characters)
    .where(eq(characters.id, id))
    .limit(1);

  if (!row) throw new NotFoundError("No such character.");
  await requireMembership(row.campaignId);
  if (!row.portrait) throw new NotFoundError("That character has no portrait.");

  return new Response(new Uint8Array(row.portrait), {
    headers: {
      "content-type": row.mime ?? "image/png",
      // Immutable per upload; a new portrait lands on a fresh URL via ?v=.
      "cache-control": "private, max-age=3600",
    },
  });
});

export const PUT = route(async (request: Request, ctx: RouteContext<"/api/characters/[id]/portrait">) => {
  const { id } = await ctx.params;
  const sheet = await getCharacterSheet(id);
  const { user } = await requireMembership(sheet.campaignId);

  // Your own face only. A co-DM has no business changing someone's portrait.
  if (sheet.userId !== user.id) {
    return Response.json({ error: "That is not your character." }, { status: 403 });
  }

  const mime = request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!ALLOWED.has(mime)) {
    return Response.json(
      { error: "Portraits must be a PNG, JPEG or WebP image." },
      { status: 415 },
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) {
    return Response.json({ error: "That image was empty." }, { status: 400 });
  }
  if (bytes.byteLength > MAX_BYTES) {
    return Response.json(
      { error: `Portraits must be under ${Math.floor(MAX_BYTES / 1024)} KB.` },
      { status: 413 },
    );
  }

  await db
    .update(characters)
    .set({ portrait: Buffer.from(bytes), portraitMime: mime })
    .where(eq(characters.id, id));

  return Response.json({ ok: true, bytes: bytes.byteLength });
});
