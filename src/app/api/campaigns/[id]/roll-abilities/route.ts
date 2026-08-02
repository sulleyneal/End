import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { abilityRolls } from "@/db/schema";
import { requireMembership } from "@/server/auth";
import { route } from "@/server/http";
import { rollAbilityScores } from "@/rules/build";

/**
 * Rolling ability scores: 4d6 drop the lowest, six times.
 *
 * Server-side like every other die in the app. The result is stored, so when
 * the character is built the scores can be checked against what was actually
 * rolled — otherwise a client could simply claim six 18s, which is precisely
 * the hole the standard-array and point-buy validation exists to close.
 *
 * You roll once per campaign. Guarding only on "is there an unused roll" was
 * not enough: building a character spends the roll, which re-opened rolling, so
 * a player could roll, build a throwaway, roll again, and keep the best of five
 * — leaving four junk characters in the party. The count is per campaign
 * membership instead, which is the thing a player actually has one of.
 */

export const runtime = "nodejs";

export const GET = route(async (_req: Request, ctx: RouteContext<"/api/campaigns/[id]/roll-abilities">) => {
  const { id } = await ctx.params;
  const { user } = await requireMembership(id);

  const [existing] = await db
    .select()
    .from(abilityRolls)
    .where(
      and(
        eq(abilityRolls.campaignId, id),
        eq(abilityRolls.userId, user.id),
        isNull(abilityRolls.usedAt),
      ),
    )
    .orderBy(desc(abilityRolls.createdAt))
    .limit(1);

  return Response.json({
    roll: existing ? { scores: existing.scores, rolls: existing.rolls } : null,
  });
});

export const POST = route(async (_req: Request, ctx: RouteContext<"/api/campaigns/[id]/roll-abilities">) => {
  const { id } = await ctx.params;
  const { user } = await requireMembership(id);

  // Any roll at this table, spent or not — one roll per player per campaign.
  const [existing] = await db
    .select()
    .from(abilityRolls)
    .where(and(eq(abilityRolls.campaignId, id), eq(abilityRolls.userId, user.id)))
    .orderBy(desc(abilityRolls.createdAt))
    .limit(1);

  if (existing) {
    return Response.json(
      {
        error: existing.usedAt
          ? "You have already rolled at this table and used it. Standard array is available for another character."
          : "You have already rolled for this character. Use those scores or pick another method.",
        roll: { scores: existing.scores, rolls: existing.rolls },
      },
      { status: 409 },
    );
  }

  const result = rollAbilityScores();
  await db.insert(abilityRolls).values({
    userId: user.id,
    campaignId: id,
    scores: result.scores,
    rolls: result.rolls,
  });

  return Response.json({ roll: result }, { status: 201 });
});
