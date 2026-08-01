import { z } from "zod";
import { requireUser } from "@/server/auth";
import { joinCampaign } from "@/server/campaigns";
import { readJson, route } from "@/server/http";

const joinSchema = z.object({ code: z.string().min(1).max(20) });

export const POST = route(async (request: Request) => {
  const user = await requireUser();
  const { code } = joinSchema.parse(await readJson(request));
  const campaign = await joinCampaign({
    code,
    userId: user.id,
    displayName: user.displayName,
  });
  return Response.json({ campaign });
});
