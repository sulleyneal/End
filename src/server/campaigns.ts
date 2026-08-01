import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { campaignMembers, campaignSettings, campaigns } from "@/db/schema";
import { generateJoinCode, isPlausibleJoinCode, normalizeJoinCode } from "./codes";
import { appendEvent } from "./events";

export class CampaignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignError";
  }
}

export type CampaignSummary = {
  id: string;
  name: string;
  joinCode: string;
  status: string;
  tone: string | null;
  genre: string | null;
  premise: string | null;
  role: string;
  createdAt: string;
};

/**
 * Creates a campaign and makes its creator a co-DM.
 *
 * The AI runs the table, but somebody human has to be able to overrule it —
 * so the creator always keeps DM powers.
 */
export async function createCampaign(params: {
  name: string;
  userId: string;
  tone?: string;
  genre?: string;
  premise?: string;
}): Promise<CampaignSummary> {
  const name = params.name.trim();
  if (name.length < 1 || name.length > 80) {
    throw new CampaignError("Give the campaign a name of 1-80 characters.");
  }

  // Join codes are short enough to collide; retry rather than fail the request.
  for (let attempt = 0; attempt < 8; attempt++) {
    const joinCode = generateJoinCode();
    try {
      const [row] = await db
        .insert(campaigns)
        .values({
          name,
          joinCode,
          createdBy: params.userId,
          tone: params.tone ?? null,
          genre: params.genre ?? null,
          premise: params.premise ?? null,
        })
        .returning();

      await db.insert(campaignSettings).values({ campaignId: row.id });
      await db.insert(campaignMembers).values({
        campaignId: row.id,
        userId: params.userId,
        role: "co_dm",
      });

      return {
        id: row.id,
        name: row.name,
        joinCode: row.joinCode,
        status: row.status,
        tone: row.tone,
        genre: row.genre,
        premise: row.premise,
        role: "co_dm",
        createdAt: row.createdAt.toISOString(),
      };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  throw new CampaignError("Could not allocate a join code. Please try again.");
}

/** Joins by code. Re-joining an existing membership is a no-op, not an error. */
export async function joinCampaign(params: {
  code: string;
  userId: string;
  displayName: string;
}): Promise<CampaignSummary> {
  const code = normalizeJoinCode(params.code);
  if (!isPlausibleJoinCode(code)) {
    throw new CampaignError("That does not look like a join code.");
  }

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.joinCode, code))
    .limit(1);

  if (!campaign) throw new CampaignError("No campaign has that join code.");
  if (campaign.status === "ended") throw new CampaignError("That campaign has ended.");

  const existing = await db
    .select()
    .from(campaignMembers)
    .where(
      and(
        eq(campaignMembers.campaignId, campaign.id),
        eq(campaignMembers.userId, params.userId),
      ),
    )
    .limit(1);

  let role = existing[0]?.role ?? "player";

  if (existing.length === 0) {
    await db
      .insert(campaignMembers)
      .values({ campaignId: campaign.id, userId: params.userId, role: "player" });
    role = "player";

    await appendEvent(campaign.id, "member.joined", {
      userId: params.userId,
      displayName: params.displayName,
    });
  }

  return {
    id: campaign.id,
    name: campaign.name,
    joinCode: campaign.joinCode,
    status: campaign.status,
    tone: campaign.tone,
    genre: campaign.genre,
    premise: campaign.premise,
    role,
    createdAt: campaign.createdAt.toISOString(),
  };
}

export async function listCampaignsForUser(userId: string): Promise<CampaignSummary[]> {
  const rows = await db
    .select({ campaign: campaigns, role: campaignMembers.role })
    .from(campaignMembers)
    .innerJoin(campaigns, eq(campaigns.id, campaignMembers.campaignId))
    .where(eq(campaignMembers.userId, userId))
    .orderBy(desc(campaigns.createdAt));

  return rows.map(({ campaign, role }) => ({
    id: campaign.id,
    name: campaign.name,
    joinCode: campaign.joinCode,
    status: campaign.status,
    tone: campaign.tone,
    genre: campaign.genre,
    premise: campaign.premise,
    role,
    createdAt: campaign.createdAt.toISOString(),
  }));
}

export async function getCampaign(campaignId: string) {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  return row ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ("code" in error ? (error as { code?: string }).code === "23505" : false)
  );
}
