import { describe, expect, it } from "vitest";
import {
  decideScroll,
  distanceFromBottom,
  isNearBottom,
  scrollsItself,
  STICK_THRESHOLD_PX,
  type ViewState,
} from "./stick-to-bottom";

const box = (scrollTop: number, scrollHeight = 1000, clientHeight = 400) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});

const view = (over: Partial<ViewState> = {}): ViewState => ({
  visible: true,
  wasVisible: true,
  placed: true,
  following: true,
  ...over,
});

describe("distanceFromBottom", () => {
  it("is zero when scrolled fully down", () => {
    expect(distanceFromBottom(box(600))).toBe(0);
  });

  it("is the whole scrollable height at the top", () => {
    expect(distanceFromBottom(box(0))).toBe(600);
  });

  it("is zero when the content does not overflow", () => {
    expect(distanceFromBottom(box(0, 400, 400))).toBe(0);
  });
});

describe("isNearBottom", () => {
  it("counts the exact bottom", () => {
    expect(isNearBottom(box(600))).toBe(true);
  });

  it("counts a small gap, so a stray pixel does not stop the log following", () => {
    expect(isNearBottom(box(600 - (STICK_THRESHOLD_PX - 1)))).toBe(true);
  });

  it("includes the threshold itself", () => {
    expect(isNearBottom(box(600 - STICK_THRESHOLD_PX))).toBe(true);
  });

  it("stops counting past the threshold", () => {
    expect(isNearBottom(box(600 - (STICK_THRESHOLD_PX + 1)))).toBe(false);
  });

  it("is false when scrolled up to re-read", () => {
    expect(isNearBottom(box(0))).toBe(false);
  });

  it("treats a non-overflowing log as at the bottom", () => {
    expect(isNearBottom(box(0, 400, 400))).toBe(true);
  });

  it("honours a caller's own threshold", () => {
    expect(isNearBottom(box(300), 0)).toBe(false);
    expect(isNearBottom(box(300), 300)).toBe(true);
  });
});

describe("scrollsItself", () => {
  it("is true when the content overflows the box", () => {
    expect(scrollsItself(box(0))).toBe(true);
  });

  it("is false when the box grew to fit its content", () => {
    // The story log on a phone: overflow-y-auto, but nothing caps its height,
    // so the document scrolls instead and scrolling the log moves nothing.
    expect(scrollsItself(box(0, 4000, 4000))).toBe(false);
  });

  it("ignores a sub-pixel rounding difference", () => {
    expect(scrollsItself(box(0, 4001, 4000))).toBe(false);
  });
});

describe("decideScroll", () => {
  it("does nothing while the panel is hidden", () => {
    expect(decideScroll(view({ visible: false }))).toBe("stay");
  });

  it("does nothing while hidden even if new entries arrived", () => {
    expect(decideScroll(view({ visible: false, placed: false, following: true }))).toBe("stay");
  });

  it("jumps on first paint", () => {
    expect(decideScroll(view({ wasVisible: false, placed: false }))).toBe("jump");
  });

  it("jumps when a hidden panel becomes visible again", () => {
    // The reported bug: switching to chat and back left the story at the top,
    // because display:none resets the scroll position and nothing re-parked it.
    expect(decideScroll(view({ wasVisible: false }))).toBe("jump");
  });

  it("re-parks on becoming visible even if the reader had scrolled up", () => {
    // Their old position is gone either way; the bottom is the useful default.
    expect(decideScroll(view({ wasVisible: false, following: false }))).toBe("jump");
  });

  it("jumps rather than animates when the first entries load", () => {
    expect(decideScroll(view({ placed: false }))).toBe("jump");
  });

  it("animates for a new entry when the reader is at the bottom", () => {
    expect(decideScroll(view())).toBe("smooth");
  });

  it("leaves the reader alone when they have scrolled up", () => {
    expect(decideScroll(view({ following: false }))).toBe("stay");
  });

  it("never animates a panel that just appeared", () => {
    const moves = [true, false].map((following) =>
      decideScroll(view({ wasVisible: false, following })),
    );
    expect(moves).toEqual(["jump", "jump"]);
  });
});
