"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

/**
 * Browser push subscription, from the client's side.
 *
 * The states worth distinguishing are not just on/off. "Unsupported" and
 * "needs-install" both mean no notifications, but only one of them is the
 * player's to fix — an iPhone in Safari can subscribe *only* after the site is
 * added to the Home Screen, and saying so is the difference between a setting
 * that looks broken and one that tells you what to do.
 */
export type PushState =
  | "loading"
  | "unsupported"
  | "needs-install"
  | "not-configured"
  | "denied"
  | "off"
  | "on";

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS reports as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own flag, which predates the standard one.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * URL-safe base64 to the bytes the Push API insists on.
 *
 * Built on an explicit ArrayBuffer: a plain `Uint8Array` is typed over
 * `ArrayBufferLike`, which includes `SharedArrayBuffer` and so does not satisfy
 * `BufferSource`.
 */
function decodeKey(base64: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Works out where push stands, without touching React state. */
async function resolvePushState(): Promise<PushState> {
  if (typeof window === "undefined") return "loading";

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    // On iOS this is what a normal Safari tab looks like; installing to the
    // Home Screen is what unlocks it, so say that rather than "unsupported".
    return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  }

  try {
    const { publicKey } = await api<{ publicKey: string | null }>("/api/push");
    if (!publicKey) return "not-configured";
    if (Notification.permission === "denied") return "denied";
    const registration = await navigator.serviceWorker.getRegistration();
    const existing = await registration?.pushManager.getSubscription();
    return existing ? "on" : "off";
  } catch {
    return "unsupported";
  }
}

export function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    // Resolved first, stored second. Computing and assigning in one pass put a
    // synchronous setState in the effect body, because the unsupported branch
    // returns before the first await.
    resolvePushState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const sync = useCallback(async () => {
    setState(await resolvePushState());
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const { publicKey } = await api<{ publicKey: string | null }>("/api/push");
      if (!publicKey) throw new Error("Push is not configured on this deployment.");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(publicKey),
      });

      const json = subscription.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };
      await api("/api/push", { method: "POST", json });
      setState("on");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api("/api/push", {
          method: "DELETE",
          json: { endpoint: subscription.endpoint },
        });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, busy, error, enable, disable, refresh: sync };
}
