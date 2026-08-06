import type { Presence } from "@/lib/presence";

/**
 * Who gets interrupted, and who does not.
 *
 * This is the whole design of a notification system. A channel that fires too
 * often gets muted, and a muted channel takes the useful alerts down with it —
 * so the rules that suppress a notification matter more than the ones that send
 * it. They are pure here, and tested, because getting them wrong is not a
 * crash; it is everyone quietly turning notifications off a week later.
 */

export type NotifyReason = "turn" | "dm" | "chat" | "ping";

export type Candidate = {
  userId: string;
  presence: Presence;
  notifyOnTurn: boolean;
  notifyOnDm: boolean;
  notifyOnChat: boolean;
  notifyOnPing: boolean;
};

const PREF: Record<NotifyReason, keyof Candidate> = {
  turn: "notifyOnTurn",
  dm: "notifyOnDm",
  chat: "notifyOnChat",
  ping: "notifyOnPing",
};

export type SelectOptions = {
  reason: NotifyReason;
  /** Restrict to specific people — an async turn belongs to one player. */
  targetUserIds?: string[];
  /** Whoever caused the event; never notified about their own action. */
  actorUserId?: string;
};

/**
 * A manual ping ignores presence; everything automatic respects it.
 *
 * If the app is open in front of you, an automatic alert tells you something
 * you can already see. A ping is different: somebody deliberately asked for
 * your attention, and "online" only means a tab is connected — it may well be
 * backgrounded on a phone in a pocket, which is exactly when a poke is wanted.
 */
export function selectRecipients(
  candidates: Candidate[],
  options: SelectOptions,
): string[] {
  const { reason, targetUserIds, actorUserId } = options;
  const manual = reason === "ping";

  return candidates
    .filter((c) => {
      if (actorUserId && c.userId === actorUserId) return false;
      if (targetUserIds && !targetUserIds.includes(c.userId)) return false;
      if (!c[PREF[reason]]) return false;
      if (!manual && c.presence === "online") return false;
      return true;
    })
    .map((c) => c.userId);
}

/** How long between manual pings from one person, so a poke cannot be a hammer. */
export const PING_COOLDOWN_MS = 5 * 60_000;

export function pingAllowed(lastPingedAt: Date | string | null, now: Date): boolean {
  if (!lastPingedAt) return true;
  const last = lastPingedAt instanceof Date ? lastPingedAt : new Date(lastPingedAt);
  return now.getTime() - last.getTime() >= PING_COOLDOWN_MS;
}

/** Seconds a caller must wait before pinging again; 0 when they may go now. */
export function pingCooldownRemaining(
  lastPingedAt: Date | string | null,
  now: Date,
): number {
  if (!lastPingedAt) return 0;
  const last = lastPingedAt instanceof Date ? lastPingedAt : new Date(lastPingedAt);
  const remaining = PING_COOLDOWN_MS - (now.getTime() - last.getTime());
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}
