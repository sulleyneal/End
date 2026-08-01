"use client";

type Roll = {
  id: string;
  actorName: string;
  kind: string;
  formula: string;
  dice: { sides: number; value: number; kept: boolean }[];
  modifier: number;
  advantage: string;
  total: number;
  dc: number | null;
  outcome: string | null;
};

/**
 * The audit trail.
 *
 * Every die the server rolled, with its individual faces — including the ones
 * discarded by advantage. This is what makes the game checkable: a player can
 * always see exactly what was rolled and what it was rolled against.
 */
export function DiceLog({ rolls }: { rolls: Roll[] }) {
  const recent = [...rolls].reverse().slice(0, 25);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        Dice
      </h2>
      {recent.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No dice rolled yet.</p>
      ) : (
        <ul className="space-y-2">
          {recent.map((roll) => (
            <li key={roll.id} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{roll.actorName}</span>
                <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                  {roll.kind.replace("_", " ")}
                </span>
              </div>
              <p className="text-[var(--muted)] tabular">
                {roll.dice.map((die, i) => (
                  <span
                    key={i}
                    className={
                      die.kept
                        ? "mr-1 inline-block rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-medium text-[var(--foreground)]"
                        : "mr-1 inline-block rounded px-1.5 py-0.5 line-through opacity-50"
                    }
                    title={die.kept ? `d${die.sides}` : `d${die.sides}, discarded`}
                  >
                    {die.value}
                  </span>
                ))}
                {roll.modifier !== 0 && (
                  <span className="mr-1">
                    {roll.modifier > 0 ? "+" : "−"}
                    {Math.abs(roll.modifier)}
                  </span>
                )}
                <span className="font-semibold text-[var(--foreground)]">= {roll.total}</span>
                {roll.dc !== null && <span> vs DC {roll.dc}</span>}
              </p>
              {roll.outcome && (
                <p
                  className="text-xs font-medium capitalize"
                  style={{
                    color: /success|hit|critical/.test(roll.outcome)
                      ? "var(--success)"
                      : /fail|miss/.test(roll.outcome)
                        ? "var(--danger)"
                        : "var(--muted)",
                  }}
                >
                  {roll.outcome}
                  {roll.advantage !== "normal" && ` · ${roll.advantage}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
