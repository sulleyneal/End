import { z } from "zod";
import { requireMembership } from "@/server/auth";
import { readJson, route } from "@/server/http";
import { isAiConfigured } from "@/ai/client";
import { runDmTurn } from "@/ai/dm";

/**
 * A player takes an action; the DM responds.
 *
 * Runs on the Node runtime with a long budget: a DM turn can involve several
 * tool round-trips against the rules engine before it narrates.
 */

export const runtime = "nodejs";
export const maxDuration = 300;

const actionSchema = z.object({
  action: z.string().min(1).max(2000),
  ooc: z.boolean().optional(),
});

export const POST = route(async (request: Request, ctx: RouteContext<"/api/campaigns/[id]/dm">) => {
  const { id } = await ctx.params;
  const { user } = await requireMembership(id);

  if (!isAiConfigured()) {
    return Response.json(
      { error: "The DM is not configured on this deployment (no API key)." },
      { status: 503 },
    );
  }

  const body = actionSchema.parse(await readJson(request));
  const result = await runDmTurn({
    campaignId: id,
    actorName: user.displayName,
    action: body.action,
    ooc: body.ooc,
  });

  return Response.json(result);
});
