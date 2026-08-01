import { describe, expect, it } from "vitest";
import {
  CONDITIONS,
  abilityCheckModifiers,
  attackModifiersAgainst,
  attackModifiersFor,
  canTakeActions,
  effectiveSpeed,
  exhaustionEffects,
  expandConditions,
  hitIsAutomaticCrit,
  maxHpAfterExhaustion,
  savingThrowModifiers,
} from "./conditions";
import { srd } from "@/srd/local";

const state = (conditions: string[], exhaustion = 0) => ({ conditions, exhaustion });

describe("condition coverage", () => {
  it("covers every condition in the SRD", () => {
    const fromSrd = srd.conditions().map((c) => c.index).sort();
    expect([...CONDITIONS].sort()).toEqual(fromSrd);
  });
});

describe("expandConditions", () => {
  it("expands unconscious into incapacitated and prone", () => {
    expect(expandConditions(["unconscious"]).sort()).toEqual([
      "incapacitated",
      "prone",
      "unconscious",
    ]);
  });

  it("expands paralyzed into incapacitated", () => {
    expect(expandConditions(["paralyzed"])).toContain("incapacitated");
  });

  it("ignores unknown strings", () => {
    expect(expandConditions(["on-fire", "prone"])).toEqual(["prone"]);
  });

  it("does not duplicate overlapping implications", () => {
    const expanded = expandConditions(["unconscious", "prone", "incapacitated"]);
    expect(new Set(expanded).size).toBe(expanded.length);
  });
});

describe("action economy", () => {
  it.each(["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"])(
    "%s prevents actions",
    (condition) => {
      expect(canTakeActions(state([condition]))).toBe(false);
    },
  );

  it.each(["prone", "poisoned", "blinded", "charmed", "frightened", "grappled"])(
    "%s still allows actions",
    (condition) => {
      expect(canTakeActions(state([condition]))).toBe(true);
    },
  );
});

describe("speed", () => {
  it.each(["grappled", "restrained", "paralyzed", "stunned", "unconscious", "petrified"])(
    "%s reduces speed to zero",
    (condition) => {
      expect(effectiveSpeed(30, state([condition]))).toBe(0);
    },
  );

  it("halves speed at exhaustion 2 and zeroes it at 5", () => {
    expect(effectiveSpeed(30, state([], 1))).toBe(30);
    expect(effectiveSpeed(30, state([], 2))).toBe(15);
    expect(effectiveSpeed(25, state([], 2))).toBe(12);
    expect(effectiveSpeed(30, state([], 5))).toBe(0);
  });
});

describe("exhaustion", () => {
  it("applies each level cumulatively", () => {
    expect(exhaustionEffects(0)).toMatchObject({ checksHaveDisadvantage: false, dead: false });
    expect(exhaustionEffects(1).checksHaveDisadvantage).toBe(true);
    expect(exhaustionEffects(2).speedHalved).toBe(true);
    expect(exhaustionEffects(3).attacksAndSavesHaveDisadvantage).toBe(true);
    expect(exhaustionEffects(4).hpMaxHalved).toBe(true);
    expect(exhaustionEffects(5).speedZero).toBe(true);
    expect(exhaustionEffects(6).dead).toBe(true);
  });

  it("keeps lower-level effects at higher levels", () => {
    const level5 = exhaustionEffects(5);
    expect(level5.checksHaveDisadvantage).toBe(true);
    expect(level5.hpMaxHalved).toBe(true);
  });

  it("halves maximum hit points from level 4", () => {
    expect(maxHpAfterExhaustion(45, 3)).toBe(45);
    expect(maxHpAfterExhaustion(45, 4)).toBe(22);
  });

  it("clamps out-of-range levels", () => {
    expect(exhaustionEffects(-1).checksHaveDisadvantage).toBe(false);
    expect(exhaustionEffects(99).dead).toBe(true);
  });
});

describe("attack modifiers", () => {
  it("gives a blinded creature disadvantage on its own attacks", () => {
    expect(attackModifiersFor(state(["blinded"]))).toEqual({
      advantage: false,
      disadvantage: true,
    });
  });

  it("gives an invisible creature advantage on its own attacks", () => {
    expect(attackModifiersFor(state(["invisible"])).advantage).toBe(true);
  });

  it("gives disadvantage on attacks from exhaustion 3", () => {
    expect(attackModifiersFor(state([], 3)).disadvantage).toBe(true);
    expect(attackModifiersFor(state([], 2)).disadvantage).toBe(false);
  });

  it("makes an invisible creature harder to hit", () => {
    expect(attackModifiersAgainst(state(["invisible"]), 5).disadvantage).toBe(true);
  });

  it("makes a restrained creature easier to hit", () => {
    expect(attackModifiersAgainst(state(["restrained"]), 5).advantage).toBe(true);
  });

  it("flips prone advantage with distance", () => {
    expect(attackModifiersAgainst(state(["prone"]), 5)).toMatchObject({ advantage: true });
    expect(attackModifiersAgainst(state(["prone"]), 10)).toMatchObject({ disadvantage: true });
  });
});

describe("automatic criticals", () => {
  it.each(["paralyzed", "unconscious"])("%s turns melee hits into criticals", (condition) => {
    expect(hitIsAutomaticCrit(state([condition]), 5)).toBe(true);
    expect(hitIsAutomaticCrit(state([condition]), 10)).toBe(false);
  });

  it("does not apply to a merely restrained creature", () => {
    expect(hitIsAutomaticCrit(state(["restrained"]), 5)).toBe(false);
  });
});

describe("saving throws and checks", () => {
  it.each(["paralyzed", "petrified", "stunned", "unconscious"])(
    "%s auto-fails Strength and Dexterity saves only",
    (condition) => {
      expect(savingThrowModifiers(state([condition]), "str").autoFail).toBe(true);
      expect(savingThrowModifiers(state([condition]), "dex").autoFail).toBe(true);
      expect(savingThrowModifiers(state([condition]), "con").autoFail).toBe(false);
      expect(savingThrowModifiers(state([condition]), "wis").autoFail).toBe(false);
    },
  );

  it("gives a poisoned creature disadvantage on ability checks", () => {
    expect(abilityCheckModifiers(state(["poisoned"])).disadvantage).toBe(true);
  });

  it("gives a frightened creature disadvantage on ability checks", () => {
    expect(abilityCheckModifiers(state(["frightened"])).disadvantage).toBe(true);
  });

  it("leaves an unaffected creature rolling normally", () => {
    expect(abilityCheckModifiers(state([]))).toEqual({ advantage: false, disadvantage: false });
  });
});
