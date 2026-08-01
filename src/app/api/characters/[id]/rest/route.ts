import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { characters, spellSlots } from "@/db/schema";
import { requireMembership } from "@/server/auth";
import { getCharacterSheet } from "@/server/characters";
import { appendEvent, postMessage } from "@/server/events";
import { readJson, route } from "@/server/http";
import { srdGet } from "@/srd/local";
import { getActiveEncounter } from "@/server/encounters";
import { takeLongRest, takeShortRest } from "@/rules/rest";

/**
 * Resting.
 *
 * The engine for this was written and tested from the start and had no caller,
 * so a party could never get hit points or spell slots back — they had one
 * fight in them and then the campaign was over.
 *
 * Hit dice are rolled here, server-side, like every other die in the app.
 */

export const runtime = "nodejs";

const restSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("short"), hitDice: z.number().int().min(0).max(20) }),
  z.object({ type: z.literal("long") }),
]);

export const POST = route(async (request: Request, ctx: RouteContext<"/api/characters/[id]/rest">) => {
  const { id } = await ctx.params;
  const sheet = await getCharacterSheet(id);
  const { user } = await requireMembership(sheet.campaignId);

  if (sheet.userId !== user.id) {
    return Response.json({ error: "That is not your character." }, { status: 403 });
  }
  // No resting mid-fight. Without this a caster could long-rest on their own
  // turn, refill every slot, and keep casting — unlimited spell slots inside a
  // single encounter.
  const fight = await getActiveEncounter(sheet.campaignId);
  if (fight?.combatants.some((c) => c.characterId === id && !c.defeated)) {
    return Response.json(
      { error: `${sheet.name} is in a fight and cannot rest.` },
      { status: 400 },
    );
  }

  const body = restSchema.parse(await readJson(request));

  // A short rest needs you conscious to spend hit dice. A long rest is how a
  // downed character comes back — out of combat there is no other way to heal
  // them, so refusing it stranded them at 0 HP for the rest of the campaign.
  if (sheet.hpCurrent === 0 && body.type === "short") {
    return Response.json(
      { error: `${sheet.name} is unconscious and cannot take a short rest.` },
      { status: 400 },
    );
  }
  const classDoc = srdGet.class(sheet.class);

  const resting = {
    level: sheet.level,
    hitDie: classDoc.hit_die,
    hitDiceRemaining: sheet.hitDiceRemaining,
    conModifier: sheet.derived.abilities.con.modifier,
    hpCurrent: sheet.hpCurrent,
    hpMax: sheet.derived.effectiveHpMax,
    tempHp: sheet.tempHp,
    exhaustion: sheet.exhaustion,
    conditions: sheet.conditions,
    spellSlots: sheet.slots,
  };

  if (body.type === "short") {
    const result = takeShortRest(resting, body.hitDice);
    await db.update(characters).set(result.patch).where(eq(characters.id, id));

    await postMessage({
      campaignId: sheet.campaignId,
      authorType: "system",
      authorName: "System",
      kind: "system",
      content:
        result.diceSpent === 0
          ? `${sheet.name} takes a short rest and spends no hit dice.`
          : `${sheet.name} takes a short rest, spends ${result.diceSpent} hit ${
              result.diceSpent === 1 ? "die" : "dice"
            } and recovers ${result.hpHealed} HP.`,
      metadata: { kind: "rest", rest: "short", rolls: result.rolls },
    });
    await appendEvent(sheet.campaignId, "character.updated", { characterId: id, rest: "short" });

    return Response.json({ rest: result });
  }

  const result = takeLongRest(resting);
  await db.update(characters).set(result.patch).where(eq(characters.id, id));
  for (const slot of result.spellSlots) {
    await db
      .update(spellSlots)
      .set({ used: slot.used })
      .where(and(eq(spellSlots.characterId, id), eq(spellSlots.level, slot.level)));
  }

  await postMessage({
    campaignId: sheet.campaignId,
    authorType: "system",
    authorName: "System",
    kind: "system",
    content: `${sheet.name} takes a long rest: back to full hit points${
      result.spellSlots.length > 0 ? ", spell slots restored" : ""
    }.`,
    metadata: { kind: "rest", rest: "long" },
  });
  await appendEvent(sheet.campaignId, "character.updated", { characterId: id, rest: "long" });

  return Response.json({ rest: result });
});
