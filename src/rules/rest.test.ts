import { describe, expect, it } from "vitest";
import { scriptedRng } from "./dice";
import { type RestingCharacter, takeLongRest, takeShortRest } from "./rest";

const character = (overrides: Partial<RestingCharacter> = {}): RestingCharacter => ({
  level: 5,
  hitDie: 10,
  hitDiceRemaining: 5,
  conModifier: 2,
  hpCurrent: 10,
  hpMax: 44,
  tempHp: 0,
  exhaustion: 0,
  conditions: [],
  spellSlots: [],
  ...overrides,
});

describe("short rest", () => {
  it("heals the roll plus the Constitution modifier per die", () => {
    const result = takeShortRest(character(), 2, scriptedRng([6, 4]));
    expect(result.hpHealed).toBe(6 + 2 + 4 + 2);
    expect(result.patch.hpCurrent).toBe(24);
    expect(result.patch.hitDiceRemaining).toBe(3);
  });

  it("cannot spend more dice than remain", () => {
    const result = takeShortRest(character({ hitDiceRemaining: 1 }), 5, scriptedRng([5]));
    expect(result.diceSpent).toBe(1);
    expect(result.patch.hitDiceRemaining).toBe(0);
  });

  it("stops once the character reaches full health", () => {
    const result = takeShortRest(
      character({ hpCurrent: 42, hpMax: 44 }),
      3,
      scriptedRng([6, 6, 6]),
    );
    expect(result.diceSpent).toBe(1);
    expect(result.patch.hpCurrent).toBe(44);
  });

  it("never heals a negative amount from a bad Constitution modifier", () => {
    const result = takeShortRest(
      character({ conModifier: -3, hpCurrent: 10 }),
      1,
      scriptedRng([1]),
    );
    expect(result.rolls[0].healed).toBe(0);
    expect(result.patch.hpCurrent).toBe(10);
  });

  it("spends nothing when asked for zero dice", () => {
    const result = takeShortRest(character(), 0);
    expect(result.diceSpent).toBe(0);
    expect(result.patch.hpCurrent).toBe(10);
  });

  it("reports each die so the log can show the player their rolls", () => {
    const result = takeShortRest(character(), 2, scriptedRng([3, 7]));
    expect(result.rolls).toEqual([
      { die: 10, rolled: 3, healed: 5 },
      { die: 10, rolled: 7, healed: 9 },
    ]);
  });
});

describe("long rest", () => {
  it("restores all hit points and clears temporary hit points", () => {
    const result = takeLongRest(character({ hpCurrent: 3, tempHp: 8 }));
    expect(result.patch.hpCurrent).toBe(44);
    expect(result.patch.tempHp).toBe(0);
  });

  it("returns half the character's total hit dice", () => {
    const result = takeLongRest(character({ level: 5, hitDiceRemaining: 0 }));
    expect(result.hitDiceRegained).toBe(2);
    expect(result.patch.hitDiceRemaining).toBe(2);
  });

  it("returns at least one hit die at low level", () => {
    const result = takeLongRest(character({ level: 1, hitDiceRemaining: 0 }));
    expect(result.hitDiceRegained).toBe(1);
  });

  it("never exceeds the character's total hit dice", () => {
    const result = takeLongRest(character({ level: 5, hitDiceRemaining: 4 }));
    expect(result.patch.hitDiceRemaining).toBe(5);
  });

  it("removes one level of exhaustion", () => {
    expect(takeLongRest(character({ exhaustion: 3 })).patch.exhaustion).toBe(2);
    expect(takeLongRest(character({ exhaustion: 0 })).patch.exhaustion).toBe(0);
  });

  it("restores every expended spell slot", () => {
    const result = takeLongRest(
      character({
        spellSlots: [
          { level: 1, max: 4, used: 4 },
          { level: 2, max: 3, used: 1 },
        ],
      }),
    );
    expect(result.spellSlots).toEqual([
      { level: 1, max: 4, used: 0 },
      { level: 2, max: 3, used: 0 },
    ]);
  });

  it("wakes an unconscious character and clears their death saves", () => {
    const result = takeLongRest(character({ conditions: ["unconscious", "poisoned"] }));
    expect(result.patch.conditions).toEqual(["poisoned"]);
    expect(result.patch.deathFailures).toBe(0);
  });
});
