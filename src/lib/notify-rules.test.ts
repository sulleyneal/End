import { describe, expect, it } from "vitest";
import {
  type Candidate,
  PING_COOLDOWN_MS,
  pingAllowed,
  pingCooldownRemaining,
  selectRecipients,
} from "./notify-rules";

const member = (userId: string, overrides: Partial<Candidate> = {}): Candidate => ({
  userId,
  presence: "away",
  notifyOnTurn: true,
  notifyOnDm: true,
  notifyOnChat: false,
  notifyOnPing: true,
  ...overrides,
});

describe("selectRecipients", () => {
  it("notifies members who are away", () => {
    const table = [member("a"), member("b")];
    expect(selectRecipients(table, { reason: "turn" })).toEqual(["a", "b"]);
  });

  it("does not notify someone who is looking at the app", () => {
    // The whole point of the presence work: if the table is open in front of
    // you, an automatic alert tells you something already on your screen.
    const table = [member("a", { presence: "online" }), member("b")];
    expect(selectRecipients(table, { reason: "turn" })).toEqual(["b"]);
  });

  it("still pings someone who is online, because a ping is deliberate", () => {
    // "Online" can mean a backgrounded tab in a pocket, which is exactly when
    // somebody would poke you.
    const table = [member("a", { presence: "online" }), member("b")];
    expect(selectRecipients(table, { reason: "ping" })).toEqual(["a", "b"]);
  });

  it("never notifies the person who caused the event", () => {
    const table = [member("a"), member("b")];
    expect(selectRecipients(table, { reason: "chat", actorUserId: "a" })).toEqual([]);
    expect(
      selectRecipients(
        table.map((m) => ({ ...m, notifyOnChat: true })),
        { reason: "chat", actorUserId: "a" },
      ),
    ).toEqual(["b"]);
  });

  it("respects an opt-out", () => {
    const table = [member("a", { notifyOnTurn: false }), member("b")];
    expect(selectRecipients(table, { reason: "turn" })).toEqual(["b"]);
  });

  it("leaves chat off unless somebody opted in", () => {
    const table = [member("a"), member("b", { notifyOnChat: true })];
    expect(selectRecipients(table, { reason: "chat" })).toEqual(["b"]);
  });

  it("narrows to the player whose turn it actually is", () => {
    const table = [member("a"), member("b"), member("c")];
    expect(selectRecipients(table, { reason: "turn", targetUserIds: ["b"] })).toEqual(["b"]);
  });

  it("applies every filter together rather than any one of them", () => {
    const table = [
      member("a", { presence: "online" }),
      member("b", { notifyOnTurn: false }),
      member("c"),
      member("d"),
    ];
    expect(
      selectRecipients(table, { reason: "turn", targetUserIds: ["a", "b", "c"], actorUserId: "c" }),
    ).toEqual([]);
  });

  it("returns nobody for an empty table rather than throwing", () => {
    expect(selectRecipients([], { reason: "ping" })).toEqual([]);
  });
});

describe("ping cooldown", () => {
  const NOW = new Date("2026-08-04T12:00:00.000Z");
  const ago = (ms: number) => new Date(NOW.getTime() - ms);

  it("allows a first ping", () => {
    expect(pingAllowed(null, NOW)).toBe(true);
    expect(pingCooldownRemaining(null, NOW)).toBe(0);
  });

  it("blocks a second ping inside the window", () => {
    expect(pingAllowed(ago(60_000), NOW)).toBe(false);
    expect(pingCooldownRemaining(ago(60_000), NOW)).toBe(240);
  });

  it("allows one again once the window passes", () => {
    expect(pingAllowed(ago(PING_COOLDOWN_MS), NOW)).toBe(true);
    expect(pingCooldownRemaining(ago(PING_COOLDOWN_MS), NOW)).toBe(0);
  });
});
