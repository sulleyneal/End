import { after } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { createCampaign, listCampaignsForUser } from "@/server/campaigns";
import { readJson, route } from "@/server/http";
import { generateCampaign } from "@/ai/generate";
import { isAiConfigured } from "@/ai/client";
import { postMessage } from "@/server/events";

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

  // Generation takes the better part of a minute, which is far too long to hold
  // a POST open. `after` runs it once the response has already gone out; the
  // opening scene reaches every connected client over the event stream, and is
  // simply in the log for anyone who arrives later.
  if (isAiConfigured()) {
    after(async () => {
      try {
        await generateCampaign({
          campaignId: campaign.id,
          name: campaign.name,
          genre: campaign.genre,
          tone: campaign.tone,
          premise: campaign.premise,
        });
      } catch (error) {
        console.error("Campaign generation failed", error);
        await postMessage({
          campaignId: campaign.id,
          authorType: "system",
          authorName: "System",
          kind: "system",
          content:
            "The DM could not prepare a world for this campaign. You can still play — " +
            "describe what your character does and the DM will pick it up from there.",
        });
      }
    });
  }

  return Response.json({ campaign }, { status: 201 });
});
