"use client";

import { SkeletonRows } from "@/components/patterns/page-state";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import {
  AccountCeilingCard,
  AgentLimitsCard,
  OldRuleLine,
  useLimitsContext,
} from "@/components/buyer-money/agent-limits";
import { PauseAllCard } from "@/components/buyer-money/pause-all";
import { AgentAccessCard } from "@/components/toolsets/agent-access-card";
import { UtcTime } from "@/components/patterns/utc-time";
import { PageState } from "@/components/patterns/page-state";
import { plainActor } from "@/features/buyer-money/budget-form";
import { ME_STATUS_KEY } from "@/features/me-status/use-me-status";
import { ApiError } from "@/libs/ApiClient";
import { plainApiError, plainError } from "@/libs/plain-language";
import { listSpendPolicyHistory } from "@/services/limits.service";

import { relativeTime } from "./format";

/**
 * Controls › Spending limits: what each agent may spend, as two layers with
 * plain names (see `features/buyer-money/spending-limits.ts`):
 *
 *   - per agent, its **spending limits** — per call and per 24 hours on chain
 *     (its payment permission), per month and Advanced checked by Assay — in
 *     one card with one "Effective limit" naming what binds, and one sheet;
 *   - the **account ceiling** — on chain, the whole escrow — shown here and
 *     changed on Money.
 *
 * Next to each agent's spending limits: What this agent can use (its access
 * and provider limits, `components/toolsets/agent-access-card.tsx`).
 *
 * The kill switch is the first thing on the page (and in the top bar). The
 * older refuse-above rule shows only while it is set, as one line with Remove.
 */
export function LimitsView() {
  const queryClient = useQueryClient();
  const ctx = useLimitsContext();
  const refresh = () => {
    ctx.refetchKeys();
    ctx.refetchDelegates();
    void queryClient.invalidateQueries({ queryKey: ["escrow"] });
    // The debts ride on `GET /me/status` now; they refreshed with the escrow before.
    void queryClient.invalidateQueries({ queryKey: ME_STATUS_KEY });
    void queryClient.invalidateQueries({ queryKey: ["escrow-delegates"] });
  };

  return (
    <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:gap-5 tablet:px-7 tablet:py-[22px]">
      <header className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-heading-md text-01">Spending limits</h1>
        <p className="text-body-13 text-02">What each agent may spend. The lowest limit wins, and changes apply from the next call.</p>
      </header>

      <PauseAllCard />

      {ctx.agentsQuery.isPending || ctx.policyQuery.isPending ? (
        <PageState kind="loading" rows={3} label="Loading your spending limits" />
      ) : ctx.agentsQuery.isError ? (
        <PageState
          kind="error"
          title="Your agents could not be loaded"
          description="This says nothing about your limits: they still apply."
          code={ctx.agentsQuery.error instanceof ApiError ? ctx.agentsQuery.error.code : null}
          onRetry={() => void ctx.agentsQuery.refetch()}
        />
      ) : ctx.agents.length === 0 ? (
        <PageState
          kind="empty"
          icon={<KeyRound />}
          title="No agent yet"
          description="Your first agent is set up when you sign in for the first time. Reload in a moment."
        />
      ) : (
        <>
          {ctx.policyQuery.isError ? (
            <p role="alert" className="text-body-13 text-warning-700">
              Your monthly limits could not be read just now (
              {ctx.policyQuery.error instanceof ApiError ? plainApiError(ctx.policyQuery.error) : "try again in a moment"}
              ). They still apply.
            </p>
          ) : null}
          {ctx.bootstrapState.kind === "unknown" && !ctx.policy ? (
            <p className="text-body-xs text-03" data-testid="policy-bootstrap-note">
              A monthly limit cannot be set right now: {ctx.bootstrapState.reason}.
            </p>
          ) : null}
          {ctx.agents.map((agent) => (
            <React.Fragment key={agent.agentId}>
              <AgentLimitsCard ctx={ctx} agent={agent} onChanged={refresh} />
              <section
                aria-label={`What ${agent.label ?? "this agent"} can use`}
                data-testid="agent-access-card"
                className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5"
              >
                <header className="flex flex-col gap-0.5">
                  <h2 className="text-label-md text-01">What {agent.label ?? "this agent"} can use</h2>
                  <p className="text-body-13 text-02">Which tools it may call and which providers may serve them, whatever server it calls through.</p>
                </header>
                <AgentAccessCard agentId={agent.agentId} agentName={agent.label ?? "This agent"} />
              </section>
            </React.Fragment>
          ))}
          <AccountCeilingCard ctx={ctx} />
          <OldRuleLine policy={ctx.policy} freeOnly={Boolean(ctx.freeOnlyChainName)} />

          <HowLimitsStop freeOnlyChainName={ctx.freeOnlyChainName} />

          {ctx.policy ? <History /> : null}
        </>
      )}
    </div>
  );
}

/**
 * How a limit stops a call, in the words BEFORE had and AFTER had dropped:
 * which limits are software and which are on chain, the duplicate-call
 * rule, what the agent gets back, and that alerts never refuse anything.
 */
function HowLimitsStop({ freeOnlyChainName }: { freeOnlyChainName?: string | null }) {
  if (freeOnlyChainName) {
    return (
      <section
        aria-labelledby="how-limits-stop"
        className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 px-4 py-3.5 tablet:px-5"
        data-testid="how-limits-stop"
      >
        <h2 id="how-limits-stop" className="text-label-13 text-01">
          How a limit stops a call
        </h2>
        <p className="text-body-13 text-02">
          Your agents make free calls only on {freeOnlyChainName}. Spending limits and Pause all stop paid calls, so they do
          not apply there. Free calls are counted against each tool&apos;s free calls per day instead.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="how-limits-stop"
      className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 px-4 py-3.5 tablet:px-5"
      data-testid="how-limits-stop"
    >
      <h2 id="how-limits-stop" className="text-label-13 text-01">
        How a limit stops a call
      </h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-4 text-body-13 text-02">
        <li>
          <span className="text-01">Every limit stops calls.</span> A call over any limit above is refused; nothing is charged
          for it.
        </li>
        <li>
          <span className="text-01">On chain:</span> your account ceiling and each agent&apos;s per call and per 24 hours
          limits. The contract refuses anything over them, Assay included.
        </li>
        <li>
          <span className="text-01">Checked by Assay:</span> the monthly limit, rate limits, what each agent can use and Pause all.
          They are enforced by Assay&apos;s software, not by your wallet or the contract, so treat them as a control and not as
          a guarantee.
        </li>
        <li>
          Separately, a call repeated with the same tool and the same arguments is refused as a duplicate from the fifth
          time within one minute, for the rest of that minute. It uses up no limit and nothing is charged.
        </li>
        <li>
          <span className="text-01">What your agent sees:</span> an error for that call that names the reason (for example
          &ldquo;This call would go over your spend limit.&rdquo;), and nothing is held or charged. Spending limits and Pause
          all stop paid calls only: free calls keep working.
        </li>
        <li>
          <span className="text-01">Alerts only:</span> you get an alert at 50%, 80% and 100% of a daily or monthly limit.
          An alert never refuses a call.{" "}
          <Link href="/alerts" className="font-semibold text-primary-600 hover:underline">
            Alert settings
          </Link>
        </li>
      </ul>
    </section>
  );
}

function History() {
  const history = useQuery({
    queryKey: ["spend-policy-history"],
    retry: false,
    queryFn: () => listSpendPolicyHistory({ limit: 8 }),
  });
  const items = history.data?.items ?? [];
  return (
    <details className="w-full rounded-xl border border-01 bg-01 px-4 py-3 tablet:px-5" id="limits-change-history">
      <summary className="cursor-pointer select-none text-label-13 text-01">Change history</summary>
      <div className="mt-2 flex flex-col">
        {history.isPending ? (
          <SkeletonRows rows={2} className="py-2" />
        ) : history.isError ? (
          <p className="py-2 text-body-13 text-02">The history could not be loaded.</p>
        ) : items.length === 0 ? (
          <p className="py-2 text-body-13 text-03">No changes yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-01">
            {items.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5 py-2">
                <span className="text-body-13 text-01">{entry.changeReason ?? "Limits changed"}</span>
                <span className="text-body-xs text-03">
                  {plainActor(entry.changedBy)} · <UtcTime value={entry.changedAt} /> ({relativeTime(entry.changedAt)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
