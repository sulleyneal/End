"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { ErrorNote } from "@/components/ui";
import type { Combatant, Encounter, MapShape } from "@/components/combat-types";

/**
 * The battlefield.
 *
 * Reachability is computed here only to decide what to highlight and which path
 * to propose — the server re-validates every step against the same rules and is
 * the only thing that can actually move a token. If this file disagreed with
 * the engine, the worst outcome would be a rejected move, never an illegal one.
 */

const FT_PER_CELL = 5;

type Cell = { x: number; y: number };
const key = (c: Cell) => `${c.x},${c.y}`;

type Props = {
  encounter: Encounter;
  myCharacterIds: string[];
  canCommandAll: boolean;
  onChanged: () => void;
};

/**
 * Breadth-first flood fill over the grid, charging the same costs the engine
 * does: 5 ft a step under the standard diagonal rule, doubled for difficult
 * terrain. Returns the cheapest cost to each cell and the path that got there.
 */
function reachable(from: Cell, budgetFt: number, map: MapShape, blocked: Set<string>) {
  const walls = new Set((map.terrain.walls ?? []).map(([x, y]) => key({ x, y })));
  const difficult = new Set((map.terrain.difficult ?? []).map(([x, y]) => key({ x, y })));

  const best = new Map<string, { cost: number; path: Cell[] }>();
  best.set(key(from), { cost: 0, path: [] });
  const queue: Cell[] = [from];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const here = best.get(key(current))!;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const next = { x: current.x + dx, y: current.y + dy };
        if (next.x < 0 || next.y < 0 || next.x >= map.width || next.y >= map.height) continue;
        if (walls.has(key(next))) continue;

        const cost = here.cost + (difficult.has(key(next)) ? FT_PER_CELL * 2 : FT_PER_CELL);
        if (cost > budgetFt) continue;

        const seen = best.get(key(next));
        if (seen && seen.cost <= cost) continue;

        best.set(key(next), { cost, path: [...here.path, next] });
        queue.push(next);
      }
    }
  }

  // You may move through an ally but not stop on them, so occupied cells stay
  // traversable in the search and are dropped only as destinations.
  for (const cell of blocked) best.delete(cell);
  best.delete(key(from));
  return best;
}

export function BattleMap({ encounter, myCharacterIds, canCommandAll, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const map = encounter.map;

  const active = encounter.combatants.find((c) => c.id === encounter.activeCombatantId) ?? null;
  const isMine =
    active !== null &&
    (canCommandAll ||
      (active.characterId !== null && myCharacterIds.includes(active.characterId)));

  const moves = useMemo(() => {
    if (!map || !active || !isMine || active.x === null || active.y === null) return null;
    if (active.hpCurrent === 0 || active.defeated) return null;

    const blocked = new Set(
      encounter.combatants
        .filter((c) => c.id !== active.id && !c.defeated && c.x !== null && c.y !== null)
        .map((c) => key({ x: c.x!, y: c.y! })),
    );
    return reachable(
      { x: active.x, y: active.y },
      Math.max(0, active.speed - active.movementUsed),
      map,
      blocked,
    );
  }, [map, active, isMine, encounter.combatants]);

  if (!map) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--muted)]">
        This encounter has no battlefield.
      </section>
    );
  }

  const walls = new Set((map.terrain.walls ?? []).map(([x, y]) => key({ x, y })));
  const difficult = new Set((map.terrain.difficult ?? []).map(([x, y]) => key({ x, y })));

  const moveTo = async (cell: Cell) => {
    const plan = moves?.get(key(cell));
    if (!plan || !active || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/encounters/${encounter.id}/actions`, {
        method: "POST",
        json: { type: "move", combatantId: active.id, path: plan.path },
      });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cells: React.ReactNode[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const cell = { x, y };
      const k = key(cell);
      const plan = moves?.get(k);
      const fill = walls.has(k)
        ? "var(--wall)"
        : difficult.has(k)
          ? "var(--difficult)"
          : "transparent";

      cells.push(
        <rect
          key={k}
          x={x}
          y={y}
          width={1}
          height={1}
          fill={fill}
          stroke="var(--grid)"
          strokeWidth={0.02}
        />,
      );

      if (plan) {
        cells.push(
          <rect
            key={`${k}-reach`}
            data-testid="reachable-cell"
            data-cell={k}
            x={x + 0.08}
            y={y + 0.08}
            width={0.84}
            height={0.84}
            rx={0.12}
            fill="var(--accent)"
            opacity={0.18}
            className="cursor-pointer transition-opacity hover:opacity-40"
            onClick={() => void moveTo(cell)}
          >
            <title>{`Move here — ${plan.cost} ft`}</title>
          </rect>,
        );
      }
    }
  }

  return (
    <section
      data-testid="battle-map"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <div className="mb-2 flex items-center justify-between text-xs text-[var(--muted)]">
        <span>
          {map.width} × {map.height} grid · {map.cellSizeFt} ft squares
        </span>
        {isMine && active && (
          <span className="tabular">{active.speed - active.movementUsed} ft left</span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${map.width} ${map.height}`}
        className="w-full touch-manipulation select-none"
        style={
          {
            aspectRatio: `${map.width} / ${map.height}`,
            "--grid": "color-mix(in srgb, var(--border) 70%, transparent)",
            "--wall": "color-mix(in srgb, var(--foreground) 22%, transparent)",
            "--difficult": "color-mix(in srgb, var(--ruling) 18%, transparent)",
          } as React.CSSProperties
        }
        role="img"
        aria-label="Battle map"
      >
        {cells}
        {encounter.combatants
          .filter((c) => c.x !== null && c.y !== null && !c.defeated)
          .map((c) => (
            <Token
              key={c.id}
              combatant={c}
              isActive={c.id === encounter.activeCombatantId}
              isMine={
                canCommandAll ||
                (c.characterId !== null && myCharacterIds.includes(c.characterId))
              }
            />
          ))}
      </svg>

      {isMine && moves && moves.size > 0 && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Tap a highlighted square to move. Range, difficult terrain and opportunity attacks are
          enforced by the server.
        </p>
      )}
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

function Token({
  combatant,
  isActive,
  isMine,
}: {
  combatant: Combatant;
  isActive: boolean;
  isMine: boolean;
}) {
  const x = combatant.x!;
  const y = combatant.y!;
  const colour =
    combatant.side === "party" ? "var(--accent)" : combatant.side === "foe" ? "var(--danger)" : "var(--muted)";
  const initials = combatant.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const hurt = combatant.hpMax > 0 ? combatant.hpCurrent / combatant.hpMax : 1;

  return (
    <g data-testid="map-token" data-combatant={combatant.id} data-cell={`${x},${y}`}>
      {isActive && (
        <circle cx={x + 0.5} cy={y + 0.5} r={0.47} fill="none" stroke={colour} strokeWidth={0.08} />
      )}
      <circle
        cx={x + 0.5}
        cy={y + 0.5}
        r={0.36}
        fill={colour}
        opacity={combatant.hpCurrent === 0 ? 0.35 : 1}
        stroke={isMine ? "var(--foreground)" : "none"}
        strokeWidth={isMine ? 0.05 : 0}
      />
      <text
        x={x + 0.5}
        y={y + 0.5}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={0.3}
        fill="white"
        style={{ pointerEvents: "none", fontWeight: 600 }}
      >
        {initials}
      </text>
      {/* A wound ring, so damage is visible without reading numbers off the map. */}
      {hurt < 1 && combatant.hpCurrent > 0 && (
        <path
          d={describeArc(x + 0.5, y + 0.5, 0.44, hurt)}
          fill="none"
          stroke={hurt > 0.5 ? "var(--success)" : "var(--danger)"}
          strokeWidth={0.07}
          strokeLinecap="round"
        />
      )}
      <title>{`${combatant.name} — ${combatant.hpCurrent}/${combatant.hpMax} HP, AC ${combatant.ac}`}</title>
    </g>
  );
}

/** Arc from twelve o'clock clockwise covering `fraction` of the circle. */
function describeArc(cx: number, cy: number, r: number, fraction: number) {
  const angle = Math.max(0.001, Math.min(0.999, fraction)) * Math.PI * 2;
  const endX = cx + r * Math.sin(angle);
  const endY = cy - r * Math.cos(angle);
  const largeArc = angle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY}`;
}
