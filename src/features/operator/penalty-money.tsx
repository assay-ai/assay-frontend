"use client";

import * as React from "react";

import { LocalTime } from "@/components/patterns/local-time";
import { MoneyFlow, MoneySplit } from "@/components/patterns/money-flow";
import type { Money } from "@/interfaces/api";
import { formatMoney, toDecimal } from "@/utils/money";

import type { CaseStage } from "./case-flow";

/**
 * Where a penalty's money goes, read off the chain's current terms rather
 * than hard-coded: `slashAgentBps` of it to the agents who paid for the failed
 * calls, the rest to the treasury (business finding 22). Pure split for tests.
 */
export function penaltySplit(penalty: Money, agentBps: number): { agents: Money; treasury: Money } | null {
  if (!/^\d+$/.test(penalty.amount) || !Number.isInteger(agentBps) || agentBps < 0 || agentBps > 10_000) return null;
  const total = BigInt(penalty.amount);
  const agents = (total * BigInt(agentBps)) / BigInt(10_000);
  return {
    agents: { ...penalty, amount: agents.toString() },
    treasury: { ...penalty, amount: (total - agents).toString() },
  };
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
              : "Reserved in the provider's stake. Nothing has moved yet."}
        </p>
      </div>
      <MoneyFlow
        nodes={[
          { label: "Provider's stake", tone: "neutral" },
          {
            label: taken || repaid ? "Taken" : released ? "Released" : "Reserved",
            amount: formatMoney(penalty),
            tone: released ? "teal" : taken || repaid ? "danger" : "warning",
            note: !taken && !repaid && !released && executableAt && stage !== "disputed" && stage !== "cancel-requested" ? (
              <>
                executable from <LocalTime value={executableAt} />
              </>
            ) : undefined,
          },
          ...(released || repaid
            ? [{ label: repaid ? "Paid back by the treasury" : "Back to the provider", amount: formatMoney(penalty), tone: "teal" as const }]
            : split
              ? [
                  { label: "Agents who paid", amount: formatMoney(split.agents), tone: "primary" as const },
                  { label: "Treasury", amount: formatMoney(split.treasury), tone: "indigo" as const },
                ]
              : []),
        ]}
      />
      {split && !released && !repaid ? (
        <div className="flex flex-col gap-2">
          <MoneySplit
            segments={[
              { label: "To the agents who paid for the failed calls", value: toDecimal(split.agents).toNumber(), amount: formatMoney(split.agents), tone: "primary" },
              { label: "To the treasury", value: toDecimal(split.treasury).toNumber(), amount: formatMoney(split.treasury), tone: "indigo" },
            ]}
          />
          <p className="text-body-xs text-03">
            Split under the current terms on chain: {agentBps! / 100}% to the agents, the rest to the treasury.
          </p>
        </div>
      ) : null}
    </section>
  );
}
