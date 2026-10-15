import { formatLimit } from "@/components/g31/format";
import { type EffectiveLimitRow, type LimitSource, resolveLimit } from "@/components/patterns/effective-limit";
import type { EscrowDelegate, Money } from "@/interfaces";
import type { SpendPolicy } from "@/services/limits.service";

import { capsAreSet } from "./caps";

/**
 * The buyer's limits, as two layers with plain names:
 *
 *   1. **Account ceiling** — on chain, on the whole escrow (every agent and
 *      key together). Set on Money.
 *   2. **Spending limits**, one set per agent:
 *      - per call and per 24 hours: the agent's own on-chain permission (the
 *        grant to its payment key), when it pays through one;
 *      - per month, plus rate limits and tools under Advanced: checked by Assay
 *        before each call (the spend policy).
 *      An agent that pays from its own non-EVM account has no grant: its per
 *      call and per day are Assay-checked too.
 *
 * Two leftovers are shown only while set, each with a way to remove it: an
 * older Assay budget per call / per day (saving an agent's spending limits
 * replaces it with the on-chain numbers) and the older refuse-above rule.
 *
 * The lowest wins; `agentLimitRows` lists the sources so `resolveLimit` can say
 * which one binds, and `limitSentence` says it in one line:
 * "$2.00 a call — set by this agent's spending limit".
 */
export const LIMIT_SOURCE = {
  agent: "this agent's spending limit",
  ceiling: "your account ceiling",
  oldBudget: "this agent's older budget",
  oldRule: "an older account-wide rule",
} as const;

export interface CeilingCaps {
  maxVoucherAmount: Money | null;
  maxPerWindow: Money | null;
  spentInWindow?: Money | null;
}

export interface AgentLimitsInput {
  /** The agent pays through an on-chain permission (EVM payment key). */
  delegation: boolean;
  /** Its permission, when it has one. An expired one sets no limit (it cannot pay). */
  grant: EscrowDelegate | null;
  /** The Assay-checked policy that applies to this agent, or `null` (none, or unknown). */
  policy: Pick<SpendPolicy, "perCallMax" | "dailyCap" | "monthlyCap" | "requireApprovalAbove"> | null;
  spentToday?: Money | null;
  spentMonth?: Money | null;
  ceiling: CeilingCaps | null | undefined;
}

/** Whether a policy still carries the per-call / per-day budget an agent with an on-chain limit no longer needs. */
export function hasOldBudget(policy: Pick<SpendPolicy, "perCallMax" | "dailyCap"> | null | undefined): boolean {
  return Boolean(policy?.perCallMax || policy?.dailyCap);
}

export function agentLimitRows(input: AgentLimitsInput): EffectiveLimitRow[] {
  const { policy, grant } = input;
  const active = grant && grant.status === "ACTIVE" ? grant : null;
  const ceilingSet = capsAreSet(input.ceiling);
  const ceilingCall: LimitSource[] = ceilingSet ? [{ source: LIMIT_SOURCE.ceiling, value: input.ceiling!.maxVoucherAmount }] : [];
  const ceilingWindow: LimitSource[] = ceilingSet
    ? [{ source: LIMIT_SOURCE.ceiling, value: input.ceiling!.maxPerWindow, used: input.ceiling!.spentInWindow ?? null }]
    : [];
  const rule: LimitSource[] = policy?.requireApprovalAbove ? [{ source: LIMIT_SOURCE.oldRule, value: policy.requireApprovalAbove }] : [];
  const month: EffectiveLimitRow = {
    id: "month",
    label: "Per month",
    sources: [{ source: LIMIT_SOURCE.agent, value: policy?.monthlyCap ?? null, used: input.spentMonth ?? null }],
  };

  if (input.delegation) {
    return [
      {
        id: "call",
        label: "Per call",
        sources: [
          { source: LIMIT_SOURCE.agent, value: active?.maxVoucherAmount ?? null },
          ...(policy?.perCallMax ? [{ source: LIMIT_SOURCE.oldBudget, value: policy.perCallMax }] : []),
          ...rule,
          ...ceilingCall,
        ],
      },
      {
        id: "window",
        label: "Per 24 hours",
        sources: [
          { source: LIMIT_SOURCE.agent, value: active?.maxPerWindow ?? null, used: active?.spentInWindow ?? null },
          ...(policy?.dailyCap ? [{ source: LIMIT_SOURCE.oldBudget, value: policy.dailyCap, used: input.spentToday ?? null }] : []),
          ...ceilingWindow,
        ],
      },
      month,
    ];
  }
  return [
    {
      id: "call",
      label: "Per call",
      sources: [{ source: LIMIT_SOURCE.agent, value: policy?.perCallMax ?? null }, ...rule, ...ceilingCall],
    },
    {
      id: "window",
      label: "Per day",
      sources: [
        { source: LIMIT_SOURCE.agent, value: policy?.dailyCap ?? null, used: input.spentToday ?? null },
        ...ceilingWindow,
      ],
    },
    month,
  ];
}

const UNIT: Record<string, string> = {
  call: "a call",
  window: "per 24 hours",
  month: "a month",
};

export interface LimitLine {
  id: string;
  /** "$2.00 a call" */
  amount: string;
  /** "set by this agent's spending limit", or null when nothing sets one. */
  setBy: string | null;
  /** "$24.25 left now", when a source reports what was used. */
  left: string | null;
  value: Money | null;
}

/** One line per row: the binding amount and who sets it. Rows nothing limits are dropped. */
export function limitLines(rows: readonly EffectiveLimitRow[], options: { dayLabel?: string } = {}): LimitLine[] {
  return rows.flatMap((row) => {
    const resolved = resolveLimit(row.sources);
    if (!resolved.value) return [];
    const unit = row.id === "window" && row.label === "Per day" ? (options.dayLabel ?? "a day (UTC)") : (UNIT[row.id] ?? row.label.toLowerCase());
    return [
      {
        id: row.id,
        amount: `${formatLimit(resolved.value)} ${unit}`,
        setBy: resolved.source ? `set by ${resolved.source}` : null,
        left: resolved.left ? `${formatLimit(resolved.left)} left now` : null,
        value: resolved.value,
      },
    ];
  });
}

/** "$2.00 a call — set by this agent's spending limit" */
export function limitSentence(line: LimitLine): string {
  return line.setBy ? `${line.amount} — ${line.setBy}` : line.amount;
}

/**
 * The agent whose Assay-checked limits this session can read and write.
 * `GET`/`PATCH /spend-policy` act on the signed-in session's own agent (the
 * one the person's login is tied to), so that is the only agent the monthly
 * and Advanced limits can be shown or changed for. Found from the policy
 * itself, else the agent whose account owns the escrow, else the only agent.
 */
export function budgetAgentId(
  agents: readonly { agentId: string; agentAccount?: string | null }[],
  policy: { agentId: string | null } | null | undefined,
  escrowAccount: string | null | undefined,
): string | null {
  if (policy?.agentId && agents.some((a) => a.agentId === policy.agentId)) return policy.agentId;
  if (escrowAccount) {
    const owner = agents.find((a) => a.agentAccount && a.agentAccount.toLowerCase() === escrowAccount.toLowerCase());
    if (owner) return owner.agentId;
  }
  return agents.length === 1 ? agents[0]!.agentId : null;
}

/**
 * Whether the account ceiling's "spent in the last 24 hours" is more than the
 * agents on screen add up to — spend by keys since revoked or agents since
 * removed still counts against the ceiling. Then the page says so in one line,
 * instead of leaving two numbers that seem to disagree.
 */
export function ceilingCountsMoreThanAgents(
  ceilingSpent: Money | null | undefined,
  agentSpent: readonly (Money | null | undefined)[],
): boolean {
  if (!ceilingSpent) return false;
  const total = agentSpent.reduce((sum, m) => sum + BigInt(m?.amount || "0"), 0n);
  return BigInt(ceilingSpent.amount || "0") > total;
}
