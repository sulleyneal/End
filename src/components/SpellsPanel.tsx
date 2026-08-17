"use client";

import { useState } from "react";

/**
 * A caster's spells, on the sheet rather than only in combat.
 *
 * They used to live solely in the combat panel, which exists only while an
 * encounter is running — so between fights a player had nowhere to look up what
 * their character could actually do. This is the reference view: what you know,
 * what it costs, what it does. Casting still happens in combat, where the
 * server can enforce slots, targets and range.
 */

export type SheetSpell = {
  spellIndex: string;
  prepared: boolean;
  alwaysPrepared: boolean;
  name: string;
  level: number;
  school: string | null;
  castingTime: string | null;
  range: string | null;
  duration: string | null;
  concentration: boolean;
  ritual: boolean;
  description: string | null;
};

export type SpellSlot = { level: number; max: number; used: number };

const levelLabel = (level: number) =>
  level === 0 ? "Cantrips" : `Level ${level}`;

export function SpellsPanel({
  spells,
  slots,
  spellcasting,
}: {
  spells: SheetSpell[];
  slots: SpellSlot[];
  spellcasting: { saveDc: number; attackBonus: number; ability: string } | null;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (!spellcasting && spells.length === 0) return null;

  const byLevel = new Map<number, SheetSpell[]>();
  for (const spell of spells) {
    byLevel.set(spell.level, [...(byLevel.get(spell.level) ?? []), spell]);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  return (
    <section
      data-testid="spells-panel"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        Spells
      </h2>

      {spellcasting && (
        <dl className="mb-3 grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Save DC", value: spellcasting.saveDc },
            {
              label: "Attack",
              value:
                spellcasting.attackBonus >= 0
                  ? `+${spellcasting.attackBonus}`
                  : `${spellcasting.attackBonus}`,
            },
            { label: "Ability", value: spellcasting.ability.toUpperCase() },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg bg-[var(--surface-2)] p-2">
              <dt className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                {stat.label}
              </dt>
              <dd className="text-sm font-semibold tabular">{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {slots.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-1 text-xs font-medium text-[var(--muted)]">Slots</h3>
          <ul className="space-y-1">
            {slots.map((slot) => (
              <li key={slot.level} className="flex items-center gap-2 text-xs">
                <span className="w-12 shrink-0 text-[var(--muted)]">Lv {slot.level}</span>
                {/* Pips rather than "2/3": at a glance you want how many are
                    left, not arithmetic. */}
                <span className="flex gap-1" aria-hidden>
                  {Array.from({ length: slot.max }, (_, i) => (
                    <span
                      key={i}
                      className="inline-block h-2.5 w-2.5 rounded-full border border-[var(--border)]"
                      style={{
                        background:
                          i < slot.max - slot.used ? "var(--accent)" : "transparent",
                      }}
                    />
                  ))}
                </span>
                <span className="ml-auto text-[var(--muted)]">
                  {slot.max - slot.used} of {slot.max} left
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {spells.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No spells known yet.</p>
      ) : (
        <div className="space-y-3">
          {levels.map((level) => (
            <div key={level}>
              <h3 className="mb-1 text-xs font-medium text-[var(--muted)]">
                {levelLabel(level)}
              </h3>
              <ul className="space-y-1">
                {(byLevel.get(level) ?? []).map((spell) => {
                  const isOpen = open === spell.spellIndex;
                  return (
                    <li key={spell.spellIndex}>
                      <button
                        type="button"
                        onClick={() => setOpen(isOpen ? null : spell.spellIndex)}
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-2)]"
                      >
                        <span className="flex-1">{spell.name}</span>
                        {spell.concentration && (
                          <span
                            title="Concentration"
                            className="rounded bg-[var(--surface-2)] px-1 text-[10px] uppercase text-[var(--muted)]"
                          >
                            Conc
                          </span>
                        )}
                        {spell.ritual && (
                          <span
                            title="Ritual"
                            className="rounded bg-[var(--surface-2)] px-1 text-[10px] uppercase text-[var(--muted)]"
                          >
                            Rit
                          </span>
                        )}
                        <span aria-hidden className="text-[var(--muted)]">
                          {isOpen ? "−" : "+"}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="space-y-2 px-2 pb-2 pt-1 text-xs text-[var(--muted)]">
                          <p className="flex flex-wrap gap-x-3">
                            {spell.castingTime && <span>{spell.castingTime}</span>}
                            {spell.range && <span>Range {spell.range}</span>}
                            {spell.duration && <span>{spell.duration}</span>}
                            {spell.school && <span>{spell.school}</span>}
                          </p>
                          {spell.description && (
                            <p className="leading-relaxed whitespace-pre-line">
                              {spell.description}
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
