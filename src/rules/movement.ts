import type { MapTerrain } from "@/db/schema";

/**
 * Grid geometry and the movement budget.
 *
 * All of this runs server-side. The canvas renderer draws whatever the server
 * says is legal; it never decides a move is allowed.
 */

export type Cell = { x: number; y: number };
export type DiagonalRule = "standard" | "variant";

const FT_PER_CELL = 5;

const key = (c: Cell) => `${c.x},${c.y}`;

/**
 * Distance in feet.
 *
 * `standard` is the PHB grid rule: every diagonal counts as 5 ft, so distance
 * is Chebyshev. `variant` is the DMG optional rule where the second, fourth,
 * … diagonal costs 10 ft.
 */
export function distanceFt(a: Cell, b: Cell, rule: DiagonalRule = "standard"): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);

  if (rule === "standard") return Math.max(dx, dy) * FT_PER_CELL;

  const diagonals = Math.min(dx, dy);
  const straights = Math.max(dx, dy) - diagonals;
  // Diagonals alternate 5 and 10 feet: n diagonals cost floor(n * 1.5) cells.
  return (straights + Math.floor(diagonals * 1.5)) * FT_PER_CELL;
}

export function isAdjacent(a: Cell, b: Cell): boolean {
  return (
    Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && !(a.x === b.x && a.y === b.y)
  );
}

/* ------------------------------------------------------------------ *
 * Paths
 * ------------------------------------------------------------------ */

export type PathValidation =
  | { ok: true; costFt: number; path: Cell[] }
  | { ok: false; reason: string; costFt?: number };

export type MovementContext = {
  map: { width: number; height: number };
  terrain: MapTerrain;
  /** Cells occupied by other creatures. A creature cannot end its move in one. */
  occupied: Cell[];
  budgetFt: number;
  diagonal?: DiagonalRule;
};

/**
 * Validates a step-by-step path against the map and the mover's remaining
 * speed. The client sends the whole path so the server can charge for
 * difficult terrain and reject moves through walls, rather than trusting a
 * start and an end point.
 */
export function validatePath(from: Cell, path: Cell[], ctx: MovementContext): PathValidation {
  if (path.length === 0) return { ok: true, costFt: 0, path: [] };

  const rule = ctx.diagonal ?? "standard";
  const walls = new Set((ctx.terrain.walls ?? []).map(([x, y]) => key({ x, y })));
  const difficult = new Set((ctx.terrain.difficult ?? []).map(([x, y]) => key({ x, y })));
  const occupied = new Set(ctx.occupied.map(key));

  let current = from;
  let costFt = 0;
  // The variant diagonal rule alternates across the whole move, not per step.
  let diagonalCount = 0;

  for (const [i, step] of path.entries()) {
    if (step.x < 0 || step.y < 0 || step.x >= ctx.map.width || step.y >= ctx.map.height) {
      return { ok: false, reason: `Step ${i + 1} leaves the map.` };
    }
    if (!isAdjacent(current, step)) {
      return { ok: false, reason: `Step ${i + 1} is not adjacent to the previous cell.` };
    }
    if (walls.has(key(step))) {
      return { ok: false, reason: `Step ${i + 1} enters a wall.` };
    }
    if (occupied.has(key(step)) && i === path.length - 1) {
      return { ok: false, reason: "A creature already occupies that space." };
    }

    const isDiagonal = step.x !== current.x && step.y !== current.y;
    let stepFt = FT_PER_CELL;
    if (isDiagonal && rule === "variant") {
      diagonalCount += 1;
      stepFt = diagonalCount % 2 === 0 ? 10 : 5;
    }
    // Difficult terrain costs an extra 5 ft (or doubles the diagonal cost).
    if (difficult.has(key(step))) stepFt *= 2;

    costFt += stepFt;
    current = step;
  }

  if (costFt > ctx.budgetFt) {
    return {
      ok: false,
      reason: `That move costs ${costFt} ft but only ${ctx.budgetFt} ft of movement remains.`,
      costFt,
    };
  }

  return { ok: true, costFt, path };
}

/* ------------------------------------------------------------------ *
 * Reach, range and cover
 * ------------------------------------------------------------------ */

export type RangeCheck = {
  inRange: boolean;
  distanceFt: number;
  /** Ranged attacks past normal range but within long range have disadvantage. */
  longRange: boolean;
  reason?: string;
};

export function checkMeleeReach(
  attacker: Cell,
  target: Cell,
  reachFt: number,
  rule: DiagonalRule = "standard",
): RangeCheck {
  const d = distanceFt(attacker, target, rule);
  return {
    inRange: d <= reachFt,
    distanceFt: d,
    longRange: false,
    reason: d <= reachFt ? undefined : `Target is ${d} ft away, beyond ${reachFt} ft reach.`,
  };
}

export function checkRange(
  attacker: Cell,
  target: Cell,
  range: { normal: number; long?: number },
  rule: DiagonalRule = "standard",
): RangeCheck {
  const d = distanceFt(attacker, target, rule);
  const max = range.long ?? range.normal;
  return {
    inRange: d <= max,
    distanceFt: d,
    longRange: d > range.normal && d <= max,
    reason: d <= max ? undefined : `Target is ${d} ft away, beyond ${max} ft.`,
  };
}

export type Cover = "none" | "half" | "three-quarters" | "total";

export const COVER_AC_BONUS: Record<Cover, number> = {
  none: 0,
  half: 2,
  "three-quarters": 5,
  total: 0, // Total cover cannot be targeted at all.
};

/** Cover is authored on the map rather than inferred, so a DM can place it deliberately. */
export function coverAt(target: Cell, terrain: MapTerrain): Cover {
  return terrain.cover?.[key(target)] ?? "none";
}

/* ------------------------------------------------------------------ *
 * Opportunity attacks
 * ------------------------------------------------------------------ */

/**
 * A creature provokes when it *leaves* an enemy's reach using its movement.
 * Moving between two cells that are both within reach does not provoke.
 */
export function provokesOpportunityAttacks(
  from: Cell,
  path: Cell[],
  enemies: { id: string; name: string; cell: Cell; reachFt: number }[],
  rule: DiagonalRule = "standard",
): { id: string; name: string }[] {
  if (path.length === 0) return [];
  const provoked: { id: string; name: string }[] = [];

  for (const enemy of enemies) {
    let inReach = distanceFt(from, enemy.cell, rule) <= enemy.reachFt;
    if (!inReach) continue;

    for (const step of path) {
      const nowInReach = distanceFt(step, enemy.cell, rule) <= enemy.reachFt;
      if (inReach && !nowInReach) {
        provoked.push({ id: enemy.id, name: enemy.name });
        break;
      }
      inReach = nowInReach;
    }
  }

  return provoked;
}

/* ------------------------------------------------------------------ *
 * Areas of effect
 * ------------------------------------------------------------------ */

/** Cells inside a sphere/circle of the given radius, measured from its centre. */
export function cellsInRadius(
  centre: Cell,
  radiusFt: number,
  map: { width: number; height: number },
  rule: DiagonalRule = "standard",
): Cell[] {
  const cells: Cell[] = [];
  const reach = Math.ceil(radiusFt / FT_PER_CELL);
  for (let y = centre.y - reach; y <= centre.y + reach; y++) {
    for (let x = centre.x - reach; x <= centre.x + reach; x++) {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      if (distanceFt(centre, { x, y }, rule) <= radiusFt) cells.push({ x, y });
    }
  }
  return cells;
}
