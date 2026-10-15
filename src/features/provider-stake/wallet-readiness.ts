"use client";

import * as React from "react";

import type { WalletStep } from "@/components/patterns/wallet-steps";

/**
 * Two things every provider wallet sheet (Stake, Withdraw, Dispute) needs
 * beyond `useSigner`'s five states:
 *
 * - **A wallet read that never ends is a state, not a spinner.** `hydrating`
 *   is right for a moment; if Privy has still not listed the wallets after
 *   `WALLET_READ_STALL_MS`, the person gets a reason and a next step instead
 *   of "Reading…" for ever.
 * - **DEMO ONLY: simulated signing.** The demo has no wallet session, so the
 *   review steps could never be reached. With the build-time demo flag on, the
 *   sheets run `simulatedSteps` instead: same step names, same tracker, no
 *   wallet asked, nothing sent. A real build never takes this path, and the
 *   real steps (and their signing guards) are untouched.
 */

export const WALLET_READ_STALL_MS = 8_000;

export const WALLET_READ_STALLED =
  "We could not read the wallets in this browser. Connect your stake wallet, or reload the page if it is already connected.";

/** True once `reading` has stayed true for `ms` without a break. */
export function useStalled(reading: boolean, ms: number = WALLET_READ_STALL_MS): boolean {
  const [stalled, setStalled] = React.useState(false);
  React.useEffect(() => {
    if (!reading) {
      setStalled(false);
      return;
    }
    const id = window.setTimeout(() => setStalled(true), ms);
    return () => window.clearTimeout(id);
  }, [reading, ms]);
  return reading && stalled;
}

/** The sentence under a disabled sign button while the wallet list is read. */
export const WALLET_READING = "Reading the wallets connected in this browser…";

export const DEMO_SIGNING_NOTE = "Demo: no wallet is asked and nothing is sent. The steps below only show what would happen.";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** DEMO ONLY: the same steps, walked through without a wallet. */
export function simulatedSteps(steps: readonly WalletStep[], delayMs = 700): WalletStep[] {
  return steps.map((step) => ({
    id: step.id,
    label: step.label,
    cost: step.cost,
    skip: step.skip,
    run: async ({ report }) => {
      report({ stage: "wallet" });
      await wait(delayMs);
      return { data: `demo:${step.id}` };
    },
  }));
}
