import { describe, expect, it } from "vitest";
import {
  ONLINE_MS,
  RECENT_MS,
  countOnline,
  describePresence,
  presenceOf,
} from "./presence";

const NOW = new Date("2026-08-04T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("presenceOf", () => {
  it("treats a member who has never opened the table as away", () => {
    expect(presenceOf(null, NOW)).toBe("away");
  });

  it("counts a fresh heartbeat as online", () => {
    expect(presenceOf(ago(0), NOW)).toBe("online");
    expect(presenceOf(ago(5_000), NOW)).toBe("online");
  });

  it("holds someone online right up to the threshold, then downgrades", () => {
    expect(presenceOf(ago(ONLINE_MS - 1), NOW)).toBe("online");
    expect(presenceOf(ago(ONLINE_MS), NOW)).toBe("recent");
  });

  it("holds someone recent right up to the threshold, then downgrades", () => {
    expect(presenceOf(ago(RECENT_MS - 1), NOW)).toBe("recent");
    expect(presenceOf(ago(RECENT_MS), NOW)).toBe("away");
  });

  it("treats a heartbeat from the future as online rather than away", () => {
    // Server and client clocks disagree; a negative age must not wrap around
    // into the largest possible age and blink an active player offline.
    expect(presenceOf(new Date(NOW.getTime() + 30_000), NOW)).toBe("online");
  });

  it("accepts an ISO string, which is what JSON delivers", () => {
    expect(presenceOf(ago(1_000).toISOString(), NOW)).toBe("online");
    expect(presenceOf(ago(RECENT_MS).toISOString(), NOW)).toBe("away");
  });
});

describe("describePresence", () => {
  it("says someone is here without a number attached", () => {
    expect(describePresence(ago(10_000), NOW)).toBe("here now");
  });

  it("rounds the first couple of minutes to 'just now'", () => {
    expect(describePresence(ago(ONLINE_MS + 1_000), NOW)).toBe("just now");
  });

  it("counts minutes while still recent", () => {
    expect(describePresence(ago(9 * 60_000), NOW)).toBe("9m ago");
  });

  it("switches to hours, then days", () => {
    expect(describePresence(ago(3 * 60 * 60_000), NOW)).toBe("3h ago");
    expect(describePresence(ago(26 * 60 * 60_000), NOW)).toBe("yesterday");
    expect(describePresence(ago(3 * 24 * 60 * 60_000), NOW)).toBe("3d ago");
  });

  it("names a member who has never arrived rather than reporting an age", () => {
    expect(describePresence(null, NOW)).toBe("not yet joined");
  });
});

describe("countOnline", () => {
  it("counts only the ones actually here", () => {
    const members = [
      { lastActiveAt: ago(1_000) },
      { lastActiveAt: ago(5_000) },
      { lastActiveAt: ago(RECENT_MS - 1) },
      { lastActiveAt: null },
    ];
    expect(countOnline(members, NOW)).toBe(2);
  });

  it("is zero for an empty table", () => {
    expect(countOnline([], NOW)).toBe(0);
  });
});
