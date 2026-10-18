"use client";

import * as React from "react";

import { MoneySplit } from "@/components/patterns/money-flow";
import { SLASH_PLATFORM_BPS } from "@/features/provider-slash-case/distribution";
import type { Money } from "@/interfaces/api";
import { formatDateTime } from "@/libs/utc-time";
import { formatMoney, splitForDisplay, toDecimal } from "@/utils/money";

import type { CaseStage } from "./case-flow";

/**
 * Where a penalty's money goes — ONE split for the whole console. The agents'
 * share is read off the chain's current terms (`slashAgentBps`); the
 * platform's share is the contracts' `slashPlatformBps`, which no endpoint
 * serves yet, so it is the published figure; the rest is never taken from the
 * provider's stake at all (the stake goes down by agents + platform only).
 * The penalty page, its measurement and the Arbiter strip all read this, so a
 * ruling arbiter never sees two different splits.
 */
export interface PenaltySplit {
  agents: Money;
  platform: Money;
  /** Stays with the provider: never taken from its stake. */
  neverTaken: Money;
}

export function penaltySplit(penalty: Money, agentBps: number, platformBps: number = SLASH_PLATFORM_BPS): PenaltySplit | null {
  if (!/^\d+$/.test(penalty.amount)) return null;
  if (!Number.isInteger(agentBps) || !Number.isInteger(platformBps) || agentBps < 0 || platformBps < 0 || agentBps + platformBps > 10_000) return null;
  const total = BigInt(penalty.amount);
  const agents = (total * BigInt(agentBps)) / BigInt(10_000);
  const platform = (total * BigInt(platformBps)) / BigInt(10_000);
  return {
    agents: { ...penalty, amount: agents.toString() },
    platform: { ...penalty, amount: platform.toString() },
    neverTaken: { ...penalty, amount: (total - agents - platform).toString() },
  };
}

function pct(bps: number): string {
  const value = bps / 100;
  return `${Number.isInteger(value) ? value : value.toFixed(2)}%`;
}

/** "60% to the agents who paid · 30% to the platform · 10% stays with the provider". */
export function splitSharesText(agentBps: number, platformBps: number = SLASH_PLATFORM_BPS): string {
  const kept = Math.max(0, 10_000 - agentBps - platformBps);
  return `${pct(agentBps)} to the agents who paid · ${pct(platformBps)} to the platform · ${pct(kept)} stays with the provider`;
}

/** "10%": the share of a penalty that stays with the provider, never taken from its stake. */
export function keptShareText(agentBps: number, platformBps: number = SLASH_PLATFORM_BPS): string {
  return pct(Math.max(0, 10_000 - agentBps - platformBps));
}

/**
 * How much the provider's stake goes down if it executes: agents plus
 * platform. With `display`, the two parts as the money card draws them (to the
 * cent, adding up to the total), so the fact and the card agree. Null while the
 * split is unknown.
 */
export function stakeReduction(penalty: Money, agentBps: number | null, display = false): Money | null {
  const split = agentBps === null ? null : display ? displaySplit(penalty, agentBps) : penaltySplit(penalty, agentBps);
  return split ? { ...penalty, amount: (BigInt(split.agents.amount) + BigInt(split.platform.amount)).toString() } : null;
}

/** The split as drawn: each part to the cent, the three adding up to the total shown. Null while unknown. */
export function displaySplit(penalty: Money, agentBps: number): PenaltySplit | null {
  const split = penaltySplit(penalty, agentBps);
  if (!split) return null;
  const [agents, platform, neverTaken] = splitForDisplay([split.agents, split.platform, split.neverTaken]);
  return { agents: agents!, platform: platform!, neverTaken: neverTaken! };
}

/** The card's title and its one meta line, by stage. Pure. */
export function moneyHeading(stage: CaseStage, penaltyText: string): { title: string; meta: string; split: boolean } {
  switch (stage) {
    case "executed":
      return { title: "Moved", meta: "Taken from the provider's stake.", split: true };
    case "compensated":
      return { title: "Paid back", meta: "Taken from the provider's stake, then paid back by the treasury.", split: false };
    case "cancelled":
      return { title: "Nothing taken", meta: "The reserved stake went back to the provider.", split: false };
    case "cancel-requested":
      return {
        title: "Nothing moves",
        meta: `Cancel requested: the reserved ${penaltyText} goes back to the provider once the arbiter signs.`,
        split: false,
      };
    case "upheld":
    case "executable":
      return { title: "When it executes", meta: "Reserved in the provider's stake. Nothing has moved yet.", split: true };
    default:
      return { title: "If upheld", meta: "Reserved in the provider's stake. Nothing has moved yet.", split: true };
  }
}

export function PenaltyMoney({
  penalty,
  stage,
  agentBps,
  lastKnownAt = null,
}: {
  penalty: Money;
  stage: CaseStage;
  /** From the chain's terms; null while unknown (the split is then not drawn). */
  agentBps: number | null;
  /** Set when the chain can't be read now and `agentBps` is the last read: when it was read. */
  lastKnownAt?: number | null;
}) {
  const split = agentBps === null ? null : displaySplit(penalty, agentBps);
  const total = formatMoney(penalty);
  const heading = moneyHeading(stage, total);
  return (
    <section aria-labelledby="penalty-money" className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 p-4 tablet:p-5">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="penalty-money" className="text-label-md text-01">
            {heading.title}
          </h2>
          <span className="text-body-13 tabular-nums text-02">
            <span className="font-medium text-01">{total}</span> total
          </span>
        </div>
        <p className="text-body-xs text-03">{heading.meta}</p>
      </div>
      {heading.split && split ? (
        <MoneySplit
          segments={[
            { label: "Agents who paid", value: toDecimal(split.agents).toNumber(), amount: formatMoney(split.agents), tone: "primary" },
            { label: "Platform", value: toDecimal(split.platform).toNumber(), amount: formatMoney(split.platform), tone: "indigo" },
            { label: "Stays with the provider", value: toDecimal(split.neverTaken).toNumber(), amount: formatMoney(split.neverTaken), tone: "teal" },
          ]}
        />
      ) : heading.split ? (
        <p className="text-body-13 text-02">The split is read from the chain&rsquo;s terms, which could not be read just now.</p>
      ) : null}
      {heading.split && split && lastKnownAt ? (
        <p className="text-body-xs text-03">
          Split as last read from the chain, {formatDateTime(lastKnownAt)}; it could not be read just now.
        </p>
      ) : null}
    </section>
  );
}
