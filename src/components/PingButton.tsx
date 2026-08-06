"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui";

/**
 * "Anyone about?" — the one notification a player sends deliberately.
 *
 * The cooldown is enforced on the server; this only mirrors it, because a
 * disabled button stops nobody who can open a console.
 */
export function PingButton({ campaignId }: { campaignId: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const ping = async () => {
    setBusy(true);
    setNote("");
    try {
      const result = await api<{ recipients: number; discord: boolean; push: number }>(
        `/api/campaigns/${campaignId}/ping`,
        { method: "POST", json: {} },
      );
      // Say what actually happened. "Sent!" when it reached nobody is how you
      // end up waiting an hour for a reply that was never going to come.
      setNote(
        result.recipients === 0
          ? "Nobody has notifications on yet."
          : `Pinged ${result.recipients} ${result.recipients === 1 ? "player" : "players"}.`,
      );
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Button variant="secondary" disabled={busy} onClick={() => void ping()}>
        {busy ? "Pinging…" : "Ping the table"}
      </Button>
      {note && <p className="mt-2 text-xs text-[var(--muted)]">{note}</p>}
    </div>
  );
}
