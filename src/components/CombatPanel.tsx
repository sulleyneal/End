"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button, ErrorNote } from "@/components/ui";

/**
 * The combat surface: initiative order, whose turn it is, and the buttons that
 * turn a player's intent into a server-validated action.
 *
 * Every button here posts an intent and renders whatever the server sends back.
 * No roll, damage number, or hit decision is computed on this side — the panel
 * is a remote control, not a rules engine.
 */

export type Attack = {
  name: string;
  kind: "melee" | "ranged";
  attackBonus: number;
  damageDice: string;
  damageBonus: number;
  damageType: string;
  reachFt?: number;
  rangeFt?: { normal: number; long?: number } | null;
};

export type Combatant = {
  id: string;
  characterId: string | null;
  name: string;
  side: "party" | "foe" | "neutral";
  initiative: number | null;
  hpCurrent: number;
  hpMax: number;
  tempHp: number;
  ac: number;
  speed: number;
  conditions: string[];
  movementUsed: number;
  actionUsed: boolean;
  deathSuccesses: number;
  deathFailures: number;
  stable: boolean;
  defeated: boolean;
  x: number | null;
  y: number | null;
  attacks: Attack[];
};

export type Encounter = {
  id: string;
  name: string;
  status: string;
  round: number;
  activeCombatantId: string | null;
  combatants: Combatant[];
};

type Props = {
  encounter: Encounter;
  /** Character ids belonging to the signed-in player. */
  myCharacterIds: string[];
  /** Co-DMs command every combatant, which is how the DM runs the monsters. */
  canCommandAll: boolean;
  onChanged: () => void;
};

const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

export function CombatPanel({ encounter, myCharacterIds, canCommandAll, onChanged }: Props) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const active = encounter.combatants.find((c) => c.id === encounter.activeCombatantId) ?? null;
  const mine = (c: Combatant) =>
    canCommandAll || (c.characterId !== null && myCharacterIds.includes(c.characterId));
  const isMyTurn = active !== null && mine(active);

  // Anything still standing on another side is a legal target to offer. The
  // server still validates range, reach and line of sight on every attack.
  const targets = encounter.combatants.filter(
    (c) => c.id !== active?.id && !c.defeated && c.hpCurrent > 0,
  );
  const chosenTarget = targets.find((t) => t.id === targetId) ?? targets[0] ?? null;

  const act = async (body: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/encounters/${encounter.id}/actions`, { method: "POST", json: body });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dying = active !== null && active.hpCurrent === 0 && !active.defeated && !active.stable;

  return (
    <section
      data-testid="combat-panel"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)]"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <h2 className="font-semibold">{encounter.name}</h2>
        <span className="text-sm text-[var(--muted)]">Round {encounter.round}</span>
      </header>

      {isMyTurn && (
        <p
          data-testid="turn-banner"
          className="border-b border-[var(--border)] bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium"
        >
          Your turn — {active?.name}
        </p>
      )}

      <ol className="divide-y divide-[var(--border)]">
        {encounter.combatants.map((c) => (
          <InitiativeRow
            key={c.id}
            combatant={c}
            isActive={c.id === encounter.activeCombatantId}
            isMine={mine(c)}
          />
        ))}
      </ol>

      {isMyTurn && active && (
        <div className="space-y-3 border-t border-[var(--border)] p-4">
          {dying ? (
            <DeathSavePrompt
              combatant={active}
              busy={busy}
              onRoll={() => act({ type: "death-save", combatantId: active.id })}
            />
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>
                  Movement {active.speed - active.movementUsed} / {active.speed} ft left
                </span>
                {active.actionUsed && <span>Action used</span>}
              </div>

              {targets.length > 0 && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Target</span>
                  <select
                    data-testid="target-picker"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
                    value={chosenTarget?.id ?? ""}
                    onChange={(e) => setTargetId(e.target.value)}
                  >
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — AC {t.ac}, {t.hpCurrent}/{t.hpMax} HP
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {active.attacks.length > 0 && chosenTarget && (
                <div className="grid gap-2">
                  {active.attacks.map((attack, index) => (
                    <button
                      key={`${attack.name}-${index}`}
                      data-testid="attack-button"
                      disabled={busy || active.actionUsed}
                      onClick={() =>
                        act({
                          type: "attack",
                          combatantId: active.id,
                          targetId: chosenTarget.id,
                          attackIndex: index,
                        })
                      }
                      className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-left text-sm transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="font-medium">{attack.name}</span>
                      <span className="text-xs text-[var(--muted)] tabular">
                        {signed(attack.attackBonus)} to hit · {attack.damageDice}
                        {attack.damageBonus !== 0 && signed(attack.damageBonus)} {attack.damageType}
                        {attack.kind === "ranged" && attack.rangeFt
                          ? ` · ${attack.rangeFt.normal} ft`
                          : attack.reachFt
                            ? ` · ${attack.reachFt} ft reach`
                            : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {active.attacks.length === 0 && (
                <p className="text-sm text-[var(--muted)]">
                  No weapon attacks. Describe what you do in the story box and the DM will
                  adjudicate it.
                </p>
              )}

              <Button
                variant="secondary"
                disabled={busy}
                className="w-full"
                onClick={() => act({ type: "end-turn", combatantId: active.id })}
              >
                End turn
              </Button>
            </>
          )}

          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {!isMyTurn && active && (
        <p className="border-t border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
          Waiting on <strong className="text-[var(--foreground)]">{active.name}</strong>.
        </p>
      )}
    </section>
  );
}

function InitiativeRow({
  combatant,
  isActive,
  isMine,
}: {
  combatant: Combatant;
  isActive: boolean;
  isMine: boolean;
}) {
  const down = combatant.hpCurrent === 0;
  const pct = combatant.hpMax > 0 ? Math.round((combatant.hpCurrent / combatant.hpMax) * 100) : 0;

  return (
    <li
      data-testid="initiative-row"
      data-active={isActive || undefined}
      className={`flex items-center gap-3 px-4 py-2.5 ${isActive ? "bg-[var(--accent-soft)]" : ""}`}
    >
      <span
        className="w-7 shrink-0 text-center text-sm font-semibold tabular"
        title="Initiative"
      >
        {combatant.initiative ?? "—"}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className={`truncate text-sm ${combatant.defeated ? "text-[var(--muted)] line-through" : "font-medium"}`}
          >
            {combatant.name}
          </span>
          {isMine && !combatant.defeated && (
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
              You
            </span>
          )}
        </span>

        {/* Foes show a health bar rather than exact numbers, the way a DM
            describes a wounded creature instead of reading out its hit points. */}
        {combatant.side === "party" ? (
          <span className="text-xs text-[var(--muted)] tabular">
            {combatant.hpCurrent}/{combatant.hpMax} HP
            {combatant.tempHp > 0 && ` +${combatant.tempHp}`} · AC {combatant.ac}
          </span>
        ) : (
          <span className="mt-1 block h-1 w-16 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: pct > 50 ? "var(--success)" : "var(--danger)",
              }}
            />
          </span>
        )}

        {combatant.conditions.length > 0 && (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {combatant.conditions.map((c) => (
              <span
                key={c}
                data-testid="condition-chip"
                className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--muted)]"
              >
                {c}
              </span>
            ))}
          </span>
        )}
      </span>

      {down && !combatant.defeated && (
        <DeathSavePips successes={combatant.deathSuccesses} failures={combatant.deathFailures} />
      )}
    </li>
  );
}

function DeathSavePips({ successes, failures }: { successes: number; failures: number }) {
  const row = (filled: number, colour: string, label: string) => (
    <span className="flex gap-0.5" title={`${label}: ${filled}/3`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: i < filled ? colour : "var(--border)" }}
        />
      ))}
    </span>
  );

  return (
    <span data-testid="death-save-pips" className="flex shrink-0 flex-col gap-1">
      {row(successes, "var(--success)", "Successes")}
      {row(failures, "var(--danger)", "Failures")}
    </span>
  );
}

function DeathSavePrompt({
  combatant,
  busy,
  onRoll,
}: {
  combatant: Combatant;
  busy: boolean;
  onRoll: () => void;
}) {
  return (
    <div data-testid="death-save-prompt" className="space-y-3">
      <div>
        <p className="text-sm font-medium">{combatant.name} is dying.</p>
        <p className="text-xs text-[var(--muted)]">
          Roll a death saving throw. Three successes and you stabilise; three failures and you die.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <DeathSavePips successes={combatant.deathSuccesses} failures={combatant.deathFailures} />
        <span className="text-xs text-[var(--muted)] tabular">
          {combatant.deathSuccesses} success{combatant.deathSuccesses === 1 ? "" : "es"} ·{" "}
          {combatant.deathFailures} failure{combatant.deathFailures === 1 ? "" : "s"}
        </span>
      </div>
      <Button testId="death-save-button" disabled={busy} className="w-full" onClick={onRoll}>
        Roll death save
      </Button>
    </div>
  );
}
