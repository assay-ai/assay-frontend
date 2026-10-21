"use client";

import type { Money } from "@/interfaces";
import { routes } from "@/libs/routes";

import { usePenalties } from "./use-penalties";

/**
 * Penalties that need the provider now (pending on chain, still disputable),
 * for the nav badge, the Home "Needs action" strip and the Inbox.
 */
export interface PenaltyNotice {
  /** Stable key: the on-chain request id (or the Assay proposal id). */
  id: string;
  /** Assay's case id, when the chain record is matched to one. */
  proposalId: string | null;
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

/**
 * Reads the same chain query and case queries as the Penalties page, so the
 * badge, Home and the page never disagree and never cost a second read.
 */
export function usePenaltySummary(): PenaltySummary {
  const penalties = usePenalties({ withCases: "open" });
  // Last-known rows (`updating`) are for reading only: a penalty disputed
  // elsewhere since must not be counted again in the badge or Needs action.
  const needsAction = (penalties.updating ? [] : penalties.rows)
    .filter((row) => row.canDispute)
    .map((row) => ({
      id: row.id,
      proposalId: row.proposalId ?? null,
      toolName: penalties.caseFor(row)?.proposal.toolName ?? null,
      amount: row.amount,
      executableAt: row.executableAt,
      href: routes.penalty(row.id),
    }));
  return { isLoading: penalties.isLoading || penalties.updating, needsAction, count: needsAction.length };
}
