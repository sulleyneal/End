import { z } from "zod";
import { requireMembership } from "@/server/auth";
import { readJson, route } from "@/server/http";
import { isAiConfigured } from "@/ai/client";
import { runDmTurn } from "@/ai/dm";
import { notify } from "@/server/notify";

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

  // The table hears that the story moved. Async is the case this exists for:
  // one player acts, everyone else is asleep, and without this nobody learns
  // there is something new to read until they happen to open the app. Anyone
  // currently watching is filtered out inside `notify`, as is the actor.
  await notify({
    campaignId: id,
    reason: "dm",
    actorUserId: user.id,
    title: "The story moved",
    body: `${user.displayName} acted, and the DM responded.`,
  });

  return Response.json(result);
});
