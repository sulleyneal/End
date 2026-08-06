"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { usePush } from "@/lib/usePush";
import { Button, ErrorNote, inputClass } from "@/components/ui";

type Prefs = {
  onTurn: boolean;
  onDm: boolean;
  onChat: boolean;
  onPing: boolean;
  discordUserId: string | null;
};

type Settings = {
  prefs: Prefs;
  discord: { configured: boolean; canEdit: boolean };
};

const LABELS: { key: keyof Omit<Prefs, "discordUserId">; label: string; hint: string }[] = [
  { key: "onTurn", label: "It's my turn", hint: "In combat, or when the DM is waiting on you." },
  { key: "onDm", label: "The DM responded", hint: "Someone acted and there is new story to read." },
  { key: "onPing", label: "Someone pings the table", hint: "A player asking if anyone is around." },
  { key: "onChat", label: "Table chat", hint: "Every message. Off by default — it adds up." },
];

const fetchSettings = (campaignId: string) =>
  api<Settings>(`/api/campaigns/${campaignId}/notifications`);

export function NotifyPanel({ campaignId }: { campaignId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [webhook, setWebhook] = useState("");
  const [discordId, setDiscordId] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const push = usePush();

  const load = useCallback(async () => {
    try {
      const next = await api<Settings>(`/api/campaigns/${campaignId}/notifications`);
      setSettings(next);
      setDiscordId(next.prefs.discordUserId ?? "");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [campaignId]);

  useEffect(() => {
    // `load` writes state, so it is called from a promise callback rather than
    // the effect body — see the same shape in usePush.
    let cancelled = false;
    fetchSettings(campaignId).then(
      (next) => {
        if (cancelled) return;
        setSettings(next);
        setDiscordId(next.prefs.discordUserId ?? "");
      },
      (e: Error) => {
        if (!cancelled) setError(e.message);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const patch = async (body: Record<string, unknown>, note: string) => {
    setError("");
    try {
      await api(`/api/campaigns/${campaignId}/notifications`, { method: "PATCH", json: body });
      setSaved(note);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!settings) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm text-[var(--muted)]">Loading notification settings…</p>
      </section>
    );
  }

  return (
    <section
      data-testid="notify-panel"
      className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
        Notifications
      </h2>

      <div className="space-y-2">
        {LABELS.map(({ key, label, hint }) => (
          <label key={key} className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={settings.prefs[key]}
              onChange={(e) => void patch({ [key]: e.target.checked }, "Saved")}
            />
            <span>
              {label}
              <span className="block text-xs text-[var(--muted)]">{hint}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="border-t border-[var(--border)] pt-4">
        <h3 className="text-sm font-medium">On this device</h3>
        <PushControl push={push} />
      </div>

      <div className="border-t border-[var(--border)] pt-4">
        <h3 className="text-sm font-medium">Discord</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {settings.discord.configured
            ? "This table posts to a Discord channel."
            : "Not connected. The DM can add a channel webhook."}
        </p>

        <label className="mt-3 block text-xs text-[var(--muted)]">
          Your Discord user ID — so a notification can @mention you
        </label>
        <div className="mt-1 flex gap-2">
          <input
            className={inputClass}
            placeholder="207939184985866240"
            inputMode="numeric"
            value={discordId}
            onChange={(e) => setDiscordId(e.target.value)}
          />
          <Button
            variant="secondary"
            onClick={() => void patch({ discordUserId: discordId }, "Linked")}
          >
            Save
          </Button>
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Discord → Settings → Advanced → Developer Mode, then right-click yourself and
          Copy User ID.
        </p>

        {settings.discord.canEdit && (
          <div className="mt-4">
            <label className="block text-xs text-[var(--muted)]">
              Channel webhook URL (DM only)
            </label>
            <div className="mt-1 flex gap-2">
              <input
                className={inputClass}
                type="password"
                placeholder="https://discord.com/api/webhooks/…"
                value={webhook}
                onChange={(e) => setWebhook(e.target.value)}
              />
              <Button
                variant="secondary"
                onClick={() => void patch({ discordWebhookUrl: webhook }, "Connected")}
              >
                Save
              </Button>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Discord → Channel settings → Integrations → Webhooks → New Webhook → Copy
              URL. Never shown again once saved.
            </p>
          </div>
        )}
      </div>

      {saved && <p className="text-xs text-[var(--success)]">{saved}</p>}
      <ErrorNote>{error}</ErrorNote>
    </section>
  );
}

function PushControl({ push }: { push: ReturnType<typeof usePush> }) {
  const { state, busy, error, enable, disable } = push;

  if (state === "loading") {
    return <p className="mt-1 text-xs text-[var(--muted)]">Checking…</p>;
  }

  if (state === "needs-install") {
    return (
      <p className="mt-1 text-xs text-[var(--muted)]">
        On iPhone, notifications only work once this is on your Home Screen. Tap Share,
        then <strong>Add to Home Screen</strong>, and open it from there.
      </p>
    );
  }

  if (state === "unsupported") {
    return (
      <p className="mt-1 text-xs text-[var(--muted)]">
        This browser cannot do push notifications. Discord still works.
      </p>
    );
  }

  if (state === "not-configured") {
    return (
      <p className="mt-1 text-xs text-[var(--muted)]">
        Push is not set up on this deployment yet.
      </p>
    );
  }

  if (state === "denied") {
    return (
      <p className="mt-1 text-xs text-[var(--muted)]">
        Notifications are blocked for this site. Re-allow them in your browser settings,
        then reload.
      </p>
    );
  }

  return (
    <div className="mt-2">
      <Button
        variant={state === "on" ? "secondary" : "primary"}
        disabled={busy}
        onClick={() => void (state === "on" ? disable() : enable())}
      >
        {busy ? "…" : state === "on" ? "Turn off on this device" : "Enable notifications"}
      </Button>
      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
