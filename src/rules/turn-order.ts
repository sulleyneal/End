/**
 * Whose turn it is, and what happens when a turn ends.
 *
 * This is deliberately pure. It had been inlined in the two database functions
 * that use it, and three bugs in a row hid there — a permanent deadlock when a
 * character died, a duplicate turn in the fix for that, and a round counter that
 * lagged a turn behind in the fix for *that*. None of them were caught by tests,
 * because the logic could only be reached by playing a real fight against a real
 * database. Every one of them is a few lines of arithmetic over an array.
 *
 * The whole model is: an ordered list of combatants, an index into it, and a
 * round number. Two rules hold at all times, and the tests assert them directly:
 *
 *   1. `turnIndex` never points at a defeated combatant while anyone is alive.
 *   2. `round` is always the round of the combatant whose turn it is.
 *
 * The second is the one that kept breaking: skipping past a corpse can wrap the
 * end of the initiative order, and a wrap *is* a new round. Discovering the skip
 * and counting the round it implies have to happen together.
 */

export type TurnParticipant = { id: string; defeated: boolean };

export type TurnPointer = {
  /** The combatant whose turn it is, or null when nobody is left standing. */
  activeId: string | null;
  turnIndex: number;
  round: number;
  /** True when the pointer had to move past the dead to find them. */
  moved: boolean;
};

/**
 * Resolves the pointer, stepping over anyone already out of the fight.
 *
 * `moved` tells the caller the stored pointer was stale and should be written
 * back. Leaving it unwritten is what made the round lag: the wrap had happened
 * in fact but not in the database, so the next turn paid for it a turn late.
 */
export function resolveTurn(
  combatants: TurnParticipant[],
  turnIndex: number,
  round: number,
): TurnPointer {
  if (combatants.length === 0 || combatants.every((c) => c.defeated)) {
    return { activeId: null, turnIndex, round, moved: false };
  }

  // A stored index can be out of range if the roster ever shrank; treat it as 0
  // rather than returning nobody.
  const start = ((turnIndex % combatants.length) + combatants.length) % combatants.length;

  for (let step = 0; step < combatants.length; step++) {
    const index = (start + step) % combatants.length;
    const candidate = combatants[index];
    if (candidate.defeated) continue;

    if (step === 0) {
      return { activeId: candidate.id, turnIndex: start, round, moved: turnIndex !== start };
    }

    // Passing the end of the order is a new round.
    const wrapped = index < start;
    return {
      activeId: candidate.id,
      turnIndex: index,
      round: wrapped ? round + 1 : round,
      moved: true,
    };
  }

  return { activeId: null, turnIndex, round, moved: false };
}

/**
 * Advances past the combatant who just acted.
 *
 * Takes the actor's own index rather than the stored one. They are the same
 * whenever `resolveTurn`'s result has been written back, but taking the actor
 * is what makes the intent obvious: a turn ends for whoever took it.
 */
export function advanceTurn(
  combatants: TurnParticipant[],
  actorIndex: number,
  round: number,
): TurnPointer {
  if (combatants.length === 0) {
    return { activeId: null, turnIndex: actorIndex, round, moved: false };
  }

  let index = actorIndex;
  let next = round;

  for (let step = 0; step < combatants.length; step++) {
    index += 1;
    if (index >= combatants.length) {
      index = 0;
      next += 1;
    }
    const candidate = combatants[index];
    if (candidate && !candidate.defeated) {
      return { activeId: candidate.id, turnIndex: index, round: next, moved: true };
    }
  }

  // Everyone else is down. The encounter is over; the caller resolves it.
  return { activeId: null, turnIndex: index, round: next, moved: true };
}
