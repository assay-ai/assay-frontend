"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import type { SlashProposalSummary } from "@/interfaces/provider-disputes";
import { listSlashProposals } from "@/services/provider-slash-cases.service";
import { formatMoney } from "@/utils/money";

/**
 * Penalties Assay has proposed that have no on-chain record yet (lot 1 B8,
 * BUG-DEMO-03). The Penalties list is read from the chain, so such a proposal
 * was announced in the Inbox and then "did not exist" here. They are listed
 * apart, labelled "Proposed, not yet on chain": nothing can be taken or
 * disputed on chain before the record is there.
 *
 * Read from `GET /providers/me/slash-proposals?onChain=false&status=PROPOSED`.
 * An older backend has no such route: the read fails and nothing is shown,
 * which is today's page.
 */
export const OFF_CHAIN_LABEL = "Proposed, not yet on chain";

export const OFF_CHAIN_KEY = ["provider", "slash-proposals", "off-chain"] as const;

export function useOffChainProposals(enabled: boolean) {
  return useQuery({
    queryKey: OFF_CHAIN_KEY,
    enabled,
    retry: 0,
    staleTime: 30_000,
    queryFn: async () => (await listSlashProposals({ onChain: false, status: ["PROPOSED"], limit: 50 })).items ?? [],
  });
}

/** The proposals still to show: only those not on chain, whatever an older or looser answer sends. */
export function offChainRows(items: readonly SlashProposalSummary[] | undefined): SlashProposalSummary[] {
  return (items ?? []).filter((item) => {
    const chain = item.clocks?.chainStatus;
    return item.status === "PROPOSED" && (chain === undefined || chain === null || chain === "NONE" || chain === "PROPOSING");
  });
}

/** Whether `caseId` (from `?case=`) names one of these proposals. */
export function isOffChainCase(rows: readonly SlashProposalSummary[], caseId: string): boolean {
  return caseId !== "" && rows.some((row) => row.id.toLowerCase() === caseId.toLowerCase());
}

export function OffChainProposals({ rows, highlight }: { rows: readonly SlashProposalSummary[]; highlight?: string }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={OFF_CHAIN_LABEL} className="flex w-full flex-col gap-2" data-testid="penalties-off-chain">
      <h2 className="text-label-md text-01">{OFF_CHAIN_LABEL}</h2>
      <p className="text-body-13 text-02">
        Assay has proposed these, but they are not on your stake on the chain yet. Nothing can be taken before they are,
        and once they are they move to the list above with their dispute deadline.
      </p>
      <ul className="flex w-full flex-col gap-2">
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid="penalty-off-chain-row"
            aria-current={highlight && row.id.toLowerCase() === highlight.toLowerCase() ? "true" : undefined}
            className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg border border-01 bg-01 px-4 py-3 aria-[current=true]:border-primary-500"
          >
            <span className="min-w-0 flex-1 text-body-13 text-01 [overflow-wrap:anywhere]">
              {row.toolName ?? row.bindingLabel}
              <span className="text-03"> · {OFF_CHAIN_LABEL}</span>
            </span>
            <span className="font-mono text-mono-13 font-semibold text-01">
              up to {formatMoney(row.penaltyAmount, { decimals: 2 })}
            </span>
            <span className="w-full text-body-xs text-03">
              Proposed <UtcTime value={row.clocks.proposedAt} midSentence />.
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
