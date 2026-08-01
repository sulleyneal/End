import { describe, expect, it } from "vitest";
import { scriptedRng } from "./dice";
import {
  type CombatantState,
  adjustDamageForDefenses,
  applyDamage,
  applyHealing,
  applyTempHp,
  concentrationDc,
  resolveAttack,
  resolveSave,
  rollDeathSave,
  rollWeaponDamage,
  sortInitiative,
} from "./combat";

const combatant = (overrides: Partial<CombatantState> = {}): CombatantState => ({
  name: "Target",
  hpCurrent: 20,
  hpMax: 20,
  tempHp: 0,
  ac: 15,
  conditions: [],
  exhaustion: 0,
  deathSuccesses: 0,
  deathFailures: 0,
  stable: false,
  defeated: false,
  ...overrides,
});

const healthy = { conditions: [], exhaustion: 0 };

describe("resolveAttack", () => {
  it("hits when the total meets the target's AC", () => {
    const result = resolveAttack(
      { attackBonus: 5, attacker: healthy, target: combatant({ ac: 15 }), rangeFt: 5 },
      scriptedRng([10]),
    );
    expect(result.hit).toBe(true);
    expect(result.critical).toBe(false);
  });

  it("misses when the total falls one short", () => {
    const result = resolveAttack(
      { attackBonus: 5, attacker: healthy, target: combatant({ ac: 16 }), rangeFt: 5 },
      scriptedRng([10]),
    );
    expect(result.hit).toBe(false);
  });

  it("treats a natural 20 as a hit and a critical however high the AC", () => {
    const result = resolveAttack(
      { attackBonus: 0, attacker: healthy, target: combatant({ ac: 30 }), rangeFt: 5 },
      scriptedRng([20]),
    );
    expect(result.hit).toBe(true);
    expect(result.critical).toBe(true);
  });

  it("treats a natural 1 as a miss however large the bonus", () => {
    const result = resolveAttack(
      { attackBonus: 50, attacker: healthy, target: combatant({ ac: 10 }), rangeFt: 5 },
      scriptedRng([1]),
    );
    expect(result.hit).toBe(false);
    expect(result.fumble).toBe(true);
    expect(result.critical).toBe(false);
  });

  it("crits on 19 for a champion's expanded range", () => {
    const result = resolveAttack(
      {
        attackBonus: 5,
        attacker: healthy,
        target: combatant({ ac: 15 }),
        rangeFt: 5,
        critRange: 19,
      },
      scriptedRng([19]),
    );
    expect(result.critical).toBe(true);
  });

  it("gives advantage against a prone target in melee", () => {
    const result = resolveAttack(
      {
        attackBonus: 0,
        attacker: healthy,
        target: combatant({ conditions: ["prone"] }),
        rangeFt: 5,
      },
      scriptedRng([3, 17]),
    );
    expect(result.advantage).toBe("advantage");
    expect(result.natural).toBe(17);
  });

  it("gives disadvantage against a prone target at range", () => {
    const result = resolveAttack(
      {
        attackBonus: 0,
        attacker: healthy,
        target: combatant({ conditions: ["prone"] }),
        rangeFt: 30,
      },
      scriptedRng([3, 17]),
    );
    expect(result.advantage).toBe("disadvantage");
    expect(result.natural).toBe(3);
  });

  it("cancels a blinded attacker's disadvantage against a paralyzed target's advantage", () => {
    const result = resolveAttack(
      {
        attackBonus: 0,
        attacker: { conditions: ["blinded"], exhaustion: 0 },
        target: combatant({ conditions: ["paralyzed"] }),
        rangeFt: 5,
      },
      scriptedRng([11]),
    );
    expect(result.advantage).toBe("normal");
    expect(result.roll.dice).toHaveLength(1);
  });

  it("makes any melee hit on a paralyzed target a critical", () => {
    const result = resolveAttack(
      {
        attackBonus: 5,
        attacker: healthy,
        target: combatant({ ac: 12, conditions: ["paralyzed"] }),
        rangeFt: 5,
      },
      scriptedRng([10, 10]),
    );
    expect(result.hit).toBe(true);
    expect(result.critical).toBe(true);
  });

  it("does not auto-crit on a paralyzed target beyond 5 feet", () => {
    const result = resolveAttack(
      {
        attackBonus: 5,
        attacker: healthy,
        target: combatant({ ac: 12, conditions: ["paralyzed"] }),
        rangeFt: 30,
      },
      scriptedRng([10, 10]),
    );
    expect(result.hit).toBe(true);
    expect(result.critical).toBe(false);
  });
});

describe("damage defenses", () => {
  const target = combatant({
    resistances: ["fire"],
    vulnerabilities: ["cold"],
    immunities: ["poison"],
  });

  it("halves resisted damage, rounding down", () => {
    expect(adjustDamageForDefenses({ amount: 7, type: "fire" }, target)).toBe(3);
  });

  it("doubles vulnerable damage", () => {
    expect(adjustDamageForDefenses({ amount: 7, type: "cold" }, target)).toBe(14);
  });

  it("zeroes immune damage", () => {
    expect(adjustDamageForDefenses({ amount: 100, type: "poison" }, target)).toBe(0);
  });

  it("leaves untyped-against damage alone", () => {
    expect(adjustDamageForDefenses({ amount: 7, type: "slashing" }, target)).toBe(7);
  });

  it("applies vulnerability before resistance when a creature somehow has both", () => {
    const both = combatant({ resistances: ["fire"], vulnerabilities: ["fire"] });
    // 7 doubled to 14, then halved back to 7 — not 7 halved to 3 then doubled to 6.
    expect(adjustDamageForDefenses({ amount: 7, type: "fire" }, both)).toBe(7);
  });

  it("halves everything for a petrified creature", () => {
    const petrified = combatant({ conditions: ["petrified"] });
    expect(adjustDamageForDefenses({ amount: 9, type: "slashing" }, petrified)).toBe(4);
  });
});

describe("applyDamage", () => {
  it("spends temporary hit points first", () => {
    const result = applyDamage(combatant({ tempHp: 5 }), { amount: 8, type: "slashing" });
    expect(result.absorbedByTempHp).toBe(5);
    expect(result.appliedToHp).toBe(3);
    expect(result.patch.tempHp).toBe(0);
    expect(result.patch.hpCurrent).toBe(17);
  });

  it("floors hit points at zero rather than going negative", () => {
    const result = applyDamage(combatant({ hpCurrent: 4 }), { amount: 10, type: "slashing" });
    expect(result.patch.hpCurrent).toBe(0);
    expect(result.droppedToZero).toBe(true);
  });

  it("kills outright when the leftover damage meets max hit points", () => {
    const pc = combatant({ hpCurrent: 10, hpMax: 20, isPlayerCharacter: true });
    const result = applyDamage(pc, { amount: 30, type: "slashing" });
    expect(result.instantDeath).toBe(true);
    expect(result.patch.defeated).toBe(true);
  });

  it("does not kill outright when the leftover is one short of max hit points", () => {
    const pc = combatant({ hpCurrent: 10, hpMax: 20, isPlayerCharacter: true });
    const result = applyDamage(pc, { amount: 29, type: "slashing" });
    expect(result.instantDeath).toBe(false);
    expect(result.patch.defeated).toBeUndefined();
    expect(result.patch.hpCurrent).toBe(0);
  });

  it("drops a monster at 0 hit points instead of making death saves", () => {
    const monster = combatant({ hpCurrent: 3, isPlayerCharacter: false });
    expect(applyDamage(monster, { amount: 5, type: "slashing" }).patch.defeated).toBe(true);
  });

  it("costs a death save failure when a downed character is hit", () => {
    const downed = combatant({ hpCurrent: 0, isPlayerCharacter: true });
    const result = applyDamage(downed, { amount: 5, type: "slashing" });
    expect(result.deathSaveFailuresAdded).toBe(1);
    expect(result.patch.deathFailures).toBe(1);
  });

  it("costs two failures when the hit on a downed character is a critical", () => {
    const downed = combatant({ hpCurrent: 0, isPlayerCharacter: true });
    const result = applyDamage(downed, { amount: 5, type: "slashing" }, { critical: true });
    expect(result.deathSaveFailuresAdded).toBe(2);
    expect(result.patch.deathFailures).toBe(2);
  });

  it("kills a downed character already on one failure struck by a critical", () => {
    const downed = combatant({ hpCurrent: 0, deathFailures: 1, isPlayerCharacter: true });
    const result = applyDamage(downed, { amount: 5, type: "slashing" }, { critical: true });
    expect(result.patch.deathFailures).toBe(3);
    expect(result.patch.defeated).toBe(true);
  });

  it("clears death saves and concentration on dropping to zero", () => {
    const pc = combatant({
      hpCurrent: 5,
      deathSuccesses: 2,
      isPlayerCharacter: true,
      concentration: { spellIndex: "bless", spellName: "Bless", level: 1 },
    });
    const result = applyDamage(pc, { amount: 5, type: "slashing" });
    expect(result.patch.deathSuccesses).toBe(0);
    expect(result.patch.concentration).toBeNull();
  });

  it("asks for a concentration check sized to the damage taken", () => {
    const caster = combatant({
      hpCurrent: 60,
      hpMax: 60,
      concentration: { spellIndex: "bless", spellName: "Bless", level: 1 },
    });
    expect(applyDamage(caster, { amount: 7, type: "fire" }).concentrationCheckDc).toBe(10);
    expect(applyDamage(caster, { amount: 30, type: "fire" }).concentrationCheckDc).toBe(15);
  });

  it("ends concentration outright rather than asking for a check when dropped to zero", () => {
    const caster = combatant({
      hpCurrent: 5,
      concentration: { spellIndex: "bless", spellName: "Bless", level: 1 },
    });
    const result = applyDamage(caster, { amount: 30, type: "fire" });
    expect(result.concentrationCheckDc).toBeNull();
    expect(result.patch.concentration).toBeNull();
  });

  it("asks for no concentration check when the target is not concentrating", () => {
    expect(applyDamage(combatant(), { amount: 30, type: "fire" }).concentrationCheckDc).toBeNull();
  });
});

describe("concentrationDc", () => {
  it.each([
    [1, 10],
    [19, 10],
    [20, 10],
    [21, 10],
    [22, 11],
    [50, 25],
  ])("damage %i gives DC %i", (damage, dc) => {
    expect(concentrationDc(damage)).toBe(dc);
  });
});

describe("healing and temporary hit points", () => {
  it("does not heal past maximum", () => {
    expect(applyHealing(combatant({ hpCurrent: 18 }), 10).hpCurrent).toBe(20);
  });

  it("revives a downed character and clears their death saves", () => {
    const downed = combatant({
      hpCurrent: 0,
      deathFailures: 2,
      conditions: ["unconscious"],
      isPlayerCharacter: true,
    });
    const patch = applyHealing(downed, 4);
    expect(patch.hpCurrent).toBe(4);
    expect(patch.deathFailures).toBe(0);
    expect(patch.conditions).not.toContain("unconscious");
  });

  it("does not heal the dead", () => {
    expect(applyHealing(combatant({ defeated: true, hpCurrent: 0 }), 10)).toEqual({});
  });

  it("keeps the larger pool of temporary hit points rather than stacking", () => {
    expect(applyTempHp(combatant({ tempHp: 8 }), 5)).toEqual({});
    expect(applyTempHp(combatant({ tempHp: 5 }), 8)).toEqual({ tempHp: 8 });
  });
});

describe("saving throws", () => {
  it("succeeds when the total meets the DC", () => {
    const result = resolveSave(
      { ability: "dex", modifier: 3, dc: 15, creature: healthy },
      scriptedRng([12]),
    );
    expect(result.success).toBe(true);
  });

  it("auto-fails Strength and Dexterity saves while paralyzed", () => {
    const paralyzed = { conditions: ["paralyzed"], exhaustion: 0 };
    for (const ability of ["str", "dex"] as const) {
      const result = resolveSave({ ability, modifier: 10, dc: 5, creature: paralyzed });
      expect(result.autoFailed).toBe(true);
      expect(result.success).toBe(false);
      expect(result.roll).toBeNull();
    }
  });

  it("still rolls Wisdom saves while paralyzed", () => {
    const result = resolveSave(
      { ability: "wis", modifier: 3, dc: 10, creature: { conditions: ["paralyzed"], exhaustion: 0 } },
      scriptedRng([12]),
    );
    expect(result.autoFailed).toBe(false);
    expect(result.success).toBe(true);
  });

  it("gives disadvantage on Dexterity saves while restrained", () => {
    const result = resolveSave(
      {
        ability: "dex",
        modifier: 0,
        dc: 10,
        creature: { conditions: ["restrained"], exhaustion: 0 },
      },
      scriptedRng([18, 4]),
    );
    expect(result.advantage).toBe("disadvantage");
    expect(result.total).toBe(4);
  });

  it("gives disadvantage on all saves at exhaustion 3", () => {
    const result = resolveSave(
      { ability: "con", modifier: 0, dc: 10, creature: { conditions: [], exhaustion: 3 } },
      scriptedRng([18, 4]),
    );
    expect(result.advantage).toBe("disadvantage");
  });
});

describe("death saving throws", () => {
  it("counts a 10 as a success", () => {
    const result = rollDeathSave(combatant({ hpCurrent: 0 }), scriptedRng([10]));
    expect(result.result).toBe("success");
    expect(result.patch.deathSuccesses).toBe(1);
  });

  it("counts a 9 as a failure", () => {
    const result = rollDeathSave(combatant({ hpCurrent: 0 }), scriptedRng([9]));
    expect(result.result).toBe("failure");
    expect(result.patch.deathFailures).toBe(1);
  });

  it("revives at 1 hit point on a natural 20", () => {
    const downed = combatant({ hpCurrent: 0, deathFailures: 2, conditions: ["unconscious"] });
    const result = rollDeathSave(downed, scriptedRng([20]));
    expect(result.revived).toBe(true);
    expect(result.patch.hpCurrent).toBe(1);
    expect(result.patch.deathFailures).toBe(0);
    expect(result.patch.conditions).not.toContain("unconscious");
  });

  it("counts a natural 1 as two failures", () => {
    const result = rollDeathSave(combatant({ hpCurrent: 0 }), scriptedRng([1]));
    expect(result.patch.deathFailures).toBe(2);
    expect(result.dead).toBe(false);
  });

  it("kills on a natural 1 when already on two failures", () => {
    const result = rollDeathSave(combatant({ hpCurrent: 0, deathFailures: 2 }), scriptedRng([1]));
    expect(result.patch.deathFailures).toBe(3);
    expect(result.dead).toBe(true);
    expect(result.patch.defeated).toBe(true);
  });

  it("stabilises on the third success without restoring hit points", () => {
    const result = rollDeathSave(combatant({ hpCurrent: 0, deathSuccesses: 2 }), scriptedRng([15]));
    expect(result.stabilized).toBe(true);
    expect(result.patch.stable).toBe(true);
    expect(result.patch.hpCurrent).toBeUndefined();
  });

  it("ignores any modifier — a death save is a flat d20", () => {
    const result = rollDeathSave(combatant({ hpCurrent: 0 }), scriptedRng([9]));
    expect(result.roll.modifier).toBe(0);
    expect(result.roll.total).toBe(9);
  });
});

describe("initiative order", () => {
  it("sorts by initiative, then Dexterity, then name", () => {
    const order = sortInitiative([
      { id: "c", name: "Cleric", initiative: 12, tiebreak: 10 },
      { id: "a", name: "Archer", initiative: 18, tiebreak: 16 },
      { id: "b", name: "Bandit", initiative: 12, tiebreak: 14 },
      { id: "d", name: "Adept", initiative: 12, tiebreak: 14 },
    ]);
    expect(order.map((e) => e.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const input = [
      { id: "a", name: "A", initiative: 1, tiebreak: 1 },
      { id: "b", name: "B", initiative: 2, tiebreak: 2 },
    ];
    sortInitiative(input);
    expect(input.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("rollWeaponDamage", () => {
  it("doubles only the dice on a critical", () => {
    const { roll, packet } = rollWeaponDamage(
      { damageDice: "1d8", damageBonus: 3, damageType: "slashing" },
      { critical: true },
      scriptedRng([8, 8]),
    );
    expect(roll.dice).toHaveLength(2);
    expect(packet).toEqual({ amount: 19, type: "slashing" });
  });

  it("adds extra dice such as sneak attack", () => {
    const { packet } = rollWeaponDamage(
      { damageDice: "1d6", damageBonus: 3, damageType: "piercing" },
      { extraDice: "2d6" },
      scriptedRng([4, 5, 6]),
    );
    expect(packet.amount).toBe(18);
  });
});
