import { z } from "zod";
import { requireMembership } from "@/server/auth";
import { getCharacterSheet, setItemEquipped } from "@/server/characters";
import { readJson, route } from "@/server/http";

const patchSchema = z.object({
  equip: z.object({ itemIndex: z.string().max(60), equipped: z.boolean() }),
});

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/characters/[id]">) => {
  const { id } = await ctx.params;
  const sheet = await getCharacterSheet(id);
  // Reading a sheet requires membership of the campaign it belongs to.
  await requireMembership(sheet.campaignId);
  return Response.json({ character: sheet });
});

export const PATCH = route(async (request: Request, ctx: RouteContext<"/api/characters/[id]">) => {
  const { id } = await ctx.params;
  const sheet = await getCharacterSheet(id);
  const { user, membership } = await requireMembership(sheet.campaignId);

  // A player may only re-equip their own character; a co-DM may adjust anyone's.
  if (sheet.userId !== user.id && membership.role !== "co_dm") {
    return Response.json({ error: "That is not your character." }, { status: 403 });
  }

  const body = patchSchema.parse(await readJson(request));
  const updated = await setItemEquipped({
    characterId: id,
    itemIndex: body.equip.itemIndex,
    equipped: body.equip.equipped,
  });
  return Response.json({ character: updated });
});
