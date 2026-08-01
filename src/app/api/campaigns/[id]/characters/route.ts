import { z } from "zod";
import { requireMembership } from "@/server/auth";
import { createCharacter, listCharacters } from "@/server/characters";
import { readJson, route } from "@/server/http";

const scores = z.object({
  str: z.number().int(),
  dex: z.number().int(),
  con: z.number().int(),
  int: z.number().int(),
  wis: z.number().int(),
  cha: z.number().int(),
});

const createSchema = z.object({
  name: z.string().min(1).max(60),
  classIndex: z.string().min(1).max(40),
  raceIndex: z.string().min(1).max(40),
  subraceIndex: z.string().max(40).nullish(),
  background: z.string().max(60).optional(),
  alignment: z.string().max(40).optional(),
  scores,
  scoreMethod: z.enum(["standard-array", "point-buy", "manual"]),
  skillChoices: z.array(z.string().max(60)).max(6).default([]),
  raceProficiencyChoices: z.array(z.string().max(60)).max(6).optional(),
  equipmentSelections: z
    .array(
      z.object({
        block: z.number().int().min(0).max(20),
        option: z.number().int().min(0).max(20),
        picks: z.array(z.string().max(60)).max(6).optional(),
      }),
    )
    .max(20)
    .optional(),
});

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/campaigns/[id]/characters">) => {
  const { id } = await ctx.params;
  await requireMembership(id);
  return Response.json({ characters: await listCharacters(id) });
});

export const POST = route(
  async (request: Request, ctx: RouteContext<"/api/campaigns/[id]/characters">) => {
    const { id } = await ctx.params;
    const { user } = await requireMembership(id);
    const body = createSchema.parse(await readJson(request));

    const character = await createCharacter({
      campaignId: id,
      userId: user.id,
      request: body,
    });
    return Response.json({ character }, { status: 201 });
  },
);
