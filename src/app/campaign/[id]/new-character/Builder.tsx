"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, ErrorNote, Field, inputClass } from "@/components/ui";

/**
 * Level-1 character creation.
 *
 * The form only decides what is *offered*; the server re-validates every choice
 * on submit, so a tampered request cannot produce an illegal character. Ability
 * scores use the standard array, assigned by drag-free dropdowns.
 */

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
type Ability = (typeof ABILITIES)[number];

const ABILITY_NAMES: Record<Ability, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

type Options = {
  classes: {
    index: string;
    name: string;
    hitDie: number;
    savingThrows: string[];
    spellcastingAbility: string | null;
    spells: {
      cantripsKnown: number;
      spellsKnown: number | null;
      prepares: boolean;
      cantrips: { index: string; name: string; school: string }[];
      level1: { index: string; name: string; school: string; concentration: boolean }[];
    } | null;
    skills: { choose: number; options: string[] } | null;
    equipment: {
      block: number;
      description: string;
      options: {
        option: number;
        label: string;
        picks: { label: string; from: { index: string; name: string }[] }[];
      }[];
    }[];
  }[];
  races: {
    index: string;
    name: string;
    speed: number;
    abilityBonuses: { ability: string; bonus: number }[];
    subraces: { index: string; name: string }[];
    proficiencyChoice: { choose: number; options: string[] } | null;
  }[];
  skills: { index: string; name: string; ability: string }[];
};

export default function Builder({ campaignId }: { campaignId: string }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [name, setName] = useState("");
  const [classIndex, setClassIndex] = useState("fighter");
  const [raceIndex, setRaceIndex] = useState("human");
  const [subraceIndex, setSubraceIndex] = useState("");
  const [assignment, setAssignment] = useState<Record<Ability, number>>({
    str: 15,
    dex: 14,
    con: 13,
    int: 12,
    wis: 10,
    cha: 8,
  });
  const [skillChoices, setSkillChoices] = useState<string[]>([]);
  const [racePicks, setRacePicks] = useState<string[]>([]);
  const [equipment, setEquipment] = useState<Record<number, { option: number; picks: string[] }>>({});
  const [cantripPicks, setCantripPicks] = useState<string[]>([]);
  const [spellPicks, setSpellPicks] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Options>("/api/srd/options")
      .then(setOptions)
      .catch((e: Error) => setError(e.message));
  }, []);

  const classDoc = options?.classes.find((c) => c.index === classIndex);
  const raceDoc = options?.races.find((r) => r.index === raceIndex);
  const skillName = (index: string) =>
    options?.skills.find((s) => `skill-${s.index}` === index)?.name ?? index.replace("skill-", "");

  // Choices that belong to the previous class or race are reset during render
  // rather than in an effect, so the form never paints a stale combination —
  // a fighter's skills must not survive a switch to wizard even for one frame.
  const [lastClass, setLastClass] = useState(classIndex);
  if (lastClass !== classIndex) {
    setLastClass(classIndex);
    setSkillChoices([]);
    setCantripPicks([]);
    setSpellPicks([]);
    const defaults: Record<number, { option: number; picks: string[] }> = {};
    for (const block of classDoc?.equipment ?? []) {
      defaults[block.block] = {
        option: 0,
        picks: block.options[0].picks.map((p) => p.from[0]?.index ?? ""),
      };
    }
    setEquipment(defaults);
  }

  const [lastRace, setLastRace] = useState(raceIndex);
  if (lastRace !== raceIndex) {
    setLastRace(raceIndex);
    setSubraceIndex("");
    setRacePicks([]);
  }

  // The very first load has no previous class to diff against, so seed the
  // equipment defaults once the SRD options arrive.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !classDoc) return;
    seeded.current = true;
    const defaults: Record<number, { option: number; picks: string[] }> = {};
    for (const block of classDoc.equipment) {
      defaults[block.block] = {
        option: 0,
        picks: block.options[0].picks.map((p) => p.from[0]?.index ?? ""),
      };
    }
    setEquipment(defaults);
  }, [classDoc]);

  const arrayValid = useMemo(() => {
    const used = ABILITIES.map((a) => assignment[a]).sort((x, y) => y - x);
    return used.join(",") === [...STANDARD_ARRAY].join(",");
  }, [assignment]);

  // Prepared casters get modifier + level, so this moves as the player
  // reassigns ability scores. Known casters take the flat SRD number.
  const casting = classDoc?.spells ?? null;
  const castingAbility = classDoc?.spellcastingAbility as Ability | undefined;
  const castingMod = (() => {
    if (!castingAbility) return 0;
    const racial = (raceDoc?.abilityBonuses ?? [])
      .filter((b) => b.ability === castingAbility)
      .reduce((sum, b) => sum + b.bonus, 0);
    return Math.floor((assignment[castingAbility] + racial - 10) / 2);
  })();
  const cantripsNeeded = casting?.cantripsKnown ?? 0;
  const spellsNeeded = casting
    ? (casting.spellsKnown ?? (classIndex === "wizard" ? 6 : Math.max(1, castingMod + 1)))
    : 0;

  const skillsNeeded = classDoc?.skills?.choose ?? 0;
  const raceNeeded = raceDoc?.proficiencyChoice?.choose ?? 0;
  const ready =
    name.trim().length > 0 &&
    arrayValid &&
    skillChoices.length === skillsNeeded &&
    cantripPicks.length === cantripsNeeded &&
    spellPicks.length === spellsNeeded &&
    racePicks.length === raceNeeded;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/campaigns/${campaignId}/characters`, {
        method: "POST",
        json: {
          name,
          classIndex,
          raceIndex,
          subraceIndex: subraceIndex || null,
          scores: assignment,
          scoreMethod: "standard-array",
          skillChoices,
          cantripChoices: cantripsNeeded > 0 ? cantripPicks : undefined,
          spellChoices: spellsNeeded > 0 ? spellPicks : undefined,
          raceProficiencyChoices: raceNeeded > 0 ? racePicks : undefined,
          equipmentSelections: Object.entries(equipment).map(([block, sel]) => ({
            block: Number(block),
            option: sel.option,
            picks: sel.picks.filter(Boolean),
          })),
        },
      });
      window.location.href = `/campaign/${campaignId}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  if (!options) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <ErrorNote>{error}</ErrorNote>
        {!error && <p className="text-[var(--muted)]">Loading the rules…</p>}
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 py-8">
      <div>
        <Link href={`/campaign/${campaignId}`} className="text-sm text-[var(--muted)] hover:underline">
          ← Back to the table
        </Link>
        <h1 className="text-2xl font-semibold">Make a character</h1>
      </div>

      <Card className="grid gap-4">
        <Field label="Name">
          <input
            className={inputClass}
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="Roland Vahn"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Class">
            <select
              className={inputClass}
              value={classIndex}
              onChange={(e) => setClassIndex(e.target.value)}
            >
              {options.classes.map((c) => (
                <option key={c.index} value={c.index}>
                  {c.name} (d{c.hitDie})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Race">
            <select
              className={inputClass}
              value={raceIndex}
              onChange={(e) => setRaceIndex(e.target.value)}
            >
              {options.races.map((r) => (
                <option key={r.index} value={r.index}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {raceDoc && raceDoc.subraces.length > 0 && (
          <Field label="Subrace">
            <select
              className={inputClass}
              value={subraceIndex}
              onChange={(e) => setSubraceIndex(e.target.value)}
            >
              <option value="">None</option>
              {raceDoc.subraces.map((s) => (
                <option key={s.index} value={s.index}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {raceDoc && (
          <p className="text-sm text-[var(--muted)]">
            {raceDoc.name}: speed {raceDoc.speed} ft
            {raceDoc.abilityBonuses.length > 0 &&
              ` · ${raceDoc.abilityBonuses
                .map((b) => `${b.ability.toUpperCase()} +${b.bonus}`)
                .join(", ")}`}
          </p>
        )}
      </Card>

      <Card className="grid gap-3">
        <div>
          <h2 className="font-semibold">Ability scores</h2>
          <p className="text-sm text-[var(--muted)]">
            Standard array — assign 15, 14, 13, 12, 10 and 8. Racial bonuses are added on your
            sheet.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {ABILITIES.map((ability) => (
            <label key={ability} className="flex items-center justify-between gap-3">
              <span className="text-sm">{ABILITY_NAMES[ability]}</span>
              <select
                className={`${inputClass} w-24 tabular`}
                value={assignment[ability]}
                onChange={(e) =>
                  setAssignment((prev) => ({ ...prev, [ability]: Number(e.target.value) }))
                }
              >
                {STANDARD_ARRAY.map((score) => (
                  <option key={score} value={score}>
                    {score}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {!arrayValid && (
          <p className="text-sm text-[var(--danger)]">
            Use each of 15, 14, 13, 12, 10 and 8 exactly once.
          </p>
        )}
      </Card>

      {classDoc?.skills && (
        <Card className="grid gap-3">
          <h2 className="font-semibold">
            Skills — choose {classDoc.skills.choose}
            <span className="ml-2 text-sm font-normal text-[var(--muted)]">
              {skillChoices.length}/{classDoc.skills.choose}
            </span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {classDoc.skills.options.map((option) => {
              const chosen = skillChoices.includes(option);
              const full = skillChoices.length >= classDoc.skills!.choose;
              return (
                <button
                  key={option}
                  type="button"
                  disabled={!chosen && full}
                  onClick={() =>
                    setSkillChoices((prev) =>
                      chosen ? prev.filter((s) => s !== option) : [...prev, option],
                    )
                  }
                  className={`rounded-lg border px-3 py-1.5 text-sm transition disabled:opacity-30 ${
                    chosen
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-[var(--border)]"
                  }`}
                >
                  {skillName(option)}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {casting && (cantripsNeeded > 0 || spellsNeeded > 0) && (
        <Card className="grid gap-4">
          <div>
            <h2 className="font-semibold">Spells</h2>
            <p className="text-sm text-[var(--muted)]">
              {casting.prepares
                ? "You prepare these each day and can swap them on a long rest."
                : "These are the spells you know."}
            </p>
          </div>

          {cantripsNeeded > 0 && (
            <SpellPicker
              title="Cantrips"
              needed={cantripsNeeded}
              picks={cantripPicks}
              setPicks={setCantripPicks}
              spells={casting.cantrips}
            />
          )}

          {spellsNeeded > 0 && (
            <SpellPicker
              title={classIndex === "wizard" ? "Spellbook — level 1" : "Level 1 spells"}
              needed={spellsNeeded}
              picks={spellPicks}
              setPicks={setSpellPicks}
              spells={casting.level1}
            />
          )}
        </Card>
      )}

      {raceDoc?.proficiencyChoice && (
        <Card className="grid gap-3">
          <h2 className="font-semibold">
            {raceDoc.name} proficiencies — choose {raceDoc.proficiencyChoice.choose}
            <span className="ml-2 text-sm font-normal text-[var(--muted)]">
              {racePicks.length}/{raceDoc.proficiencyChoice.choose}
            </span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {raceDoc.proficiencyChoice.options.map((option) => {
              const chosen = racePicks.includes(option);
              const full = racePicks.length >= raceDoc.proficiencyChoice!.choose;
              return (
                <button
                  key={option}
                  type="button"
                  disabled={!chosen && full}
                  onClick={() =>
                    setRacePicks((prev) =>
                      chosen ? prev.filter((s) => s !== option) : [...prev, option],
                    )
                  }
                  className={`rounded-lg border px-3 py-1.5 text-sm transition disabled:opacity-30 ${
                    chosen
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-[var(--border)]"
                  }`}
                >
                  {skillName(option)}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {classDoc && classDoc.equipment.length > 0 && (
        <Card className="grid gap-4">
          <h2 className="font-semibold">Starting equipment</h2>
          {classDoc.equipment.map((block) => {
            const selected = equipment[block.block] ?? { option: 0, picks: [] };
            const option = block.options[selected.option] ?? block.options[0];
            return (
              <div key={block.block} className="grid gap-2">
                <p className="text-sm text-[var(--muted)]">{block.description}</p>
                {block.options.length > 1 && (
                  <select
                    className={inputClass}
                    value={selected.option}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setEquipment((prev) => ({
                        ...prev,
                        [block.block]: {
                          option: next,
                          picks: block.options[next].picks.map((p) => p.from[0]?.index ?? ""),
                        },
                      }));
                    }}
                  >
                    {block.options.map((o) => (
                      <option key={o.option} value={o.option}>
                        {o.label || `Option ${o.option + 1}`}
                      </option>
                    ))}
                  </select>
                )}
                {option?.picks.map((pick, i) => (
                  <select
                    key={i}
                    className={inputClass}
                    value={selected.picks[i] ?? ""}
                    onChange={(e) =>
                      setEquipment((prev) => {
                        const picks = [...(prev[block.block]?.picks ?? [])];
                        picks[i] = e.target.value;
                        return {
                          ...prev,
                          [block.block]: { option: selected.option, picks },
                        };
                      })
                    }
                  >
                    {pick.from.map((item) => (
                      <option key={item.index} value={item.index}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            );
          })}
        </Card>
      )}

      <ErrorNote>{error}</ErrorNote>

      <Button disabled={!ready || busy} onClick={() => void submit()} className="w-full">
        {busy ? "Creating…" : "Create character"}
      </Button>
    </main>
  );
}


/** A count-limited chip list, shared by the cantrip and spell steps. */
function SpellPicker({
  title,
  needed,
  picks,
  setPicks,
  spells,
}: {
  title: string;
  needed: number;
  picks: string[];
  setPicks: (fn: (prev: string[]) => string[]) => void;
  spells: { index: string; name: string; school: string; concentration?: boolean }[];
}) {
  const full = picks.length >= needed;
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">
        {title} — choose {needed}
        <span className="ml-2 font-normal text-[var(--muted)]">
          {picks.length}/{needed}
        </span>
      </h3>
      <div className="flex flex-wrap gap-2">
        {spells.map((spell) => {
          const chosen = picks.includes(spell.index);
          return (
            <button
              key={spell.index}
              type="button"
              data-testid="spell-option"
              disabled={!chosen && full}
              title={spell.school}
              onClick={() =>
                setPicks((prev) =>
                  chosen ? prev.filter((s) => s !== spell.index) : [...prev, spell.index],
                )
              }
              className={`rounded-lg border px-3 py-1.5 text-sm transition disabled:opacity-30 ${
                chosen
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-[var(--border)]"
              }`}
            >
              {spell.name}
              {spell.concentration && (
                <span className="ml-1.5 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  conc
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
