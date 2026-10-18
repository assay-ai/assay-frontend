"use client";

import * as React from "react";

/**
 * The consent page's click guards (spec §6.5, T8).
 *
 * `_headers` already refuses framing on `/connect/*` (`frame-ancestors 'none'`,
 * `X-Frame-Options: DENY`). These are the in-page half, for a browser or a
 * host that ignores the headers, and for a page opened in a pop-up under a
 * cursor that is already clicking:
 *
 * - the buttons stay disabled unless the page is the top-level window;
 * - they enable only 500 ms after the page becomes visible, and then only
 *   after a fresh pointer (or key) event that happened after those 500 ms, so
 *   a click already on its way when the page appeared never lands on Approve.
 *   Hiding the page disarms them and starts over.
 */

export const ACTIVATION_DELAY_MS = 500;

/** Whether `win` is the top-level browsing context. A cross-origin parent that throws counts as framed. */
export function isTopLevel(win: Window = window): boolean {
  try {
    return win.top === win.self;
  } catch {
    return false;
  }
}

const FRESH_INPUT_EVENTS = ["pointermove", "pointerdown", "keydown"] as const;

export interface ActivationState {
  /** Buttons may act. */
  armed: boolean;
  /** The page is inside a frame: it never arms. */
  framed: boolean;
}

/** The guard as a hook: `armed` is false until every condition above holds. */
export function useConsentActivation(): ActivationState {
  const [framed, setFramed] = React.useState(false);
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    if (!isTopLevel()) {
      setFramed(true);
      setArmed(false);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let listening = false;

    const onFreshInput = () => {
      stopListening();
      setArmed(true);
    };
    const stopListening = () => {
      if (!listening) return;
      listening = false;
      for (const type of FRESH_INPUT_EVENTS) window.removeEventListener(type, onFreshInput, true);
    };
    const disarm = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      stopListening();
      setArmed(false);
    };
    const start = () => {
      disarm();
      timer = setTimeout(() => {
        timer = null;
        listening = true;
        for (const type of FRESH_INPUT_EVENTS) window.addEventListener(type, onFreshInput, true);
      }, ACTIVATION_DELAY_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else disarm();
    };

    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer !== null) clearTimeout(timer);
      stopListening();
    };
  }, []);

  return { armed: armed && !framed, framed };
}
