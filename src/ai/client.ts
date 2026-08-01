import Anthropic from "@anthropic-ai/sdk";

/**
 * The Anthropic client, server-only.
 *
 * Two tiers, as planned: a small fast model parses player intent and maintains
 * structured memory; the large model narrates and generates campaigns. The key
 * is stored server-side and never reaches the browser.
 */

/** Narration, rulings, campaign generation. */
export const DM_MODEL = "claude-opus-5";
/** Intent parsing and memory bookkeeping. */
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
