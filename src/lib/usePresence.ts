"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Presence } from "@/lib/presence";

export type PresentMember = {
  userId: string;
  displayName: string;
  role: string;
  characterName: string | null;
  lastActiveAt: string | null;
  presence: Presence;
};

/**
 * How often to ask who is here.
 *
 * Polled rather than streamed on purpose. Arriving is an event and could ride
 * the SSE feed, but leaving never is — a closed laptop sends nothing — so the
 * only thing that can notice an absence is a clock. Since the departure half
 * has to be a poll regardless, both halves use it and there is one mechanism
 * instead of two that can disagree.
 */
const POLL_MS = 20_000;

export function usePresence(campaignId: string) {
  const [members, setMembers] = useState<PresentMember[]>([]);
  const live = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const result = await api<{ members: PresentMember[] }>(
        `/api/campaigns/${campaignId}/presence`,
      );
      // A response landing after unmount must not write to a dead component.
      if (live.current) setMembers(result.members);
    } catch {
      // Keep the last known roster rather than blanking the table on a blip.
    }
  }, [campaignId]);

  useEffect(() => {
    live.current = true;
    // `refresh` is async, so the state write happens in a later microtask, not
    // synchronously during the effect — the cascading-render the rule guards
    // against cannot occur here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);

    // Phones suspend timers in a backgrounded tab, so a player returning to the
    // app would otherwise stare at a roster frozen from whenever they left.
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      live.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const online = members.filter((m) => m.presence === "online");
  return { members, online, onlineCount: online.length, refresh };
}
