/**
 * When a scrolling log should jump to the newest entry, and when it must not.
 *
 * A story log is read from the bottom. Opening the app should put you at the
 * latest thing that happened, not at the first sentence of a campaign you
 * started three weeks ago — but the moment a player scrolls up to re-read what
 * an NPC said, yanking them back down is worse than not scrolling at all.
 *
 * Kept pure and tested because the failure is silent: nothing throws, the log
 * is simply in the wrong place, and that is only noticed by a person holding a
 * phone.
 */

export type ScrollBox = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/** How far from the bottom still counts as "reading the newest entry". */
export const STICK_THRESHOLD_PX = 80;

export function distanceFromBottom(box: ScrollBox): number {
  return box.scrollHeight - box.scrollTop - box.clientHeight;
}

export function isNearBottom(box: ScrollBox, threshold = STICK_THRESHOLD_PX): boolean {
  return distanceFromBottom(box) <= threshold;
}

/**
 * Whether this element scrolls its own content, or the page scrolls around it.
 *
 * The story log carries `overflow-y-auto`, but on a phone nothing constrains
 * its height, so it grows to fit the whole campaign and the document is what
 * actually scrolls. Scrolling the log in that state moves nothing at all —
 * which is precisely the bug this module exists to fix — so the caller has to
 * ask before deciding what to move.
 */
export function scrollsItself(box: ScrollBox): boolean {
  return box.scrollHeight > box.clientHeight + 1;
}

export type ScrollMove = "jump" | "smooth" | "stay";

export type ViewState = {
  /** Whether the log currently has a box on screen at all. */
  visible: boolean;
  /** Whether it had one last time we looked. */
  wasVisible: boolean;
  /** Whether we have already parked this log at the bottom with real content. */
  placed: boolean;
  /** Whether the reader is at the newest entry rather than somewhere above it. */
  following: boolean;
};

/**
 * The tab bar hides panels with `display: none` rather than unmounting them,
 * and a hidden scroll container loses its scroll position — it comes back at
 * the top. So becoming visible again has to re-park the view, and it has to do
 * it without animation: smooth-scrolling the length of a whole campaign is a
 * visible slide through hours of someone else's turns.
 */
export function decideScroll(view: ViewState): ScrollMove {
  if (!view.visible) return "stay";
  // First paint, or back from hidden with the scroll position reset under us.
  if (!view.wasVisible) return "jump";
  // The first real batch of entries: land at the bottom, do not travel there.
  if (!view.placed) return "jump";
  // They went up to re-read something. Leave them alone.
  if (!view.following) return "stay";
  return "smooth";
}
