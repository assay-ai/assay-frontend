"use client";

import * as React from "react";

import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { Term } from "@/components/patterns/term";
import { WINDOW_WORDS } from "@/features/provider-sla/window";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";
import type { Money, ProviderStake, ToolBindingDetail } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { plainApiError, plainError } from "@/libs/plain-language";
import { formatMoney, toDecimal } from "@/utils/money";

import { percentText, stakeNeededFor, stakeRuleOf, totalStakeWith } from "./go-live";
import { priceLine } from "./listing-copy";

/**
 * "Resume <tool>?" — what a paused listing takes on again the moment it
 * resumes: its price to buyers, its promise, and the stake behind it.
 *
 * Information only. Confirming calls the same `POST …/resume` the button
 * always called; nothing here changes what resuming does or checks.
 */

export interface ResumeFacts {
  rows: { label: string; value: string }[];
  /** How much more stake the paid listings need with this one live, or null. */
  shortfall: Money | null;
  free: boolean;
}

/** Pure, for tests: the rows the sheet shows. */
export function resumeFacts(
  binding: Pick<ToolBindingDetail, "id" | "pricingMode" | "price" | "slaFailureRate">,
  stake: ProviderStake | null,
  staked: Money | null,
): ResumeFacts {
  const free = binding.pricingMode === "FREE";
  const rows = [
    { label: "Buyers pay", value: priceLine(binding) },
    { label: "Your promise", value: `At most ${percentText(binding.slaFailureRate)}% of checked calls fail in each window` },
  ];
  if (free) {
    rows.push({ label: "Stake", value: "None needed: a free listing puts no money at risk" });
    return { rows, shortfall: null, free };
  }
  const needed = stakeNeededFor(binding.price, binding.pricingMode, stakeRuleOf(stake));
  const total = totalStakeWith(needed, stake, binding.id);
  if (needed) rows.push({ label: "Stake it needs", value: formatMoney(needed, { decimals: 2 }) });
  if (total && needed && total.amount !== needed.amount) {
    rows.push({ label: "All paid listings need", value: formatMoney(total, { decimals: 2 }) });
  }
  if (staked) rows.push({ label: "You have staked", value: formatMoney(staked, { decimals: 2 }) });
  let shortfall: Money | null = null;
  if (total && staked) {
    const gap = toDecimal(total).minus(toDecimal(staked));
    if (gap.gt(0)) {
      shortfall = { amount: gap.mul(10 ** total.decimals).toFixed(0), asset: total.asset, decimals: total.decimals };
    }
  }
  return { rows, shortfall, free };
}

export function ResumeSheet({
  open,
  onOpenChange,
  binding,
  toolName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  binding: ToolBindingDetail;
  toolName: string;
  /** The existing resume action, unchanged. */
  onConfirm: () => Promise<unknown>;
}) {
  const stake = useStakeStatus();
  const facts = resumeFacts(binding, stake.stake, stake.staked);
  return (
    <ConfirmSheet
      open={open}
      onOpenChange={onOpenChange}
      tone="primary"
      title={`Resume ${toolName}?`}
      description={`Agents can be sent to it again at once, at the terms below. From then on its calls count towards your promise in each window (${WINDOW_WORDS}).`}
      confirmLabel="Resume listing"
      onConfirm={onConfirm}
      describeError={(error) => (error instanceof ApiError ? plainApiError(error) : "It could not be resumed. Try again.")}
    >
      <dl className="flex w-full flex-col overflow-hidden rounded-lg border border-01" data-testid="resume-facts">
        {facts.rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-0.5 border-b border-01 px-3.5 py-2.5 last:border-b-0 tablet:flex-row tablet:gap-3">
            <dt className="text-body-13 text-03 tablet:w-44 tablet:shrink-0">{row.label}</dt>
            <dd className="text-body-13 text-01">{row.value}</dd>
          </div>
        ))}
      </dl>
      {facts.shortfall ? (
        <p role="status" className="rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700">
          Your stake is {formatMoney(facts.shortfall, { decimals: 2 })} short of what your paid listings need. Add stake on the
          Stake page.
        </p>
      ) : null}
      {facts.free ? null : (
        <p className="text-body-xs text-02">
          Over your promise, the <Term k="stake-rule">stake rule</Term> applies: part of your stake can be taken as a penalty.
        </p>
      )}
    </ConfirmSheet>
  );
}
