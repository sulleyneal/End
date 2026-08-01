"use client";

import { useEffect, useState } from "react";

/**
 * The 3D dice tray.
 *
 * It animates a roll that has *already happened*. The server rolled the dice
 * with crypto.randomInt and persisted the faces before this component ever saw
 * them; the tumble is choreography over a known result, and the die settles on
 * the face the server recorded. There is no path here that can produce a
 * number, which is the whole point — a dice animation that rolled its own value
 * would be a second source of truth.
 *
 * Built from CSS 3D transforms rather than a WebGL library: it is a few
 * kilobytes, needs no asset pipeline or WASM, runs on a phone, and cannot
 * desync from the server because the final face is an input.
 */

export type TrayDie = { sides: number; value: number; kept: boolean };

/**
 * Rotations that bring each face of a d6 to the front. Other dice are drawn as
 * a spinning polygon showing their number — a faithful d20 solid in CSS is a
 * lot of geometry for very little gain on a phone screen.
 */
const D6_FACE_ROTATION: Record<number, string> = {
  1: "rotateX(0deg) rotateY(0deg)",
  2: "rotateY(-90deg)",
  3: "rotateX(-90deg)",
  4: "rotateX(90deg)",
  5: "rotateY(90deg)",
  6: "rotateY(180deg)",
};

export function DiceTray({
  dice,
  total,
  label,
  onDone,
}: {
  dice: TrayDie[];
  total: number;
  label?: string;
  onDone?: () => void;
}) {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    setSettled(false);
    const tumble = setTimeout(() => setSettled(true), 900);
    const finish = setTimeout(() => onDone?.(), 3200);
    return () => {
      clearTimeout(tumble);
      clearTimeout(finish);
    };
    // A new set of dice restarts the animation.
  }, [dice, onDone]);

  if (dice.length === 0) return null;

  return (
    <div
      data-testid="dice-tray"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-3 lg:bottom-10"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-center gap-2">
        {dice.map((die, index) => (
          <Die key={index} die={die} index={index} settled={settled} />
        ))}
      </div>

      <div
        className={`rounded-full bg-[var(--surface)] px-4 py-1.5 text-sm font-semibold shadow-lg ring-1 ring-[var(--border)] transition-opacity duration-300 ${
          settled ? "opacity-100" : "opacity-0"
        }`}
      >
        {label ? `${label}: ` : ""}
        <span className="tabular">{total}</span>
      </div>
    </div>
  );
}

function Die({ die, index, settled }: { die: TrayDie; index: number; settled: boolean }) {
  const dropped = !die.kept;

  if (die.sides === 6) {
    return (
      <div
        className="h-12 w-12"
        style={{ perspective: "300px", opacity: dropped && settled ? 0.35 : 1 }}
      >
        <div
          className="relative h-full w-full transition-transform duration-700 ease-out"
          style={{
            transformStyle: "preserve-3d",
            transform: settled
              ? D6_FACE_ROTATION[die.value] ?? "none"
              : `rotateX(${540 + index * 60}deg) rotateY(${720 + index * 45}deg)`,
          }}
        >
          {[1, 2, 3, 4, 5, 6].map((face) => (
            <span
              key={face}
              className="absolute inset-0 flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold"
              style={{ transform: `${inverse(face)} translateZ(24px)`, backfaceVisibility: "hidden" }}
            >
              {face}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-12 w-12" style={{ perspective: "300px", opacity: dropped && settled ? 0.35 : 1 }}>
      <div
        className="flex h-full w-full items-center justify-center border border-[var(--border)] bg-[var(--surface)] text-sm font-bold shadow-md transition-transform duration-700 ease-out"
        style={{
          clipPath:
            die.sides === 20
              ? "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)"
              : die.sides === 4
                ? "polygon(50% 0%, 100% 100%, 0% 100%)"
                : "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
          transform: settled
            ? "rotate(0deg) scale(1)"
            : `rotate(${360 + index * 90}deg) scale(0.85)`,
        }}
      >
        <span style={{ transform: die.sides === 4 ? "translateY(4px)" : "none" }}>{die.value}</span>
      </div>
    </div>
  );
}

/** The rotation that puts a given d6 face outward on the cube. */
function inverse(face: number): string {
  switch (face) {
    case 1:
      return "rotateY(0deg)";
    case 2:
      return "rotateY(90deg)";
    case 3:
      return "rotateX(90deg)";
    case 4:
      return "rotateX(-90deg)";
    case 5:
      return "rotateY(-90deg)";
    default:
      return "rotateY(180deg)";
  }
}
