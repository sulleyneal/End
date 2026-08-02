import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { campaignArcs, campaigns, locations, npcs, plotThreads, quests, worldFacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { appendEvent, postMessage } from "@/server/events";
import { CAMPAIGN_MODEL, anthropic } from "./client";
import { ensureOpenSession } from "./recap";

/**
 * Campaign generation.
 *
 * A new table is not a blank page. This runs once, when a campaign is created,
 * and produces the setting, the arc, the cast, the places and the opening scene
 * — written straight into the structured memory tables the DM reads every turn,
 * not into a prompt blob. From then on the DM is continuing something rather
 * than inventing it fresh each time.
 *
 * The model is given no numbers to decide. Everything here is fiction: names,
 * relationships, places, hooks. Not one hit point.
 */

const GENERATION_TOOL: Anthropic.Tool = {
  name: "create_campaign",
  description:
    "Record the campaign you have invented. Call this exactly once, with everything filled in.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "The campaign's title. Evocative, not generic." },
      premise: {
        type: "string",
        description: "Two or three sentences: the world, the trouble, and why it matters now.",
      },
      themes: {
        type: "array",
        items: { type: "string" },
        description: "Three to five tonal themes, e.g. 'debts that outlive the dead'.",
      },
      acts: {
        type: "array",
        description: "Three acts. Where this is meant to go, not a script.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
          },
          required: ["title", "summary"],
        },
      },
      plannedClimax: { type: "string", description: "How the arc is meant to end, if unopposed." },
      npcs: {
        type: "array",
        description: "Four to seven named people the party can meet, talk to, or be hurt by.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string", description: "What they are to the story, e.g. 'reluctant informant'." },
            description: { type: "string", description: "How they look and carry themselves." },
            voice: { type: "string", description: "How they speak — rhythm, vocabulary, tics." },
            secret: { type: "string", description: "What they are hiding. The party does not know this." },
            location: { type: "string", description: "Where they usually are." },
            disposition: {
              type: "integer",
              description: "Starting attitude to the party, -100 hostile to 100 devoted.",
            },
          },
          required: ["name", "role", "description", "voice", "secret", "location", "disposition"],
        },
      },
      locations: {
        type: "array",
        description: "Three to six places, starting with where the party begins.",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", description: "e.g. village, ruin, road, keep" },
            description: { type: "string" },
            discovered: { type: "boolean", description: "True only for where the party starts." },
          },
          required: ["name", "type", "description", "discovered"],
        },
      },
      plotThreads: {
        type: "array",
        description: "Two to four open questions driving the story.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            urgency: { type: "integer", description: "1 simmering to 5 burning." },
          },
          required: ["title", "summary", "urgency"],
        },
      },
      openingQuest: {
        type: "object",
        description: "The first thing the party can actually go and do.",
        properties: {
          title: { type: "string" },
          objective: { type: "string" },
          giver: { type: "string", description: "The name of the NPC who offers it, if any." },
          reward: { type: "string" },
        },
        required: ["title", "objective"],
      },
      worldFacts: {
        type: "array",
        items: { type: "string" },
        description: "Three to six pieces of canon you must not later contradict.",
      },
      openingScene: {
        type: "string",
        description:
          "The narration that opens the first session, addressed to the party in second person. " +
          "Ground them in a specific place with specific sensory detail, give them something " +
          "concrete happening in front of them, and end with an implicit or explicit invitation " +
          "to act. Do not ask them to introduce themselves. Do not narrate their feelings or " +
          "decisions. Four to six paragraphs.",
      },
    },
    required: [
      "title",
      "premise",
      "themes",
      "acts",
      "plannedClimax",
      "npcs",
      "locations",
      "plotThreads",
      "openingQuest",
      "worldFacts",
      "openingScene",
    ],
  },
};

const SYSTEM_PROMPT = `You invent original tabletop campaigns for a D&D 5e group.

Write something specific. A campaign about "an ancient evil stirring" is not a
campaign; a campaign about a village that has been quietly paying its dead
neighbours' debts for thirty years is. Favour concrete, strange, human trouble
over cosmic stakes. The party are level 1 — the opening should be survivable and
local, with the larger shape visible only at the edges.

Every NPC gets a real voice: how they speak, what they will not say, what they
want that conflicts with what they claim to want.

You are writing fiction only. You never decide a hit point, a damage figure, a
saving throw, or whether an attack lands — the application enforces all rules and
rolls all dice. Do not invent game statistics.

Call create_campaign exactly once with the whole campaign.`;

export type GeneratedCampaign = {
  title: string;
  premise: string;
  openingScene: string;
};

/**
 * Generates a campaign and writes it into memory. Safe to fail: on any error the
 * campaign still exists and stays playable, it just starts without a prepared
 * world.
 */
export async function generateCampaign(params: {
  campaignId: string;
  name: string;
  genre?: string | null;
  tone?: string | null;
  premise?: string | null;
}): Promise<GeneratedCampaign | null> {
  const wishes = [
    params.name ? `The group called their table "${params.name}".` : null,
    params.genre ? `Genre they asked for: ${params.genre}.` : null,
    params.tone ? `Tone they asked for: ${params.tone}.` : null,
    params.premise ? `They suggested this premise, which you should honour: ${params.premise}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic().messages.create({
    model: CAMPAIGN_MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    tools: [GENERATION_TOOL],
    tool_choice: { type: "tool", name: "create_campaign" },
    messages: [
      {
        role: "user",
        content: `Invent a campaign for a new party of level 1 adventurers.\n\n${
          wishes || "They gave you no constraints. Surprise them."
        }`,
      },
    ],
  });

  const call = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );
  if (!call) return null;

  const plan = call.input as {
    title: string;
    premise: string;
    themes: string[];
    acts: { title: string; summary: string }[];
    plannedClimax: string;
    npcs: {
      name: string;
      role: string;
      description: string;
      voice: string;
      secret: string;
      location: string;
      disposition: number;
    }[];
    locations: { name: string; type: string; description: string; discovered: boolean }[];
    plotThreads: { title: string; summary: string; urgency: number }[];
    openingQuest: { title: string; objective: string; giver?: string; reward?: string };
    worldFacts: string[];
    openingScene: string;
  };

  const { campaignId } = params;

  await db.insert(campaignArcs).values({
    campaignId,
    title: plan.title,
    premise: plan.premise,
    acts: plan.acts ?? [],
    currentAct: 1,
    themes: plan.themes ?? [],
    plannedClimax: plan.plannedClimax,
  });

  if (plan.locations?.length) {
    await db.insert(locations).values(
      plan.locations.map((l) => ({
        campaignId,
        name: l.name,
        type: l.type,
        description: l.description,
        discovered: l.discovered ?? false,
      })),
    );
  }

  if (plan.npcs?.length) {
    await db.insert(npcs).values(
      plan.npcs.map((n) => ({
        campaignId,
        name: n.name,
        role: n.role,
        description: n.description,
        voice: n.voice,
        secrets: n.secret,
        location: n.location,
        // The model is asked for -100..100; clamp rather than trust it.
        dispositionToParty: Math.max(-100, Math.min(100, Math.round(n.disposition ?? 0))),
        alive: true,
      })),
    );
  }

  if (plan.plotThreads?.length) {
    await db.insert(plotThreads).values(
      plan.plotThreads.map((t) => ({
        campaignId,
        title: t.title,
        summary: t.summary,
        status: "open" as const,
        urgency: Math.max(1, Math.min(5, Math.round(t.urgency ?? 3))),
      })),
    );
  }

  if (plan.openingQuest) {
    await db.insert(quests).values({
      campaignId,
      title: plan.openingQuest.title,
      objectives: [{ text: plan.openingQuest.objective, done: false }],
      rewards: plan.openingQuest.reward ?? null,
      status: "offered",
    });
  }

  if (plan.worldFacts?.length) {
    await db.insert(worldFacts).values(
      plan.worldFacts.map((fact) => ({ campaignId, fact })),
    );
  }

  await db
    .update(campaigns)
    .set({ premise: plan.premise, status: "active" })
    .where(eq(campaigns.id, campaignId));

  // The opening scene is a DM narration like any other, so it lands in the log,
  // streams to everyone connected, and is there on refresh.
  await postMessage({
    campaignId,
    authorType: "dm",
    authorName: "Dungeon Master",
    kind: "narration",
    content: plan.openingScene,
  });

  // Session 1 opens here, so the first recap knows where the story began.
  await ensureOpenSession(campaignId);

  await appendEvent(campaignId, "campaign.generated", {
    title: plan.title,
    npcs: plan.npcs?.length ?? 0,
    locations: plan.locations?.length ?? 0,
  });

  return { title: plan.title, premise: plan.premise, openingScene: plan.openingScene };
}
