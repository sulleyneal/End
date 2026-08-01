import { z } from "zod";
import { requireDmPowers, requireMembership } from "@/server/auth";
import { getActiveEncounter, startEncounter } from "@/server/encounters";
import { readJson, route } from "@/server/http";

const startSchema = z.object({
  name: z.string().min(1).max(80),
  monsters: z
    .array(z.object({ index: z.string().min(1).max(60), count: z.number().int().min(1).max(20) }))
    .max(20)
    .default([]),
  characterIds: z.array(z.string().uuid()).max(12).optional(),
  mapId: z.string().uuid().nullish(),
});

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/campaigns/[id]/encounters">) => {
  const { id } = await ctx.params;
  await requireMembership(id);
  return Response.json({ encounter: await getActiveEncounter(id) });
});

/** Only a DM starts a fight — a player cannot conjure monsters onto the table. */
export const POST = route(
  async (request: Request, ctx: RouteContext<"/api/campaigns/[id]/encounters">) => {
    const { id } = await ctx.params;
    await requireDmPowers(id);
    const body = startSchema.parse(await readJson(request));
    return Response.json({ encounter: await startEncounter(id, body) }, { status: 201 });
  },
);
