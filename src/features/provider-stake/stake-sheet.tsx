"use client";

import type * as React from "react";

import type { Money } from "@/interfaces";

/**
 * THE Stake sheet: one `WalletActionSheet` that every surface opens (Stake
 * page, wizard Go live, Home checklist and Needs-action strip).
 *
 * Steps inside: (1) "Confirm this wallet holds your stake" when the stake
 * wallet is not proved yet (chain from the connected wallet, no typing);
 * (2) the amount, prefilled with `amount` (or the shortfall) and a
 * recommended 1.5× chip; (3) approve + deposit with the signature tracker.
 */
export interface StakeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill: the amount to add (e.g. the shortfall for a binding about to go live). */
  amount?: Money | null;
  /** One line on why the stake is asked for here ("Your tool needs $100 to take paid calls"). */
  reason?: React.ReactNode;
  /** After the deposit is confirmed and the stake re-read. */
  onStaked?: () => void;
}

// STUB — the stake work replaces this with the real sheet.
export function StakeSheet(_props: StakeSheetProps) {
  return null;
}
