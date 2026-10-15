"use client";

import type { Money } from "@/interfaces";

/**
 * Penalties that need the provider now (pending on chain, still disputable),
 * for the nav badge, the Home "Needs action" strip and the Inbox.
 */
export interface PenaltyNotice {
  /** Stable key: the on-chain request id (or the Assay proposal id). */
  id: string;
  /** The tool the penalty is about, by name; null when unknown. */
  toolName: string | null;
  amount: Money | null;
  /** On-chain `executableAt` (ISO): the dispute deadline. */
  executableAt: string | null;
  /** Opens the penalty's "Why?" drawer. */
  href: string;
}

export interface PenaltySummary {
  isLoading: boolean;
  needsAction: PenaltyNotice[];
  count: number;
}

// STUB — the penalties work replaces this with the chain read.
export function usePenaltySummary(): PenaltySummary {
  return { isLoading: false, needsAction: [], count: 0 };
}
