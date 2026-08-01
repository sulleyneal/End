"use client";

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

/** Every number here is derived server-side on read — nothing is cached in the client. */
export function PartyPanel({ characters, meId }: { characters: Sheet[]; meId: string }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        Party
      </h2>
      {characters.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nobody has made a character yet.</p>
      ) : (
        <ul className="space-y-3">
          {characters.map((c) => {
            const pct = Math.max(0, Math.min(100, (c.hpCurrent / Math.max(1, c.hpMax)) * 100));
            const bar = pct > 50 ? "var(--success)" : pct > 20 ? "var(--ruling)" : "var(--danger)";
            return (
              <li key={c.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {c.name}
                    {c.userId === meId && (
                      <span className="ml-1.5 text-xs text-[var(--accent)]">you</span>
                    )}
                  </span>
                  <span className="text-xs text-[var(--muted)] tabular">
                    AC {c.derived.armorClass.value}
                  </span>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Level {c.level} {c.labels.subrace ?? c.labels.race} {c.labels.class}
                </p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <div
                    className="h-full rounded-full transition-[width]"
                    style={{ width: `${pct}%`, background: bar }}
                  />
                </div>
                <p className="mt-1 text-xs text-[var(--muted)] tabular">
                  {c.hpCurrent}/{c.hpMax} HP
                  {c.tempHp > 0 && ` (+${c.tempHp} temp)`} · passive Perception{" "}
                  {c.derived.passive.perception}
                </p>
                {c.conditions.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {c.conditions.map((cond) => (
                      <span
                        key={cond}
                        className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-xs capitalize text-[var(--danger)]"
                      >
                        {cond}
                      </span>
                    ))}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
