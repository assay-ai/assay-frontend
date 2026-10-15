"use client";

import * as React from "react";

import { LocalTime } from "@/components/patterns/local-time";
import { MoneyFlow, MoneySplit } from "@/components/patterns/money-flow";
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
  /** Never taken from the provider's stake. */
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

/** "60% to the agents who paid · 30% to the platform · 10% never taken from the provider". */
export function splitSharesText(agentBps: number, platformBps: number = SLASH_PLATFORM_BPS): string {
  const kept = Math.max(0, 10_000 - agentBps - platformBps);
  return `${pct(agentBps)} to the agents who paid · ${pct(platformBps)} to the platform · ${pct(kept)} never taken from the provider`;
}

export function PenaltyMoney({
  penalty,
  stage,
  executableAt,
  agentBps,
}: {
  penalty: Money;
  stage: CaseStage;
  executableAt: string | null;
  /** From the chain's terms; null while unknown (the split is then not drawn). */
  agentBps: number | null;
}) {
  const split = agentBps === null ? null : penaltySplit(penalty, agentBps);
  const taken = stage === "executed";
  const repaid = stage === "compensated";
  const released = stage === "cancelled";
  // Suspended here: the arbiter's cancel is pending, so the split below is what would have happened, not what will.
  const cancelling = stage === "cancel-requested";
  return (
    <section aria-label="Where the money goes" className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 p-4 tablet:p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-label-md text-01">Where the money goes</h2>
        <p className="text-body-13 text-02">
          {taken
            ? "Taken from the provider's stake."
            : repaid
              ? "Taken from the provider's stake, then paid back by the treasury."
              : released
                ? "Nothing was taken: the reserved stake went back to the provider."
                : cancelling
                  ? `Cancel requested: the reserved ${formatMoney(penalty)} goes back to the provider once the arbiter signs. Nothing has moved.`
                  : "Reserved in the provider's stake. Nothing has moved yet."}
        </p>
      </div>
      <MoneyFlow
        nodes={[
          { label: "Provider's stake", tone: "neutral" },
          {
            label: taken || repaid ? "Penalty" : released ? "Released" : "Penalty reserved",
            amount: formatMoney(penalty),
            tone: released ? "teal" : taken || repaid ? "danger" : "warning",
            note:
              !taken && !repaid && !released && executableAt && stage !== "disputed" && stage !== "cancel-requested" ? (
                <>
                  executable from <LocalTime value={executableAt} />
                </>
              ) : undefined,
          },
          ...(released || repaid || cancelling
            ? [
                {
                  label: repaid ? "Paid back by the treasury" : cancelling ? "Back to the provider, once signed" : "Back to the provider",
                  amount: formatMoney(penalty),
                  tone: "teal" as const,
                },
              ]
            : split
              ? [
                  { label: "Agents who paid", amount: formatMoney(split.agents), tone: "primary" as const },
                  { label: "Platform", amount: formatMoney(split.platform), tone: "indigo" as const },
                ]
              : []),
        ]}
      />
      {split && agentBps !== null && !released && !repaid && !cancelling ? (
        <div className="flex flex-col gap-2">
          <MoneySplit
            segments={[
              { label: "To the agents who paid for the failed calls", value: toDecimal(split.agents).toNumber(), amount: formatMoney(split.agents), tone: "primary" },
              { label: "To the platform", value: toDecimal(split.platform).toNumber(), amount: formatMoney(split.platform), tone: "indigo" },
              { label: "Never taken from the provider", value: toDecimal(split.neverTaken).toNumber(), amount: formatMoney(split.neverTaken), tone: "teal" },
            ]}
          />
          <p className="text-body-xs text-03">
            Split on chain: {splitSharesText(agentBps)}. The stake goes down by {formatMoney({ ...penalty, amount: (BigInt(split.agents.amount) + BigInt(split.platform.amount)).toString() })}.
          </p>
        </div>
      ) : null}
    </section>
  );
}
