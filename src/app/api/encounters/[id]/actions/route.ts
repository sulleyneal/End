import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { characters } from "@/db/schema";
import { requireMembership } from "@/server/auth";
import {
  endTurn,
  getEncounter,
  moveCombatant,
  performAttack,
  performDeathSave,
  castSpellAction,
} from "@/server/encounters";
import { readJson, route } from "@/server/http";

/**
 * Every in-combat action funnels through here so the same three checks happen
 * every time: you are in this campaign, this combatant is yours to command, and
 * the rules allow what you asked for.
 */

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("attack"),
    combatantId: z.string().uuid(),
    targetId: z.string().uuid(),
    attackIndex: z.number().int().min(0).max(20),
  }),
  z.object({
    type: z.literal("move"),
    combatantId: z.string().uuid(),
    path: z
      .array(z.object({ x: z.number().int().min(0).max(200), y: z.number().int().min(0).max(200) }))
      .max(60),
  }),
  z.object({
    type: z.literal("cast"),
    combatantId: z.string().uuid(),
    spellIndex: z.string().min(1).max(64),
    /** 0 for a cantrip; otherwise the slot level being spent. */
    slotLevel: z.number().int().min(0).max(9),
    targetIds: z.array(z.string().uuid()).max(12).default([]),
  }),
  z.object({ type: z.literal("end-turn"), combatantId: z.string().uuid() }),
  z.object({ type: z.literal("death-save"), combatantId: z.string().uuid() }),
]);

export const POST = route(
  async (request: Request, ctx: RouteContext<"/api/encounters/[id]/actions">) => {
    const { id } = await ctx.params;
    const encounter = await getEncounter(id);
    const { user, membership } = await requireMembership(encounter.campaignId);

    const body = actionSchema.parse(await readJson(request));

    // A player commands only their own character; a co-DM commands anything,
    // which is what lets the DM run the monsters.
    const combatant = encounter.combatants.find((c) => c.id === body.combatantId);
    if (!combatant) return Response.json({ error: "No such combatant." }, { status: 404 });

    if (membership.role !== "co_dm") {
      const owner = combatant.characterId
        ? (
            await db
              .select({ userId: characters.userId })
              .from(characters)
              .where(eq(characters.id, combatant.characterId))
              .limit(1)
          )[0]?.userId
        : null;
      if (owner !== user.id) {
        return Response.json({ error: "That is not your character to command." }, { status: 403 });
      }
    }

    switch (body.type) {
      case "attack": {
        const report = await performAttack({
          encounterId: id,
          actorId: body.combatantId,
          targetId: body.targetId,
          attackIndex: body.attackIndex,
        });
        return Response.json(report);
      }
      case "move": {
        const result = await moveCombatant({
          encounterId: id,
          combatantId: body.combatantId,
          path: body.path,
        });
        return Response.json(result);
      }
      case "cast": {
        const report = await castSpellAction({
          encounterId: id,
          combatantId: body.combatantId,
          spellIndex: body.spellIndex,
          slotLevel: body.slotLevel,
          targetIds: body.targetIds,
        });
        return Response.json(report);
      }
      case "end-turn":
        return Response.json({ encounter: await endTurn(id, body.combatantId) });
      case "death-save":
        return Response.json(
          await performDeathSave({ encounterId: id, combatantId: body.combatantId }),
        );
    }
  },
);

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/encounters/[id]/actions">) => {
  const { id } = await ctx.params;
  const encounter = await getEncounter(id);
  await requireMembership(encounter.campaignId);
  return Response.json({ encounter });
});
