"use client";

import { useRef, useState } from "react";
import { ErrorNote } from "@/components/ui";

/**
 * Character portrait upload.
 *
 * Resized and re-encoded in the browser before it is sent, so a 6 MB phone
 * photo becomes a ~40 KB square rather than being rejected — players will be
 * uploading straight from a camera roll. The server enforces the real cap
 * regardless; this is a courtesy, not a control.
 */

const SIZE = 256;
const MAX_BYTES = 512 * 1024;

async function toSquareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not process that image.");

  // Centre crop to a square, then scale — faces sit in the middle of a photo.
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    SIZE,
    SIZE,
  );
  bitmap.close();

  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error("That image could not be made small enough. Try a simpler picture.");
}

export function PortraitUpload({
  characterId,
  name,
  hasPortrait,
}: {
  characterId: string;
  name: string;
  hasPortrait: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(hasPortrait ? 1 : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const blob = await toSquareWebp(file);
      const response = await fetch(`/api/characters/${characterId}/portrait`, {
        method: "PUT",
        headers: { "content-type": "image/webp" },
        body: blob,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Upload failed.");
      }
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        data-testid="portrait-button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-2)] transition hover:border-[var(--accent)] disabled:opacity-50"
        aria-label={`Change ${name}'s portrait`}
      >
        {version > 0 ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`/api/characters/${characterId}/portrait?v=${version}`}
            alt={`${name}'s portrait`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-lg font-semibold text-[var(--muted)]">
            {initials}
          </span>
        )}
      </button>

      <div className="min-w-0">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="text-sm font-medium text-[var(--accent)] hover:underline disabled:opacity-50"
        >
          {busy ? "Uploading…" : version > 0 ? "Change portrait" : "Add a portrait"}
        </button>
        <p className="text-xs text-[var(--muted)]">Cropped square, resized to 256px.</p>
        <ErrorNote>{error}</ErrorNote>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
