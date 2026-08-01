import { describe, expect, it } from "vitest";
import {
  type MovementContext,
  cellsInRadius,
  checkMeleeReach,
  checkRange,
  coverAt,
  distanceFt,
  provokesOpportunityAttacks,
  validatePath,
} from "./movement";

const map = { width: 20, height: 20 };

const ctx = (overrides: Partial<MovementContext> = {}): MovementContext => ({
  map,
  terrain: {},
  occupied: [],
  budgetFt: 30,
  ...overrides,
});

describe("distanceFt", () => {
  it("counts a diagonal as 5 feet under the standard grid rule", () => {
    expect(distanceFt({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(15);
  });

  it("measures straight lines in 5 foot cells", () => {
    expect(distanceFt({ x: 0, y: 0 }, { x: 6, y: 0 })).toBe(30);
  });

  it("alternates 5 and 10 feet per diagonal under the variant rule", () => {
    expect(distanceFt({ x: 0, y: 0 }, { x: 1, y: 1 }, "variant")).toBe(5);
    expect(distanceFt({ x: 0, y: 0 }, { x: 2, y: 2 }, "variant")).toBe(15);
    expect(distanceFt({ x: 0, y: 0 }, { x: 4, y: 4 }, "variant")).toBe(30);
  });

  it("is zero to itself", () => {
    expect(distanceFt({ x: 4, y: 4 }, { x: 4, y: 4 })).toBe(0);
  });
});

describe("validatePath", () => {
  const straight = [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ];

  it("charges 5 feet per cell", () => {
    const result = validatePath({ x: 0, y: 0 }, straight, ctx());
    expect(result).toMatchObject({ ok: true, costFt: 15 });
  });

  it("rejects a move that exceeds the remaining budget", () => {
    const result = validatePath({ x: 0, y: 0 }, straight, ctx({ budgetFt: 10 }));
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ costFt: 15 });
  });

  it("allows a move that exactly spends the budget", () => {
    expect(validatePath({ x: 0, y: 0 }, straight, ctx({ budgetFt: 15 })).ok).toBe(true);
  });

  it("doubles the cost of entering difficult terrain", () => {
    const result = validatePath(
      { x: 0, y: 0 },
      straight,
      ctx({ terrain: { difficult: [[2, 0]] } }),
    );
    expect(result).toMatchObject({ ok: true, costFt: 20 });
  });

  it("refuses to walk through a wall", () => {
    const result = validatePath({ x: 0, y: 0 }, straight, ctx({ terrain: { walls: [[2, 0]] } }));
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/wall/i);
  });

  it("refuses a path that teleports between non-adjacent cells", () => {
    const result = validatePath({ x: 0, y: 0 }, [{ x: 5, y: 5 }], ctx());
    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toMatch(/adjacent/i);
  });

  it("refuses to leave the map", () => {
    const result = validatePath({ x: 0, y: 0 }, [{ x: -1, y: 0 }], ctx());
    expect(result.ok === false && result.reason).toMatch(/leaves the map/i);
  });

  it("refuses to stop on an occupied square", () => {
    const result = validatePath({ x: 0, y: 0 }, straight, ctx({ occupied: [{ x: 3, y: 0 }] }));
    expect(result.ok === false && result.reason).toMatch(/already occupies/i);
  });

  it("allows moving through an occupied square without stopping on it", () => {
    expect(validatePath({ x: 0, y: 0 }, straight, ctx({ occupied: [{ x: 2, y: 0 }] })).ok).toBe(
      true,
    );
  });

  it("alternates diagonal costs across the whole move under the variant rule", () => {
    const diagonal = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ];
    const result = validatePath({ x: 0, y: 0 }, diagonal, ctx({ diagonal: "variant" }));
    expect(result).toMatchObject({ ok: true, costFt: 30 }); // 5 + 10 + 5 + 10
  });

  it("treats an empty path as free", () => {
    expect(validatePath({ x: 0, y: 0 }, [], ctx())).toMatchObject({ ok: true, costFt: 0 });
  });
});

describe("reach and range", () => {
  it("allows a 5 foot reach against an adjacent target", () => {
    expect(checkMeleeReach({ x: 0, y: 0 }, { x: 1, y: 1 }, 5).inRange).toBe(true);
  });

  it("denies a 5 foot reach two squares away", () => {
    const result = checkMeleeReach({ x: 0, y: 0 }, { x: 2, y: 0 }, 5);
    expect(result.inRange).toBe(false);
    expect(result.distanceFt).toBe(10);
  });

  it("allows a 10 foot reach weapon two squares away", () => {
    expect(checkMeleeReach({ x: 0, y: 0 }, { x: 2, y: 0 }, 10).inRange).toBe(true);
  });

  it("flags long range as in range but at a penalty", () => {
    const result = checkRange({ x: 0, y: 0 }, { x: 40, y: 0 }, { normal: 150, long: 600 });
    expect(result.distanceFt).toBe(200);
    expect(result.inRange).toBe(true);
    expect(result.longRange).toBe(true);
  });

  it("denies a shot past long range", () => {
    expect(
      checkRange({ x: 0, y: 0 }, { x: 200, y: 0 }, { normal: 150, long: 600 }).inRange,
    ).toBe(false);
  });

  it("treats a range with no long band as a hard limit", () => {
    expect(checkRange({ x: 0, y: 0 }, { x: 7, y: 0 }, { normal: 30 }).inRange).toBe(false);
    expect(checkRange({ x: 0, y: 0 }, { x: 6, y: 0 }, { normal: 30 }).inRange).toBe(true);
  });
});

describe("cover", () => {
  it("reads authored cover off the map", () => {
    const terrain = { cover: { "3,4": "half" as const } };
    expect(coverAt({ x: 3, y: 4 }, terrain)).toBe("half");
    expect(coverAt({ x: 0, y: 0 }, terrain)).toBe("none");
  });
});

describe("opportunity attacks", () => {
  const enemy = { id: "orc", name: "Orc", cell: { x: 1, y: 1 }, reachFt: 5 };

  it("provokes when leaving an enemy's reach", () => {
    const provoked = provokesOpportunityAttacks(
      { x: 1, y: 0 },
      [
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      [enemy],
    );
    expect(provoked).toEqual([{ id: "orc", name: "Orc" }]);
  });

  it("does not provoke while staying within reach", () => {
    expect(
      provokesOpportunityAttacks({ x: 1, y: 0 }, [{ x: 0, y: 1 }], [enemy]),
    ).toEqual([]);
  });

  it("does not provoke when starting outside reach", () => {
    const provoked = provokesOpportunityAttacks(
      { x: 8, y: 8 },
      [
        { x: 9, y: 9 },
        { x: 10, y: 10 },
      ],
      [enemy],
    );
    expect(provoked).toEqual([]);
  });

  it("provokes only once per enemy even if the mover re-enters and leaves again", () => {
    // The orc at (1,1) reaches every cell with x and y in 0..2, so leaving
    // means stepping to x = 3 — this path does that twice.
    const provoked = provokesOpportunityAttacks(
      { x: 1, y: 0 },
      [
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      [enemy],
    );
    expect(provoked).toHaveLength(1);
  });

  it("provokes from every enemy whose reach is left", () => {
    const second = { id: "goblin", name: "Goblin", cell: { x: 1, y: -1 }, reachFt: 5 };
    const provoked = provokesOpportunityAttacks(
      { x: 1, y: 0 },
      [
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      [enemy, second],
    );
    expect(provoked.map((p) => p.id).sort()).toEqual(["goblin", "orc"]);
  });
});

describe("cellsInRadius", () => {
  it("covers a 20 foot radius burst", () => {
    const cells = cellsInRadius({ x: 5, y: 5 }, 20, map);
    // Chebyshev distance <= 4 cells is a 9x9 block.
    expect(cells).toHaveLength(81);
  });

  it("clips at the map edge", () => {
    const cells = cellsInRadius({ x: 0, y: 0 }, 10, map);
    expect(cells).toHaveLength(9); // a 3x3 block clipped to the corner
    expect(cells.every((c) => c.x >= 0 && c.y >= 0)).toBe(true);
  });
});
