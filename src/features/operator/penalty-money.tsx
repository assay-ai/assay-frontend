"use client";

import * as React from "react";

import { MoneySplit } from "@/components/patterns/money-flow";
import { SLASH_PLATFORM_BPS } from "@/features/provider-slash-case/distribution";
import type { Money } from "@/interfaces/api";
import { formatMoney, toDecimal } from "@/utils/money";

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

/** How much the provider's stake goes down if it executes: agents plus platform. Null while the split is unknown. */
export function stakeReduction(penalty: Money, agentBps: number | null): Money | null {
  const split = agentBps === null ? null : penaltySplit(penalty, agentBps);
  return split ? { ...penalty, amount: (BigInt(split.agents.amount) + BigInt(split.platform.amount)).toString() } : null;
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
    default:
      return { title: "If upheld", meta: "Reserved in the provider's stake. Nothing has moved yet.", split: true };
  }
}

export function PenaltyMoney({
  penalty,
  stage,
  agentBps,
}: {
  penalty: Money;
  stage: CaseStage;
  /** From the chain's terms; null while unknown (the split is then not drawn). */
  agentBps: number | null;
}) {
  const split = agentBps === null ? null : penaltySplit(penalty, agentBps);
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
    </section>
  );
}
