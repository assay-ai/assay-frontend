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
 *   after a fresh pointer (or key) event that happened after those 500 ms;
 * - a click acts only when its own interaction (pointerdown or keydown)
 *   started after the buttons armed, so a click already on its way when the
 *   page appeared, or the press that armed them, never lands on Approve.
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

/** Events that arm the buttons once the delay is over. */
const ARMING_EVENTS = ["pointermove", "pointerdown", "keydown"] as const;
/** Events that start an interaction: a click acts only if one of these began after arming. */
const START_EVENTS = ["pointerdown", "keydown"] as const;

export interface ActivationState {
  /** Buttons are enabled. */
  armed: boolean;
  /** The page is inside a frame: it never arms. */
  framed: boolean;
  /**
   * Whether the click being handled may act: armed, and its interaction (a
   * pointerdown or keydown) started after the buttons armed. The pointerdown
   * that arms the buttons, or one that began before, never acts: on a touch
   * screen the first tap arms and the second one acts.
   */
  canAct: () => boolean;
}

/** The guard as a hook: `armed` is false until every condition above holds. */
export function useConsentActivation(): ActivationState {
  const [framed, setFramed] = React.useState(false);
  const [armed, setArmed] = React.useState(false);
  // Interaction sequence numbers: a counter, not event timestamps, so two
  // events in the same millisecond still have an order.
  const seq = React.useRef(0);
  const lastStart = React.useRef(0);
  const armedAt = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!isTopLevel()) {
      setFramed(true);
      setArmed(false);
      armedAt.current = null;
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let listening = false;

    const onStart = () => {
      seq.current += 1;
      lastStart.current = seq.current;
    };
    const onArmingInput = () => {
      if (!listening) return;
      stopListening();
      armedAt.current = seq.current;
      setArmed(true);
    };
    const stopListening = () => {
      if (!listening) return;
      listening = false;
      for (const type of ARMING_EVENTS) window.removeEventListener(type, onArmingInput, true);
    };
    const disarm = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      stopListening();
      armedAt.current = null;
      setArmed(false);
    };
    const start = () => {
      disarm();
      timer = setTimeout(() => {
        timer = null;
        listening = true;
        for (const type of ARMING_EVENTS) window.addEventListener(type, onArmingInput, true);
      }, ACTIVATION_DELAY_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else disarm();
    };

    // Registered first, so a start event is counted before it can arm.
    for (const type of START_EVENTS) window.addEventListener(type, onStart, true);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      for (const type of START_EVENTS) window.removeEventListener(type, onStart, true);
      if (timer !== null) clearTimeout(timer);
      stopListening();
    };
  }, []);

  const canAct = React.useCallback(
    () => !framed && armedAt.current !== null && lastStart.current > armedAt.current,
    [framed],
  );

  return { armed: armed && !framed, framed, canAct };
}
