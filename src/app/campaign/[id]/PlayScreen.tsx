"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { type GameEvent, useEventStream } from "@/lib/useEventStream";
import { Button, ErrorNote, inputClass } from "@/components/ui";
import { DiceLog } from "@/components/DiceLog";
import { PartyPanel } from "@/components/PartyPanel";
import { LogEntry, type Entry } from "@/components/LogEntry";

type Roll = {
  id: string;
  actorName: string;
  kind: string;
  formula: string;
  dice: { sides: number; value: number; kept: boolean }[];
  modifier: number;
  advantage: string;
  total: number;
  dc: number | null;
  outcome: string | null;
};

type Sheet = {
  id: string;
  name: string;
  userId: string | null;
  level: number;
  hpCurrent: number;
  hpMax: number;
  tempHp: number;
  conditions: string[];
  labels: { race: string; class: string; subrace: string | null };
  derived: {
    armorClass: { value: number };
    initiative: number;
    speed: { effective: number };
    passive: { perception: number };
  };
};

type State = {
  me: { id: string; displayName: string; role: string };
  campaign: { id: string; name: string; joinCode: string; genre: string | null };
  messages: Entry[];
  rolls: Roll[];
  characters: Sheet[];
  encounter: { name: string; round: number; activeCombatantId: string | null } | null;
  cursor: number;
};

export default function PlayScreen({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const [thinking, setThinking] = useState(false);
  const [tab, setTab] = useState<"story" | "party" | "dice">("story");
  const bottom = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());

  /** Reloads sheets and rolls; cheap enough to run on any state-changing event. */
  const refreshSide = useCallback(async () => {
    try {
      const next = await api<State>(`/api/campaigns/${campaignId}/state`);
      setState((prev) => (prev ? { ...prev, characters: next.characters, encounter: next.encounter } : next));
      setRolls(next.rolls);
    } catch {
      // A failed side-refresh should not disturb the story log.
    }
  }, [campaignId]);

  useEffect(() => {
    api<State>(`/api/campaigns/${campaignId}/state`)
      .then((s) => {
        setState(s);
        for (const m of s.messages) seen.current.add(m.id);
        setEntries(s.messages);
        setRolls(s.rolls);
      })
      .catch((e: Error) => setError(e.message));
  }, [campaignId]);

  const onEvent = useCallback(
    (event: GameEvent) => {
      if (event.type === "dm.thinking") {
        setThinking(true);
        return;
      }

      if (event.type === "message") {
        const p = event.payload as unknown as Entry & { messageId: string };
        // The player who submitted already rendered this optimistically.
        if (seen.current.has(p.messageId)) return;
        seen.current.add(p.messageId);
        setThinking(false);
        setEntries((prev) => [
          ...prev,
          {
            id: p.messageId,
            authorType: p.authorType,
            authorName: p.authorName,
            kind: p.kind,
            content: p.content,
            metadata: p.metadata,
            createdAt: event.createdAt,
          },
        ]);
        return;
      }

      // Anything that can move a hit point, a token or a turn refreshes the panels.
      if (
        event.type.startsWith("combatant.") ||
        event.type.startsWith("character.") ||
        event.type.startsWith("encounter.") ||
        event.type === "turn.changed" ||
        event.type === "token.moved"
      ) {
        void refreshSide();
      }
    },
    [refreshSide],
  );

  const { status } = useEventStream(campaignId, onEvent, { since: state?.cursor });

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length, thinking]);

  const submit = async () => {
    const text = action.trim();
    if (!text || thinking) return;
    setAction("");
    setThinking(true);
    setError("");
    try {
      const result = await api<{ entries: { kind: string; author: string; content: string }[] }>(
        `/api/campaigns/${campaignId}/dm`,
        { method: "POST", json: { action: text } },
      );
      // The stream delivers these too; whichever arrives first wins, and the
      // messageId set stops the other from double-rendering.
      void result;
      await refreshSide();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setThinking(false);
    }
  };

  if (error && !state) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <ErrorNote>{error}</ErrorNote>
        <p className="mt-4">
          <Link href="/" className="underline">
            Back to your tables
          </Link>
        </p>
      </main>
    );
  }

  if (!state) {
    return <main className="mx-auto w-full max-w-2xl px-4 py-10 text-[var(--muted)]">Loading…</main>;
  }

  const myCharacter = state.characters.find((c) => c.userId === state.me.id);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-4 lg:py-8">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/" className="text-sm text-[var(--muted)] hover:underline">
            ← Tables
          </Link>
          <h1 className="text-xl font-semibold">{state.campaign.name}</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[var(--muted)]">
            Code <span className="font-semibold tracking-wider tabular">{state.campaign.joinCode}</span>
          </span>
          <StreamBadge status={status} />
        </div>
      </header>

      {state.encounter && (
        <div className="mb-3 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-2 text-sm">
          <strong>{state.encounter.name}</strong> — round {state.encounter.round}
        </div>
      )}

      {/* Mobile tabs; on wide screens everything is visible at once. */}
      <nav className="mb-3 flex gap-1 lg:hidden">
        {(["story", "party", "dice"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium capitalize transition ${
              tab === t
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface-2)] text-[var(--muted)]"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <section className={`flex min-h-0 flex-col ${tab === "story" ? "" : "hidden lg:flex"}`}>
          <div
            data-testid="story-log"
            className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            {entries.length === 0 && (
              <p className="text-[var(--muted)]">
                The table is quiet. Describe what your character does to begin.
              </p>
            )}
            {entries.map((entry) => (
              <LogEntry key={entry.id} entry={entry} />
            ))}
            {thinking && (
              <p className="animate-pulse text-sm text-[var(--muted)]">The DM is thinking…</p>
            )}
            <div ref={bottom} />
          </div>

          <div className="mt-3">
            {myCharacter ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <input
                  className={inputClass}
                  placeholder={`What does ${myCharacter.name} do?`}
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  disabled={thinking}
                />
                <Button type="submit" disabled={thinking || action.trim().length === 0}>
                  Act
                </Button>
              </form>
            ) : (
              <Link
                href={`/campaign/${campaignId}/new-character`}
                className="block rounded-lg bg-[var(--accent)] px-4 py-3 text-center text-sm font-medium text-white"
              >
                Make a character to join the story
              </Link>
            )}
            <ErrorNote>{error}</ErrorNote>
          </div>
        </section>

        <aside className={`space-y-4 ${tab === "story" ? "hidden lg:block" : ""}`}>
          <div className={tab === "dice" ? "hidden lg:block" : ""}>
            <PartyPanel characters={state.characters} meId={state.me.id} />
          </div>
          <div className={tab === "party" ? "hidden lg:block" : ""}>
            <DiceLog rolls={rolls} />
          </div>
        </aside>
      </div>
    </main>
  );
}

function StreamBadge({ status }: { status: string }) {
  const label = { live: "Live", connecting: "Connecting", reconnecting: "Reconnecting" }[status];
  const colour = status === "live" ? "var(--success)" : "var(--muted)";
  return (
    <span className="flex items-center gap-1.5 text-[var(--muted)]">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ background: colour }}
        aria-hidden
      />
      {label}
    </span>
  );
}
