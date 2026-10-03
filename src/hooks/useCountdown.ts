"use client";

/**
 * One clock, counting down to an instant the server supplied.
 *
 * Every wait this app shows is bounded by a field the program stores as an
 * absolute time — `BuyerEscrow.withdraw_available_at`,
 * `SlashRecord.executable_at`. The durations behind them
 * (`WITHDRAW_DELAY_SECONDS`, `SLASH_DELAY_SECONDS`) are program constants, but
 * this hook still takes an instant and never a duration: the program compares
 * against the cluster's clock, and a browser that added its own hour to its own
 * clock would be wrong in the direction that tells a user to come back too
 * early.
 */

import * as React from "react";

/** Ticks once a minute. Nothing here is second-precision, and a 1s interval would rerender three panels a second for no gain. */
const TICK_MS = 60_000;

export function formatRemaining(msLeft: number): string {
  // Under a minute — including already-passed — is one label. "0m" reads as
  // "ready now", and acting on it means a transaction the program reverts.
  if (msLeft < 60_000) return "under a minute";

  const minutes = Math.floor(msLeft / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days >= 1) return `${days}d ${hours % 24}h`;
  if (hours >= 1) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

export function useCountdown(target: string | null | undefined): {
  msLeft: number | null;
  hasPassed: boolean;
} {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [target]);

  if (!target) return { msLeft: null, hasPassed: false };

  const at = new Date(target).getTime();
  // An unparseable instant is a backend contract break. Reporting it as
  // "passed" would invite the user to press a button that reverts, so report
  // it as unknown and let the caller render nothing.
  if (Number.isNaN(at)) return { msLeft: null, hasPassed: false };

  return { msLeft: at - now, hasPassed: at <= now };
}
