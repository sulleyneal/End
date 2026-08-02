"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { type GameEvent, useEventStream } from "@/lib/useEventStream";
import { Button, ErrorNote, inputClass } from "@/components/ui";
import { DiceLog } from "@/components/DiceLog";
import { PartyPanel } from "@/components/PartyPanel";
import { LogEntry, type Entry } from "@/components/LogEntry";
import { CombatPanel } from "@/components/CombatPanel";
import { BattleMap } from "@/components/BattleMap";
import { Journal } from "@/components/Journal";
import { ChatPanel, type ChatMessage } from "@/components/ChatPanel";
import { DiceTray } from "@/components/DiceTray";
import type { Encounter } from "@/components/combat-types";

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
  hasPortrait?: boolean;
  hitDiceRemaining?: number;
  items?: { itemIndex: string; name: string; quantity: number; equipped: boolean }[];
  slots?: { level: number; max: number; used: number }[];
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
  encounter: Encounter | null;
  cursor: number;
};

export default function PlayScreen({ campaignId }: { campaignId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const [thinking, setThinking] = useState(false);
  const [tab, setTab] = useState<
    "story" | "combat" | "chat" | "party" | "dice" | "journal"
  >("story");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [tray, setTray] = useState<Roll | null>(null);
  const [missed, setMissed] = useState<{ summary: string; count: number } | null>(null);
  const [unreadChat, setUnreadChat] = useState(0);
  const bottom = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set<string>());

  /** Reloads sheets and rolls; cheap enough to run on any state-changing event. */
  const refreshSide = useCallback(async () => {
    try {
      const next = await api<State>(`/api/campaigns/${campaignId}/state`);
      setState((prev) => (prev ? { ...prev, characters: next.characters, encounter: next.encounter } : next));
      setRolls((prev) => {
        // Animate whatever is new since the last refresh. The faces were rolled
        // and persisted server-side; the tray only replays them.
        const known = new Set(prev.map((r) => r.id));
        const fresh = next.rolls.filter((r) => !known.has(r.id) && r.dice.length > 0);
        const latest = fresh[fresh.length - 1];
        if (latest && prev.length > 0) setTray(latest);
        return next.rolls;
      });
    } catch {
      // A failed side-refresh should not disturb the story log.
    }
  }, [campaignId]);

  useEffect(() => {
    api<State>(`/api/campaigns/${campaignId}/state`)
      .then((s) => {
        setState(s);
        for (const m of s.messages) seen.current.add(m.id);
        // Table chat has its own panel; the story stays narrative-only.
        setEntries(s.messages.filter((m) => m.kind !== "ooc"));
        setChat(
          s.messages
            .filter((m) => m.kind === "ooc")
            .map((m) => ({
              id: m.id,
              authorName: m.authorName,
              content: m.content,
              createdAt: m.createdAt,
            })),
        );
        setRolls(s.rolls);
      })
      .catch((e: Error) => setError(e.message));
  }, [campaignId]);

  useEffect(() => {
    api<{ missed: { summary: string; count: number } | null }>(
      `/api/campaigns/${campaignId}/catchup`,
    )
      .then((r) => setMissed(r.missed))
      .catch(() => {
        // Missing a catch-up is not worth interrupting the table for.
      });
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

        if (p.kind === "ooc") {
          setChat((prev) => [
            ...prev,
            {
              id: p.messageId,
              authorName: p.authorName,
              content: p.content,
              createdAt: event.createdAt,
            },
          ]);
          setUnreadChat((n) => n + 1);
          return;
        }

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
  const myCharacterIds = state.characters
    .filter((c) => c.userId === state.me.id)
    .map((c) => c.id);

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

      {/* Mobile tabs; on wide screens everything is visible at once. Combat only
          appears while there is an encounter to act in. */}
      <nav className="mb-3 flex gap-1 lg:hidden">
        {(state.encounter
          ? (["story", "combat", "chat", "party", "dice", "journal"] as const)
          : (["story", "chat", "party", "dice", "journal"] as const)
        ).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (t === "chat") setUnreadChat(0);
            }}
            className={`relative flex-1 rounded-lg px-2 py-2 text-xs font-medium capitalize transition sm:text-sm ${
              tab === t
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--surface-2)] text-[var(--muted)]"
            }`}
          >
            {t}
            {t === "chat" && unreadChat > 0 && tab !== "chat" && (
              <span
                data-testid="chat-unread"
                className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold text-white"
              >
                {unreadChat}
              </span>
            )}
          </button>
        ))}
      </nav>

      {missed && (
        <aside
          data-testid="catchup"
          className="mb-3 rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">While you were away</h2>
              <p className="mt-1 text-sm leading-relaxed">{missed.summary}</p>
            </div>
            <button
              type="button"
              onClick={() => setMissed(null)}
              aria-label="Dismiss catch-up"
              className="shrink-0 rounded-lg px-2 py-1 text-sm text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              ✕
            </button>
          </div>
        </aside>
      )}

      {tray && (
        <DiceTray
          dice={tray.dice}
          total={tray.total}
          label={tray.actorName}
          onDone={() => setTray(null)}
        />
      )}

      <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_20rem]">
        <section className={`flex min-h-0 flex-col ${tab === "story" ? "" : "hidden lg:flex"}`}>
          {state.encounter?.map && (
            <div className="mb-3">
              <BattleMap
                encounter={state.encounter}
                myCharacterIds={myCharacterIds}
                canCommandAll={state.me.role === "co_dm"}
                onChanged={() => void refreshSide()}
              />
            </div>
          )}
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
          {state.encounter && (
            <div
              className={
                tab === "party" || tab === "dice" || tab === "journal" || tab === "chat" ? "hidden lg:block" : ""
              }
            >
              <CombatPanel
                encounter={state.encounter}
                myCharacterIds={myCharacterIds}
                canCommandAll={state.me.role === "co_dm"}
                onChanged={() => void refreshSide()}
              />
            </div>
          )}
          <div
            className={
              tab === "dice" || tab === "combat" || tab === "journal" || tab === "chat" ? "hidden lg:block" : ""
            }
          >
            <PartyPanel
              characters={state.characters}
              meId={state.me.id}
              onChanged={() => void refreshSide()}
            />
          </div>
          <div
            className={
              tab === "party" || tab === "combat" || tab === "journal" || tab === "chat" ? "hidden lg:block" : ""
            }
          >
            <DiceLog rolls={rolls} />
          </div>
          <div className={tab === "chat" ? "" : "hidden lg:block"}>
            <ChatPanel
              campaignId={campaignId}
              messages={chat}
              meName={state.me.displayName}
              onSent={(message) => {
                seen.current.add(message.id);
                setChat((prev) => [...prev, message]);
              }}
            />
          </div>
          <div className={tab === "journal" ? "" : "hidden lg:block"}>
            <Journal
              campaignId={campaignId}
              canEndSession={state.me.role === "co_dm"}
              onEnded={() => void refreshSide()}
            />
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
