import { z } from "zod";
import { requireUser } from "@/server/auth";
import { createCampaign, listCampaignsForUser } from "@/server/campaigns";
import { readJson, route } from "@/server/http";

const createSchema = z.object({
  name: z.string().min(1).max(80),
  tone: z.string().max(200).optional(),
  genre: z.string().max(200).optional(),
  premise: z.string().max(2000).optional(),
});

export const GET = route(async () => {
  const user = await requireUser();
  return Response.json({ campaigns: await listCampaignsForUser(user.id) });
});

export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const body = createSchema.parse(await readJson(request));
  const campaign = await createCampaign({ ...body, userId: user.id });
  return Response.json({ campaign }, { status: 201 });
});
