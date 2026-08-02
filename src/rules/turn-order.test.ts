import { describe, expect, it } from "vitest";
import {
  type TurnParticipant,
  advanceTurn,
  resolveTurn,
} from "./turn-order";

/**
 * Turn order.
 *
 * Every scenario here corresponds to a bug that actually shipped, or to an
 * invariant that a shipped bug violated. The three regressions this file exists
 * to prevent:
 *
 *   1. A character who died on their own turn became the permanent active
 *      combatant — nobody could act, and the campaign could never fight again.
 *   2. The fix for that let the next combatant take two turns with two actions.
 *   3. The fix for *that* left the round counter a turn behind whenever the
 *      pointer wrapped past a corpse.
 */

const order = (...names: string[]): TurnParticipant[] =>
  names.map((name) => ({ id: name, defeated: false }));

const kill = (list: TurnParticipant[], ...names: string[]): TurnParticipant[] =>
  list.map((c) => (names.includes(c.id) ? { ...c, defeated: true } : c));

/**
 * Plays a fight and records `round/turnIndex:active` at each step, applying
 * deaths at the moment the scenario says they happen.
 */
function play(
  combatants: TurnParticipant[],
  turns: number,
  deathsAfter: Record<number, string[]> = {},
): string[] {
  let roster = combatants;
  let pointer = resolveTurn(roster, 0, 1);
  const trace: string[] = [];

  for (let turn = 0; turn < turns; turn++) {
    if (!pointer.activeId) break;
    trace.push(`${pointer.round}/${pointer.turnIndex}:${pointer.activeId}`);

    const actorIndex = roster.findIndex((c) => c.id === pointer.activeId);
    const dying = deathsAfter[turn];
    if (dying) roster = kill(roster, ...dying);

    // A combatant who died on their own turn does not end it; the pointer is
    // resolved forward instead, exactly as the server does on the next read.
    if (dying?.includes(pointer.activeId)) {
      pointer = resolveTurn(roster, pointer.turnIndex, pointer.round);
    } else {
      pointer = advanceTurn(roster, actorIndex, pointer.round);
      pointer = resolveTurn(roster, pointer.turnIndex, pointer.round);
    }
  }

  return trace;
}

describe("nobody dies", () => {
  it("gives each combatant one turn per round, in order", () => {
    expect(play(order("A", "B", "C", "D"), 9)).toEqual([
      "1/0:A", "1/1:B", "1/2:C", "1/3:D",
      "2/0:A", "2/1:B", "2/2:C", "2/3:D",
      "3/0:A",
    ]);
  });

  it("increments the round exactly once per full cycle", () => {
    const trace = play(order("A", "B"), 7);
    expect(trace).toEqual(["1/0:A", "1/1:B", "2/0:A", "2/1:B", "3/0:A", "3/1:B", "4/0:A"]);
  });

  it("handles a single combatant without wedging", () => {
    expect(play(order("A"), 3)).toEqual(["1/0:A", "2/0:A", "3/0:A"]);
  });
});

describe("a combatant dies on their own turn", () => {
  it("does not deadlock — the fight continues past the corpse", () => {
    // Regression 1: the corpse used to stay active forever.
    const trace = play(order("A", "B", "C"), 6, { 1: ["B"] });
    expect(trace).toEqual(["1/0:A", "1/1:B", "1/2:C", "2/0:A", "2/2:C", "3/0:A"]);
    expect(trace.filter((t) => t.endsWith(":B"))).toHaveLength(1);
  });

  it("does not give the next combatant two turns", () => {
    // Regression 2: C used to appear twice in round 1.
    const trace = play(order("A", "B", "C"), 5, { 1: ["B"] });
    const roundOne = trace.filter((t) => t.startsWith("1/"));
    expect(roundOne).toEqual(["1/0:A", "1/1:B", "1/2:C"]);
  });

  it("keeps the round honest when the LAST in order dies", () => {
    // Regression 3: A's next turn used to be labelled round 1.
    const trace = play(order("A", "B", "C", "D"), 7, { 3: ["D"] });
    expect(trace).toEqual([
      "1/0:A", "1/1:B", "1/2:C", "1/3:D",
      "2/0:A", "2/1:B", "2/2:C",
    ]);
  });

  it("keeps the round honest when the FIRST in order dies", () => {
    const trace = play(order("A", "B", "C"), 6, { 0: ["A"] });
    expect(trace).toEqual(["1/0:A", "1/1:B", "1/2:C", "2/1:B", "2/2:C", "3/1:B"]);
  });

  it("skips a run of consecutive corpses in one step", () => {
    const trace = play(order("A", "B", "C", "D"), 5, { 1: ["B", "C"] });
    expect(trace).toEqual(["1/0:A", "1/1:B", "1/3:D", "2/0:A", "2/3:D"]);
  });

  it("skips a trailing run and still turns the round over once", () => {
    const trace = play(order("A", "B", "C", "D"), 5, { 1: ["C", "D"] });
    expect(trace).toEqual(["1/0:A", "1/1:B", "2/0:A", "2/1:B", "3/0:A"]);
  });
});

describe("a combatant dies on somebody else's turn", () => {
  it("is simply skipped when their index comes round", () => {
    const trace = play(order("A", "B", "C"), 6, { 0: ["C"] });
    expect(trace).toEqual(["1/0:A", "1/1:B", "2/0:A", "2/1:B", "3/0:A", "3/1:B"]);
  });
});

describe("the last one standing", () => {
  it("reports nobody active once everyone is down", () => {
    const roster = kill(order("A", "B"), "A", "B");
    expect(resolveTurn(roster, 0, 3).activeId).toBeNull();
  });

  it("keeps taking turns while one is left", () => {
    const trace = play(order("A", "B", "C"), 4, { 0: ["B", "C"] });
    expect(trace).toEqual(["1/0:A", "2/0:A", "3/0:A", "4/0:A"]);
  });
});

describe("resolveTurn on its own", () => {
  it("reports moved=false when the pointer is already correct", () => {
    expect(resolveTurn(order("A", "B"), 1, 4)).toEqual({
      activeId: "B",
      turnIndex: 1,
      round: 4,
      moved: false,
    });
  });

  it("reports moved=true and the new round when it wraps past the dead", () => {
    const roster = kill(order("A", "B", "C"), "C");
    expect(resolveTurn(roster, 2, 4)).toEqual({
      activeId: "A",
      turnIndex: 0,
      round: 5,
      moved: true,
    });
  });

  it("does not advance the round when it skips forward without wrapping", () => {
    const roster = kill(order("A", "B", "C"), "B");
    expect(resolveTurn(roster, 1, 4)).toEqual({
      activeId: "C",
      turnIndex: 2,
      round: 4,
      moved: true,
    });
  });

  it("tolerates an index past the end of the roster", () => {
    expect(resolveTurn(order("A", "B"), 7, 2).activeId).toBe("B");
  });
});

/* ------------------------------------------------------------------ *
 * Invariants
 *
 * The scenarios above are the shapes that broke. These assert the rules
 * those breakages violated, over every death schedule up to a bound —
 * which is how a fourth variation gets caught before it ships.
 * ------------------------------------------------------------------ */

describe("invariants over exhaustive death schedules", () => {
  /** Every subset of a roster, as the set of combatants that die. */
  function subsets(size: number): number[][] {
    const out: number[][] = [];
    for (let mask = 0; mask < 1 << size; mask++) {
      const set: number[] = [];
      for (let i = 0; i < size; i++) if (mask & (1 << i)) set.push(i);
      out.push(set);
    }
    return out;
  }

  it("never lets the round go backwards, and never skips a round number", () => {
    for (const size of [2, 3, 4, 5]) {
      const names = Array.from({ length: size }, (_, i) => String.fromCharCode(65 + i));
      for (const dying of subsets(size)) {
        if (dying.length === size) continue;

        for (let dieOnTurn = 0; dieOnTurn < size * 2; dieOnTurn++) {
          const trace = play(order(...names), size * 4, {
            [dieOnTurn]: dying.map((i) => names[i]),
          });

          let previous = 0;
          for (const step of trace) {
            const round = Number(step.split("/")[0]);
            expect(round).toBeGreaterThanOrEqual(previous);
            // A round number is never leapfrogged.
            if (previous > 0) expect(round - previous).toBeLessThanOrEqual(1);
            previous = round;
          }
        }
      }
    }
  });

  it("gives every living combatant exactly one turn in a completed round", () => {
    for (const size of [2, 3, 4, 5]) {
      const names = Array.from({ length: size }, (_, i) => String.fromCharCode(65 + i));
      for (const dying of subsets(size)) {
        if (dying.length === size) continue;
        const dead = new Set(dying.map((i) => names[i]));

        // Kill before play begins, so every round in the trace is a clean one.
        let roster = order(...names);
        roster = kill(roster, ...dead);
        const trace = play(roster, size * 4);

        const byRound = new Map<number, string[]>();
        for (const step of trace) {
          const [round, rest] = step.split("/");
          const who = rest.split(":")[1];
          byRound.set(Number(round), [...(byRound.get(Number(round)) ?? []), who]);
        }

        const survivors = names.filter((n) => !dead.has(n));
        for (const [round, took] of byRound) {
          // The first and last rounds in a truncated trace may be partial.
          if (took.length !== survivors.length) continue;
          expect(new Set(took).size, `round ${round} had a repeat: ${took.join(",")}`).toBe(
            took.length,
          );
          expect(took).toEqual(survivors);
        }
      }
    }
  });

  it("never makes a defeated combatant active while anyone is alive", () => {
    for (const size of [2, 3, 4, 5]) {
      const names = Array.from({ length: size }, (_, i) => String.fromCharCode(65 + i));
      for (const dying of subsets(size)) {
        if (dying.length === size) continue;
        const dead = new Set(dying.map((i) => names[i]));

        for (let dieOnTurn = 0; dieOnTurn < size * 2; dieOnTurn++) {
          const trace = play(order(...names), size * 3, {
            [dieOnTurn]: [...dead],
          });

          // Anyone acting after the death turn must still be alive.
          trace.slice(dieOnTurn + 1).forEach((step) => {
            const who = step.split(":")[1];
            expect(dead.has(who), `${who} acted after dying`).toBe(false);
          });
        }
      }
    }
  });
});
