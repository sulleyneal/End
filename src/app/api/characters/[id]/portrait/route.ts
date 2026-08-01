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
      // Without nosniff a browser may sniff stored bytes as HTML and execute
      // them from this origin. Portraits are user-supplied, so say what they
      // are and refuse to let the browser guess otherwise.
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
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

  // A declared content-type is just a claim. Check the bytes actually begin
  // like the image they say they are, so HTML or a script cannot be stored
  // under an image label.
  if (!looksLikeImage(bytes)) {
    return Response.json(
      { error: "That file is not a PNG, JPEG or WebP image." },
      { status: 415 },
    );
  }

  await db
    .update(characters)
    .set({ portrait: Buffer.from(bytes), portraitMime: mime })
    .where(eq(characters.id, id));

  return Response.json({ ok: true, bytes: bytes.byteLength });
});


/** PNG, JPEG and WebP magic bytes. */
function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => bytes[i] === b)) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  if (riff.every((b, i) => bytes[i] === b) && webp.every((b, i) => bytes[8 + i] === b)) {
    return true;
  }
  return false;
}
