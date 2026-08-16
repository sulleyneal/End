/**
 * Splitting a table log into what happened and what is merely being asked.
 *
 * A DM turn very often ends by offering the party choices — "knock, barge in,
 * or hang back and ask what he means by consequences". Handed to a summariser
 * as ordinary log text, those options come back as events: a real catch-up
 * reported that a character had asked a question he had only been *offered* the
 * chance to ask, and that the NPC had answered it. Everything after that read
 * as established fact, so a player returning to the table was briefed on a
 * conversation that never took place.
 *
 * The fix is the same one the combat recap already uses: work the fact out in
 * code and state it, rather than hoping the model infers it. The trailing
 * prompt is separated here and labelled as unanswered, so the model is never
 * asked to decide whether a question is a question.
 */

export type LogEntry = {
  authorName: string;
  kind: string;
  content: string;
};

export type SplitLog = {
  /** Lines describing things that actually occurred. */
  events: LogEntry[];
  /**
   * Trailing DM lines that pose a question and have not been answered, because
   * no player has acted since. Never events.
   */
  pending: LogEntry[];
};

/** A player's own submission. Only these establish what a character chose to do. */
const isPlayerAction = (entry: LogEntry) => entry.kind === "action";

/**
 * Does this line put a question to the table?
 *
 * Deliberately generous. A false positive costs a sentence of context; a false
 * negative reinstates the bug this exists to prevent.
 */
export function posesAQuestion(entry: LogEntry): boolean {
  if (isPlayerAction(entry)) return false;
  const text = entry.content.trim();
  if (text.endsWith("?")) return true;
  return /\b(what do you do|over to you|what's it going to be|your move)\b/i.test(text);
}

/**
 * Separates the unanswered tail from the body of the log.
 *
 * Only the tail is treated as pending: a question the party answered two turns
 * ago is settled, and the answer is in the log after it.
 */
export function splitPendingPrompt(entries: LogEntry[]): SplitLog {
  let cut = entries.length;

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    // A player acting closes everything before it; the tail starts after.
    if (isPlayerAction(entry)) break;
    if (posesAQuestion(entry)) cut = i;
  }

  return { events: entries.slice(0, cut), pending: entries.slice(cut) };
}

export const renderEntries = (entries: LogEntry[]): string =>
  entries.map((e) => `${e.authorName} (${e.kind}): ${e.content}`).join("\n\n");
