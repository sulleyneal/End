import { describe, expect, it } from "vitest";
import { type LogEntry, posesAQuestion, splitPendingPrompt } from "./catchup-log";

const dm = (content: string): LogEntry => ({
  authorName: "Dungeon Master",
  kind: "narration",
  content,
});
const act = (authorName: string, content: string): LogEntry => ({
  authorName,
  kind: "action",
  content,
});
const npc = (authorName: string, content: string): LogEntry => ({
  authorName,
  kind: "dialogue",
  content,
});

describe("posesAQuestion", () => {
  it("catches a plain question", () => {
    expect(posesAQuestion(dm("What do you do?"))).toBe(true);
  });

  it("catches the stock phrasings without a question mark", () => {
    expect(posesAQuestion(dm("Over to you both — Ombrast is watching."))).toBe(true);
    expect(posesAQuestion(dm("What do you do next, then."))).toBe(true);
  });

  it("leaves narration alone", () => {
    expect(posesAQuestion(dm("The stamp comes down. Thock."))).toBe(false);
  });

  it("never treats a player's own action as a prompt", () => {
    // A player writing "Do I see a door?" is still a submitted action.
    expect(posesAQuestion(act("Sulley", "Chalupa asks — is the door locked?"))).toBe(false);
  });
});

describe("splitPendingPrompt", () => {
  it("holds back an unanswered question at the end of the log", () => {
    // The real failure: the DM offered options, and a summariser reported the
    // options as things the party had done.
    const log = [
      dm("Chalupa pulls the door wide. Ombrast raises a stamp."),
      npc("Griddle", "Assessor, sir, they're Correspondents—"),
      dm("What do you do — knock, barge past Griddle, or ask what he means by consequences?"),
    ];
    const { events, pending } = splitPendingPrompt(log);
    expect(events).toHaveLength(2);
    expect(pending).toHaveLength(1);
    expect(pending[0].content).toContain("consequences");
  });

  it("holds back a run of trailing prompts", () => {
    const log = [
      dm("The room holds its breath."),
      dm("What do you do?"),
      dm("Over to you both — Poonpoon is mid-yell."),
    ];
    const { events, pending } = splitPendingPrompt(log);
    expect(events).toHaveLength(1);
    expect(pending).toHaveLength(2);
  });

  it("treats a question the party already answered as settled", () => {
    const log = [
      dm("What do you do?"),
      act("Sulley", "Chalupa opens the door for the others."),
      dm("The door swings wide onto a flooded archive."),
    ];
    const { events, pending } = splitPendingPrompt(log);
    expect(pending).toHaveLength(0);
    expect(events).toHaveLength(3);
  });

  it("keeps a question settled even when narration follows it", () => {
    const log = [
      dm("Do you follow him down?"),
      act("Slartisamus", "Poonpoon stomps off."),
      dm("Boots ring on stone."),
      npc("Griddle", "Please, wait—"),
    ];
    expect(splitPendingPrompt(log).pending).toHaveLength(0);
  });

  it("handles a log that is nothing but an unanswered prompt", () => {
    const { events, pending } = splitPendingPrompt([dm("What do you do?")]);
    expect(events).toHaveLength(0);
    expect(pending).toHaveLength(1);
  });

  it("handles an empty log", () => {
    expect(splitPendingPrompt([])).toEqual({ events: [], pending: [] });
  });

  it("leaves a log with no questions entirely intact", () => {
    const log = [dm("The stamp falls."), npc("Ombrast", "Item. One noise complaint.")];
    const { events, pending } = splitPendingPrompt(log);
    expect(events).toHaveLength(2);
    expect(pending).toHaveLength(0);
  });
});
