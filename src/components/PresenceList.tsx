"use client";

import { describePresence } from "@/lib/presence";
import type { PresentMember } from "@/lib/usePresence";

const DOT: Record<string, string> = {
  online: "var(--success)",
  recent: "var(--ruling)",
  away: "var(--muted)",
};

/**
 * A dot for one member's presence.
 *
 * Colour is never the only carrier — every dot is paired with words somewhere
 * it appears, and carries its own `title`, so the indicator still works for a
 * colour-blind player.
 */
export function PresenceDot({ presence, label }: { presence: string; label?: string }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: DOT[presence] ?? DOT.away }}
      title={label}
      aria-label={label}
      role={label ? "img" : undefined}
    />
  );
}

/**
 * The compact "am I alone here?" readout for the header.
 *
 * This is the question the indicator exists to answer, so it is phrased as an
 * answer rather than a statistic: a lone player reads "just you", not "1".
 */
export function PresencePill({ onlineCount }: { onlineCount: number }) {
  const alone = onlineCount <= 1;
  return (
    <span
      data-testid="presence-pill"
      className="flex items-center gap-1.5 text-[var(--muted)]"
    >
      <PresenceDot presence={alone ? "away" : "online"} />
      {onlineCount === 0 ? "Nobody here" : alone ? "Just you" : `${onlineCount} here`}
    </span>
  );
}

/** The full roster, so you can see who is around and who is merely nearby. */
export function PresenceList({ members }: { members: PresentMember[] }) {
  if (members.length === 0) return null;
  const now = new Date();

  return (
    <section
      data-testid="presence-list"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        At the table
      </h2>
      <ul className="space-y-2">
        {members.map((m) => {
          const when = describePresence(m.lastActiveAt, now);
          return (
            <li key={m.userId} className="flex items-center gap-2 text-sm">
              <PresenceDot presence={m.presence} label={when} />
              <span className={m.presence === "away" ? "text-[var(--muted)]" : ""}>
                {m.displayName}
                {m.characterName && (
                  <span className="text-[var(--muted)]"> · {m.characterName}</span>
                )}
              </span>
              <span className="ml-auto shrink-0 text-xs text-[var(--muted)]">{when}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
