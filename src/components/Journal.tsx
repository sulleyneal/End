"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, ErrorNote } from "@/components/ui";

/**
 * The campaign journal.
 *
 * Sessions in reverse order, newest first, so the thing a returning player
 * needs — what did I miss — is the first thing on screen.
 */

type Session = {
  number: number;
  startedAt: string;
  endedAt: string | null;
  recap: string | null;
  highlights: string[];
};

export function Journal({
  campaignId,
  canEndSession,
  onEnded,
}: {
  campaignId: string;
  canEndSession: boolean;
  onEnded?: () => void;
}) {
  const [journal, setJournal] = useState<Session[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<{ journal: Session[] }>(`/api/campaigns/${campaignId}/session`);
      setJournal(data.journal);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  const endSession = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/campaigns/${campaignId}/session`, { method: "POST" });
      await load();
      onEnded?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const completed = (journal ?? []).filter((s) => s.recap);

  return (
    <section
      data-testid="journal"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <h2 className="font-semibold">Journal</h2>
        {canEndSession && (
          <Button variant="secondary" disabled={busy} onClick={() => void endSession()}>
            {busy ? "Writing…" : "End session"}
          </Button>
        )}
      </header>

      <div className="space-y-4 p-4">
        <ErrorNote>{error}</ErrorNote>

        {journal === null && <p className="text-sm text-[var(--muted)]">Loading…</p>}

        {journal !== null && completed.length === 0 && (
          <p className="text-sm text-[var(--muted)]">
            No sessions written up yet. When the group stops for the night, the DM writes a recap
            here.
          </p>
        )}

        {completed.map((session) => (
          <article key={session.number} data-testid="journal-entry" className="space-y-2">
            <h3 className="text-sm font-semibold">
              Session {session.number}
              {session.endedAt && (
                <span className="ml-2 font-normal text-[var(--muted)]">
                  {new Date(session.endedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
            </h3>

            {session.highlights.length > 0 && (
              <ul className="space-y-1">
                {session.highlights.map((h, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span aria-hidden className="text-[var(--muted)]">
                      •
                    </span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            )}

            {session.recap && (
              <div className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
                {session.recap.split("\n\n").map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
