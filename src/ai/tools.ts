import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CONDITIONS } from "@/rules/conditions";

/**
 * The DM's vocabulary.
 *
 * Every tool here expresses an *intent*, never an outcome. There is no field
 * anywhere in these schemas for a damage number, a hit point total, a die
 * result, or whether an attack landed — the model cannot express those things,
 * so it cannot assert them. It says "Grish attacks Roland with a scimitar"; the
 * server rolls, applies the rules, and hands back what actually happened for
 * the model to describe.
 *
 * The one number the DM does set is a DC, because choosing a difficulty is a
 * judgement call rather than a die roll. It is clamped to a sane band and shown
 * to players as an explicit ruling.
 */

export const DC_MIN = 5;
export const DC_MAX = 30;

export const narrateSchema = z.object({
  text: z.string().min(1).max(4000),
});

export const npcSaysSchema = z.object({
  npc: z.string().min(1).max(80),
  text: z.string().min(1).max(2000),
});

export const callForCheckSchema = z.object({
  character: z.string().min(1).max(80),
  /** An SRD skill index (e.g. "stealth"), or an ability for a raw check. */
  skill: z.string().min(1).max(40),
  dc: z.number().int().min(DC_MIN).max(DC_MAX),
  reason: z.string().min(1).max(300),
});

export const callForSaveSchema = z.object({
  character: z.string().min(1).max(80),
  ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]),
  dc: z.number().int().min(DC_MIN).max(DC_MAX),
  reason: z.string().min(1).max(300),
});

export const attackSchema = z.object({
  attacker: z.string().min(1).max(80),
  target: z.string().min(1).max(80),
  /** Which of the attacker's readied attacks to use; defaults to the first. */
  weapon: z.string().max(80).optional(),
});

export const applyConditionSchema = z.object({
  target: z.string().min(1).max(80),
  condition: z.enum(CONDITIONS),
  reason: z.string().min(1).max(300),
});

export const removeConditionSchema = z.object({
  target: z.string().min(1).max(80),
  condition: z.enum(CONDITIONS),
});

export const startEncounterSchema = z.object({
  name: z.string().min(1).max(80),
  monsters: z
    .array(
      z.object({
        index: z.string().min(1).max(60),
        count: z.number().int().min(1).max(12),
      }),
    )
    .min(1)
    .max(8),
});

export const dmRulingSchema = z.object({
  question: z.string().min(1).max(400),
  ruling: z.string().min(1).max(1500),
  /** How it will be adjudicated, e.g. "DC 15 Athletics check". */
  mechanic: z.string().max(200).optional(),
});

export const moveSceneSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.string().max(40).optional(),
  description: z.string().max(2000).optional(),
});

/**
 * Models routinely send a lone string where the schema asks for a list of one.
 * The intent is unambiguous, so accept it rather than burning a round-trip
 * making the DM re-send the same fact wrapped in brackets.
 */
const listOf = (item: z.ZodString, max: number) =>
  z.preprocess((value) => (typeof value === "string" ? [value] : value), z.array(item).max(max));

export const rememberSchema = z.object({
  facts: listOf(z.string().min(1).max(400), 8).optional(),
  npcs: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        role: z.string().max(120).optional(),
        description: z.string().max(600).optional(),
        voice: z.string().max(200).optional(),
        secrets: z.string().max(600).optional(),
        dispositionChange: z.number().int().min(-100).max(100).optional(),
      }),
    )
    .max(6)
    .optional(),
  threads: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        summary: z.string().min(1).max(600),
        status: z.enum(["open", "advanced", "resolved", "abandoned"]).optional(),
        urgency: z.number().int().min(1).max(5).optional(),
      }),
    )
    .max(6)
    .optional(),
  quests: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        status: z.string().max(40).optional(),
        objectives: listOf(z.string().min(1).max(200), 8).optional(),
        rewards: z.string().max(300).optional(),
      }),
    )
    .max(4)
    .optional(),
});

export const awardXpSchema = z.object({
  amount: z.number().int().min(0).max(20000),
  reason: z.string().min(1).max(300),
});

/** The tool definitions handed to the model. */
export const DM_TOOLS: Anthropic.Tool[] = [
  {
    name: "narrate",
    description:
      "Describe what the party sees, hears and experiences. Use this for scene-setting and for describing the result of actions the engine has already resolved. Do not state any dice result, damage number or hit point total unless a tool result gave it to you.",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "The narration, in second person plural." } },
      required: ["text"],
    },
  },
  {
    name: "npc_says",
    description: "Speak as a named NPC. Keep to that NPC's established voice and knowledge.",
    input_schema: {
      type: "object",
      properties: {
        npc: { type: "string", description: "The NPC's name." },
        text: { type: "string", description: "What they say." },
      },
      required: ["npc", "text"],
    },
  },
  {
    name: "call_for_check",
    description:
      "Ask a character to make an ability check. The server rolls it with that character's real modifiers and tells you whether it succeeded. Use this whenever the outcome of an action is uncertain.",
    input_schema: {
      type: "object",
      properties: {
        character: { type: "string", description: "The character's name." },
        skill: {
          type: "string",
          description:
            "An SRD skill index such as stealth, perception, persuasion, athletics — or an ability (str, dex, con, int, wis, cha) for a raw check.",
        },
        dc: {
          type: "integer",
          description: `Difficulty class, ${DC_MIN}-${DC_MAX}. 10 is easy, 15 moderate, 20 hard.`,
        },
        reason: { type: "string", description: "What they are attempting." },
      },
      required: ["character", "skill", "dc", "reason"],
    },
  },
  {
    name: "call_for_save",
    description:
      "Ask a character to make a saving throw. The server rolls it and tells you the result.",
    input_schema: {
      type: "object",
      properties: {
        character: { type: "string" },
        ability: { type: "string", enum: ["str", "dex", "con", "int", "wis", "cha"] },
        dc: { type: "integer", description: `Difficulty class, ${DC_MIN}-${DC_MAX}.` },
        reason: { type: "string" },
      },
      required: ["character", "ability", "dc", "reason"],
    },
  },
  {
    name: "attack",
    description:
      "Have a creature attack another. The server checks reach and range, rolls the attack and damage, applies the rules and returns exactly what happened. You never decide whether it hits or how much damage it does.",
    input_schema: {
      type: "object",
      properties: {
        attacker: { type: "string", description: "Name of the attacking combatant." },
        target: { type: "string", description: "Name of the target combatant." },
        weapon: { type: "string", description: "Optional: which readied attack to use." },
      },
      required: ["attacker", "target"],
    },
  },
  {
    name: "apply_condition",
    description:
      "Apply one of the 15 SRD conditions to a creature. The engine enforces its mechanical effects.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        condition: { type: "string", enum: [...CONDITIONS] },
        reason: { type: "string" },
      },
      required: ["target", "condition", "reason"],
    },
  },
  {
    name: "remove_condition",
    description: "Remove a condition from a creature.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        condition: { type: "string", enum: [...CONDITIONS] },
      },
      required: ["target", "condition"],
    },
  },
  {
    name: "start_encounter",
    description:
      "Roll initiative and begin a combat encounter with SRD monsters. Use the monster's SRD index, e.g. goblin, wolf, bandit, ogre.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "A name for the fight." },
        monsters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              index: { type: "string", description: "SRD monster index, lowercase and hyphenated." },
              count: { type: "integer", description: "How many." },
            },
            required: ["index", "count"],
          },
        },
      },
      required: ["name", "monsters"],
    },
  },
  {
    name: "dm_ruling",
    description:
      "Make an explicit ruling on something the rules engine cannot adjudicate — an improvised stunt, an environmental trick, an ambiguous interaction. This is shown to players as a distinct ruling card, so be clear and consistent.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The situation being ruled on." },
        ruling: { type: "string", description: "Your ruling and why." },
        mechanic: { type: "string", description: "How it resolves, e.g. 'DC 15 Athletics check'." },
      },
      required: ["question", "ruling"],
    },
  },
  {
    name: "move_scene",
    description: "Move the party to a location, creating it if it is new.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: { type: "string", description: "e.g. tavern, dungeon, road, city." },
        description: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "remember",
    description:
      "Write durable campaign memory: canon facts, NPCs, plot threads and quests. Record anything a future session must not contradict. Prefer updating an existing entry to creating a near-duplicate.",
    input_schema: {
      type: "object",
      properties: {
        facts: {
          type: "array",
          items: { type: "string" },
          description: "Durable canon the DM must never contradict.",
        },
        npcs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              description: { type: "string" },
              voice: { type: "string" },
              secrets: { type: "string" },
              dispositionChange: {
                type: "integer",
                description: "Shift toward the party, -100 to 100.",
              },
            },
            required: ["name"],
          },
        },
        threads: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              status: { type: "string", enum: ["open", "advanced", "resolved", "abandoned"] },
              urgency: { type: "integer", description: "1 (background) to 5 (pressing)." },
            },
            required: ["title", "summary"],
          },
        },
        quests: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              status: { type: "string" },
              objectives: { type: "array", items: { type: "string" } },
              rewards: { type: "string" },
            },
            required: ["title"],
          },
        },
      },
    },
  },
  {
    name: "award_xp",
    description: "Award experience to the whole party.",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "integer" },
        reason: { type: "string" },
      },
      required: ["amount", "reason"],
    },
  },
];

export const DM_TOOL_NAMES = DM_TOOLS.map((t) => t.name);
