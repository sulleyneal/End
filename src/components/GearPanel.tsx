"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { ErrorNote } from "@/components/ui";

/**
 * What your character is holding and wearing.
 *
 * Attacks derive only from equipped weapons, and the builder draws the first
 * melee weapon in the kit — so a rogue who chose a rapier could end up swinging
 * a 1d4 dagger with the rapier still in the pack and no way to swap. There was
 * an equip route from the start; there was simply no control that reached it.
 */

export type GearItem = {
  itemIndex: string;
  name: string;
  quantity: number;
  equipped: boolean;
};

export function GearPanel({
  characterId,
  items,
  onChanged,
}: {
  characterId: string;
  items: GearItem[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const toggle = async (item: GearItem) => {
    setBusy(item.itemIndex);
    setError("");
    try {
      await api(`/api/characters/${characterId}`, {
        method: "PATCH",
        json: { equip: { itemIndex: item.itemIndex, equipped: !item.equipped } },
      });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0) return null;

  const held = items.filter((i) => i.equipped);
  const packed = items.filter((i) => !i.equipped);

  return (
    <section
      data-testid="gear-panel"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        Gear
      </h2>

      <p className="mb-2 text-xs text-[var(--muted)]">
        Only what you are holding or wearing gives you attacks and armour class.
      </p>

      <ul className="space-y-1">
        {[...held, ...packed].map((item) => (
          <li key={item.itemIndex}>
            <button
              type="button"
              data-testid="gear-toggle"
              disabled={busy !== null}
              onClick={() => void toggle(item)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition disabled:opacity-40 ${
                item.equipped
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)]"
              }`}
            >
              <span className="truncate">
                {item.name}
                {item.quantity > 1 && (
                  <span className="ml-1 text-[var(--muted)]">×{item.quantity}</span>
                )}
              </span>
              <span className="shrink-0 text-xs text-[var(--muted)]">
                {busy === item.itemIndex ? "…" : item.equipped ? "held" : "packed"}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}
