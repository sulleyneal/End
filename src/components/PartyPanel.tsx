"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { ErrorNote } from "@/components/ui";
import { PortraitUpload } from "@/components/PortraitUpload";

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
  slots?: { level: number; max: number; used: number }[];
  labels: { race: string; class: string; subrace: string | null };
  derived: {
    armorClass: { value: number };
    initiative: number;
    speed: { effective: number };
    passive: { perception: number };
  };
};

/** Every number here is derived server-side on read — nothing is cached in the client. */
export function PartyPanel({
  characters,
  meId,
  onChanged,
}: {
  characters: Sheet[];
  meId: string;
  onChanged?: () => void;
}) {
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
            const isMine = c.userId === meId;
            return (
              <li key={c.id}>
                {isMine ? (
                  <div className="mb-2">
                    <PortraitUpload
                      characterId={c.id}
                      name={c.name}
                      hasPortrait={c.hasPortrait ?? false}
                    />
                  </div>
                ) : (
                  c.hasPortrait && (
                    <div className="mb-2 flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/characters/${c.id}/portrait`}
                        alt={`${c.name}'s portrait`}
                        className="h-12 w-12 rounded-full border border-[var(--border)] object-cover"
                      />
                    </div>
                  )
                )}
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
                {isMine && <RestControls sheet={c} onChanged={onChanged} />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}


/**
 * Short and long rest.
 *
 * The engine for both was written and tested from the start with no caller, so
 * a party had exactly one fight in them and then the campaign was over. Hit
 * dice roll server-side like every other die.
 */
function RestControls({ sheet, onChanged }: { sheet: Sheet; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const hurt = sheet.hpCurrent < sheet.hpMax;
  const dice = sheet.hitDiceRemaining ?? 0;
  const spentSlots = (sheet.slots ?? []).some((s) => s.used > 0);
  const down = sheet.hpCurrent === 0;

  const rest = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/characters/${sheet.id}/rest`, { method: "POST", json: body });
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="short-rest"
          disabled={busy || down || dice === 0 || !hurt}
          title={
            down
              ? "Unconscious characters cannot rest"
              : dice === 0
                ? "No hit dice left"
                : !hurt
                  ? "Already at full hit points"
                  : `Spend one of ${dice} hit dice`
          }
          onClick={() => void rest({ type: "short", hitDice: 1 })}
          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Short rest
        </button>
        <button
          type="button"
          data-testid="long-rest"
          disabled={busy || down || (!hurt && !spentSlots && sheet.conditions.length === 0)}
          onClick={() => void rest({ type: "long" })}
          className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Long rest
        </button>
        <span className="text-[10px] text-[var(--muted)] tabular">
          {dice} hit {dice === 1 ? "die" : "dice"}
        </span>
      </div>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
