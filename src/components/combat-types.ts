/**
 * The shape of an encounter as the play screen receives it.
 *
 * These mirror `EncounterView` on the server. They are deliberately read-only
 * descriptions of state the server owns — nothing here is authoritative.
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

export type MapShape = {
  width: number;
  height: number;
  cellSizeFt: number;
  terrain: {
    walls?: [number, number][];
    difficult?: [number, number][];
    cover?: Record<string, string>;
  };
  background: string | null;
};

export type Encounter = {
  id: string;
  name: string;
  status: string;
  round: number;
  activeCombatantId: string | null;
  combatants: Combatant[];
  map: MapShape | null;
};
