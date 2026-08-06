"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { decideScroll, isNearBottom, scrollsItself } from "@/lib/stick-to-bottom";

/**
 * Keeps a log parked on the newest entry.
 *
 * Watches the element rather than taking a dependency list, because the things
 * that move a log are not all state changes the caller can name: entries
 * streaming in, the DM's "thinking" line appearing, a panel coming back from
 * `display: none` when someone switches tabs, a phone keyboard opening. A
 * mutation and a resize observer between them see all of it; an
 * `[entries.length]` dependency sees only the first.
 *
 * What gets scrolled is decided per call, not assumed. The story log has
 * `overflow-y-auto` but no height to overflow on a phone, so the document is
 * the real scroller there, while the chat log is capped by `max-h-80` and
 * scrolls itself. Picking the wrong one is a silent no-op.
 *
 * The element arrives through a callback ref rather than a `useRef`, because
 * the log is not in the tree on first render — it appears with the campaign
 * state. A plain ref would leave the setup effect running once against nothing
 * and never firing again.
 */
export function useStickToBottom<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const following = useRef(true);
  const wasVisible = useRef(false);
  const placed = useRef(false);
  const frame = useRef<number | null>(null);

  /** The thing that actually moves: the log itself, or the page around it. */
  const scroller = useCallback((): Element | null => {
    if (!node) return null;
    return scrollsItself(node) ? node : node.ownerDocument.scrollingElement;
  }, [node]);

  const settle = useCallback(() => {
    if (!node) return;

    // `display: none` leaves no layout box at all, which is exactly how the
    // mobile tab bar hides a panel.
    const visible = node.offsetParent !== null && node.clientHeight > 0;

    const move = decideScroll({
      visible,
      wasVisible: wasVisible.current,
      placed: placed.current,
      following: following.current,
    });
    wasVisible.current = visible;

    if (move === "stay") return;

    const target = scroller();
    if (!target) return;

    target.scrollTo({
      top: target.scrollHeight,
      behavior: move === "smooth" ? "smooth" : "auto",
    });

    // Only count it as parked once there was something to scroll; otherwise an
    // empty log marks itself placed and the first real batch slides in.
    if (target.scrollHeight > target.clientHeight) placed.current = true;
  }, [node, scroller]);

  // Bursts of mutations during a render should cost one scroll, not twenty.
  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      settle();
    });
  }, [settle]);

  /**
   * Whether to keep following depends on where the reader left the log, so it
   * has to be sampled as they scroll. Programmatic scrolling fires this too; a
   * smooth scroll reads as "not following" mid-flight and corrects itself on
   * the final event, having arrived at the bottom.
   */
  const sample = useCallback(() => {
    const target = scroller();
    if (target) following.current = isNearBottom(target);
  }, [scroller]);

  useEffect(() => {
    if (!node) return;

    settle();

    const observers: { disconnect: () => void }[] = [];
    if (typeof ResizeObserver !== "undefined") {
      // Fires when the panel goes from no box to a box — i.e. becomes visible.
      const resize = new ResizeObserver(schedule);
      resize.observe(node);
      observers.push(resize);
    }
    if (typeof MutationObserver !== "undefined") {
      const mutation = new MutationObserver(schedule);
      mutation.observe(node, { childList: true, subtree: true, characterData: true });
      observers.push(mutation);
    }

    // When the page is the scroller, the log's own onScroll never fires.
    const view = node.ownerDocument.defaultView;
    view?.addEventListener("scroll", sample, { passive: true });

    return () => {
      for (const observer of observers) observer.disconnect();
      view?.removeEventListener("scroll", sample);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [node, settle, schedule, sample]);

  return { ref: setNode, onScroll: sample };
}
