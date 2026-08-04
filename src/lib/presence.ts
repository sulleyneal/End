/**
 * Who is at the table right now.
 *
 * Presence is the one piece of table state that no event can announce. Every
 * other indicator in the app is driven by something happening — a roll, a
 * message, a token moving. Leaving is the absence of that, so it can only be
 * inferred from a clock: someone is here because they said so recently, and
 * away because they stopped saying so. That makes the thresholds the whole
 * design, and they are pure functions of two timestamps, so they are tested
 * rather than eyeballed against a live browser.
 */

/**
 * How long a heartbeat vouches for someone.
 *
 * Comfortably longer than the interval the stream beats at, so a single slow
 * request or a reconnect does not blink someone offline in front of the table.
 */
export const ONLINE_MS = 90_000;

/** Past this, "recently here" stops being useful and they are simply away. */
export const RECENT_MS = 30 * 60_000;

export type Presence = "online" | "recent" | "away";

export function presenceOf(lastActiveAt: Date | string | null, now: Date): Presence {
  if (!lastActiveAt) return "away";
  const last = lastActiveAt instanceof Date ? lastActiveAt : new Date(lastActiveAt);
  const elapsed = now.getTime() - last.getTime();
  // A clock skew between server and client can put the last beat slightly in
  // the future; that is still emphatically "here".
  if (elapsed < 0) return "online";
  if (elapsed < ONLINE_MS) return "online";
  if (elapsed < RECENT_MS) return "recent";
  return "away";
}

/**
 * A short human label for how long ago someone was around.
 *
 * Deliberately coarse. Presence is a glance, not a measurement, and a minute
 * counter ticking beside a player's name reads as surveillance rather than
 * "somebody else is in the lobby".
 */
export function describePresence(lastActiveAt: Date | string | null, now: Date): string {
  const state = presenceOf(lastActiveAt, now);
  if (state === "online") return "here now";
  if (!lastActiveAt) return "not yet joined";

  const last = lastActiveAt instanceof Date ? lastActiveAt : new Date(lastActiveAt);
  const minutes = Math.floor(Math.max(0, now.getTime() - last.getTime()) / 60_000);

  if (state === "recent") {
    if (minutes < 2) return "just now";
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

/** How many of a roster are here right now. */
export function countOnline(
  members: { lastActiveAt: Date | string | null }[],
  now: Date,
): number {
  return members.filter((m) => presenceOf(m.lastActiveAt, now) === "online").length;
}
