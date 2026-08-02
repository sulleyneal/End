import Anthropic from "@anthropic-ai/sdk";

/**
 * The Anthropic client, server-only.
 *
 * Three tiers, sized to how much invention each job actually needs. The key is
 * stored server-side and never reaches the browser.
 *
 * The split that matters is between generating a campaign and running one.
 * Generation happens once and invents the setting, the NPCs and the plot
 * threads that everything afterwards hangs off, so it gets the strongest model.
 * Running a turn is a far more constrained job: the rules engine already owns
 * every number, the structured projection already says what is true, and the
 * DM's work is prose plus tool calls inside those rails. That job runs on every
 * single player action — it is where the spend actually goes — so it sits a
 * tier down.
 */

/** Campaign generation: setting, NPCs, plot threads. Once per campaign. */
export const CAMPAIGN_MODEL = "claude-opus-5";
/** Narration and rulings, once per player action. */
export const DM_MODEL = "claude-sonnet-5";
/** Intent parsing, recaps and memory bookkeeping. */
export const PARSER_MODEL = "claude-haiku-4-5";

let cached: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (cached) return cached;

  const apiKey = process.env.DM_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No Anthropic API key. Set DM_ANTHROPIC_API_KEY so the DM can narrate.",
    );
  }

  cached = new Anthropic({ apiKey });
  return cached;
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.DM_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY);
}
