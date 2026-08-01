"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tails a campaign's event log.
 *
 * The cursor is the whole point: it lives in a ref that survives re-renders and
 * reconnects, so a dropped connection — or a phone locking and waking — resumes
 * from the last event actually received rather than from "now". Refreshing
 * mid-combat loses nothing.
 */

export type GameEvent = {
  id: number;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type StreamStatus = "connecting" | "live" | "reconnecting";

export function useEventStream(
  campaignId: string,
  onEvent: (event: GameEvent) => void,
  options: { since?: number } = {},
) {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const cursor = useRef(options.since ?? 0);
  // Keep the latest handler without re-opening the stream on every render.
  // Assigning during render would be a side effect in the render phase.
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      source = new EventSource(
        `/api/campaigns/${campaignId}/stream?since=${cursor.current}`,
      );

      source.onopen = () => setStatus("live");

      // Every game event is sent with an `event:` name, so a named listener
      // covers all of them. Adding `onmessage` as well would double-fire the
      // ones literally named "message".
      const forward = (message: MessageEvent) => {
        try {
          const event = JSON.parse(message.data) as GameEvent;
          if (typeof event.seq === "number") cursor.current = event.seq;
          handler.current(event);
        } catch {
          // A malformed frame should not tear down the stream.
        }
      };

      for (const type of EVENT_TYPES) {
        source.addEventListener(type, forward as EventListener);
      }

      source.addEventListener("reconnect", () => {
        // The server is recycling the connection; come straight back.
        source?.close();
        setStatus("reconnecting");
        connect();
      });

      source.onerror = () => {
        source?.close();
        if (closed) return;
        setStatus("reconnecting");
        retry = setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [campaignId]);

  return { status, cursor };
}

const EVENT_TYPES = [
  "message",
  "roll",
  "character.created",
  "character.updated",
  "encounter.started",
  "encounter.updated",
  "encounter.ended",
  "combatant.updated",
  "turn.changed",
  "token.moved",
  "map.updated",
  "member.joined",
  "campaign.updated",
  "dm.thinking",
  "async.submitted",
] as const;
