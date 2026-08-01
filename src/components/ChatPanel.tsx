"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ErrorNote, inputClass } from "@/components/ui";

/**
 * Table chat — what the players say to each other, not to the world.
 *
 * Kept out of the story log on purpose. The narrative has to stay readable for
 * someone catching up a week later, and the DM's memory and the session recap
 * both read from the story; chat belongs to the people at the table, not to the
 * campaign.
 *
 * Messages arrive over the same event stream as everything else, so a refresh
 * loses nothing and nobody has to poll.
 */

export type ChatMessage = {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
};

export function ChatPanel({
  campaignId,
  messages,
  meName,
  onSent,
}: {
  campaignId: string;
  messages: ChatMessage[];
  meName: string;
  onSent: (message: ChatMessage) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setDraft("");
    setBusy(true);
    setError("");
    try {
      const { id } = await api<{ id: string }>(`/api/campaigns/${campaignId}/chat`, {
        method: "POST",
        json: { content },
      });
      // Shown immediately; the stream echo is dropped by id so it never doubles.
      onSent({ id, authorName: meName, content, createdAt: new Date().toISOString() });
    } catch (e) {
      setError((e as Error).message);
      setDraft(content);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="chat-panel"
      className="flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <header className="border-b border-[var(--border)] px-4 py-3">
        <h2 className="font-semibold">Table chat</h2>
        <p className="text-xs text-[var(--muted)]">
          Just between the players. The DM never sees this and it stays out of the journal.
        </p>
      </header>

      <div
        data-testid="chat-log"
        className="max-h-80 min-h-32 flex-1 space-y-2 overflow-y-auto p-3 lg:max-h-96"
      >
        {messages.length === 0 && (
          <p className="text-sm text-[var(--muted)]">Nothing said yet.</p>
        )}
        {messages.map((message) => {
          const mine = message.authorName === meName;
          return (
            <div key={message.id} data-testid="chat-message" className="text-sm">
              <span className={`font-semibold ${mine ? "text-[var(--accent)]" : ""}`}>
                {message.authorName}
              </span>
              <span className="ml-2 text-[10px] text-[var(--muted)] tabular">
                {new Date(message.createdAt).toLocaleTimeString(undefined, {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      <form
        className="flex gap-2 border-t border-[var(--border)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          data-testid="chat-input"
          className={inputClass}
          placeholder="Say something to the table…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={2000}
        />
        <button
          type="submit"
          data-testid="chat-send"
          disabled={busy || draft.trim().length === 0}
          className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>

      <div className="px-3 pb-3">
        <ErrorNote>{error}</ErrorNote>
      </div>
    </section>
  );
}
