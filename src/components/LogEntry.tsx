"use client";

export type Entry = {
  id: string;
  authorType: "player" | "dm" | "system";
  authorName: string;
  kind: string;
  content: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
};

/**
 * One line of the story.
 *
 * A DM ruling gets its own visually distinct card (house rule 2), so players can
 * always tell the difference between "the rules did this" and "the DM decided
 * this" without reading carefully.
 */
export function LogEntry({ entry }: { entry: Entry }) {
  if (entry.kind === "ruling") {
    const question = entry.metadata?.question as string | undefined;
    const mechanic = entry.metadata?.mechanic as string | undefined;
    return (
      <div className="rounded-xl border-l-4 border-[var(--ruling)] bg-[var(--ruling-soft)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ruling)]">
          DM ruling
        </p>
        {question && <p className="mt-1 text-sm font-medium">{question}</p>}
        <p className="mt-2 whitespace-pre-wrap leading-relaxed">{entry.content}</p>
        {mechanic && (
          <p className="mt-2 text-sm text-[var(--muted)]">
            Resolved as: <span className="font-medium">{mechanic}</span>
          </p>
        )}
      </div>
    );
  }

  if (entry.kind === "system") {
    return (
      <p className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--muted)] tabular">
        {entry.content}
      </p>
    );
  }

  if (entry.kind === "dialogue") {
    return (
      <div className="pl-3 border-l-2 border-[var(--border)]">
        <p className="text-sm font-semibold">{entry.authorName}</p>
        <p className="whitespace-pre-wrap leading-relaxed italic">“{entry.content}”</p>
      </div>
    );
  }

  if (entry.authorType === "player") {
    return (
      <div className="rounded-xl bg-[var(--accent-soft)] px-4 py-3">
        <p className="text-xs font-semibold text-[var(--accent)]">
          {entry.authorName}
          {entry.kind === "ooc" && " (out of character)"}
        </p>
        <p className="mt-1 whitespace-pre-wrap leading-relaxed">{entry.content}</p>
      </div>
    );
  }

  return <p className="whitespace-pre-wrap leading-relaxed">{entry.content}</p>;
}
