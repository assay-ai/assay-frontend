"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";

import { formatLimit, monthBounds, todayBounds } from "@/components/g31/format";
import { GrantActions } from "@/components/g31/agent-payment-delegation";
import { CapMeter } from "@/components/patterns/cap-meter";
import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { StatusChip } from "@/components/patterns/status-chip";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AgentReadiness } from "@/features/buyer-money/agent-readiness";
import { capsAreSet } from "@/features/buyer-money/caps";
import { nextUtcMidnight, nextUtcMonth, windowRefillAt } from "@/features/buyer-money/refill";
import {
  agentLimitRows,
  budgetAgentId,
  ceilingCountsMoreThanAgents,
  limitLines,
  type LimitLine,
} from "@/features/buyer-money/spending-limits";
import { supportsDelegation } from "@/features/delegation/delegation-form";
import { policyBootstrapAsset } from "@/features/limits/policy-bootstrap";
import { useChains } from "@/hooks/useChains";
import type { Money } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { updateSpendPolicy, type SpendPolicy } from "@/services/limits.service";
import { getReceiptsSummary } from "@/services/receipts.service";
import { cn } from "@/utils";
import { toast } from "@/utils/toast";

import { BudgetFields, type BudgetBootstrap, useBudgetDraft } from "./budget-fields";
import { LetAgentPaySheet } from "./let-agent-pay-sheet";
import { type AgentRow, useAgentsAndKeys } from "./use-agents";

/** "your time; …" hints, so a refill time says which clock it runs on. */
export const REFILL_HINT = {
  rolling: "your time; 24 h after the first payment in the window",
  day: "your time; the day starts 00:00 UTC",
  month: "your time; the month starts 00:00 UTC",
} as const;

function summaryCharged(summary: unknown): Money | null {
  return (summary as { totals?: { chargedTotal?: Money } } | undefined)?.totals?.chargedTotal ?? null;
}

/**
 * Everything the per-agent limits need: agents and their readiness, the
 * escrow (account ceiling), the Assay policy, which agent it can be edited
 * for, and that agent's spend today and this month.
 */
export function useLimitsContext(options: { pollMs?: number | false } = {}) {
  const data = useAgentsAndKeys(options);
  const policy = data.policyQuery.data ?? null;
  const { chains } = useChains();
  const bootstrapState = data.agentsQuery.isError
    ? ({ kind: "unknown", reason: "your agents could not be read" } as const)
    : policyBootstrapAsset(data.agentsQuery.data?.items as never, chains);
  const bootstrap: BudgetBootstrap | null = bootstrapState.kind === "ready" ? bootstrapState : null;
  const editableFor = budgetAgentId(data.agents, policy, data.escrowQuery.data?.account);

  const day = React.useMemo(() => todayBounds(), []);
  const month = React.useMemo(() => monthBounds(), []);
  const usage = policy?.usage;
  const todaySpend = useQuery({
    queryKey: ["receipts-summary", "day", day.from],
    enabled: Boolean(policy) && !usage,
    queryFn: () => getReceiptsSummary({ from: day.from, to: day.to, groupBy: "tool" }),
  });
  const monthSpend = useQuery({
    queryKey: ["receipts-summary", "month", month.from],
    enabled: Boolean(policy) && !usage,
    queryFn: () => getReceiptsSummary({ from: month.from, to: month.to, groupBy: "tool" }),
  });

  return {
    ...data,
    policy,
    bootstrap,
    bootstrapState,
    editableFor,
    spentToday: usage?.spendToday ?? summaryCharged(todaySpend.data),
    spentMonth: usage?.spendThisMonth ?? summaryCharged(monthSpend.data),
  };
}

export type LimitsContext = ReturnType<typeof useLimitsContext>;

/** The rows for one agent, with the policy only where it is known to apply. */
export function rowsFor(ctx: LimitsContext, agent: AgentRow) {
  const readiness = ctx.readiness[agent.agentId];
  const applies = ctx.editableFor === agent.agentId;
  return agentLimitRows({
    delegation: supportsDelegation(agent.agentAccount),
    grant: readiness?.grant ?? null,
    policy: applies ? ctx.policy : null,
    spentToday: applies ? ctx.spentToday : null,
    spentMonth: applies ? ctx.spentMonth : null,
    ceiling: ctx.escrowQuery.data,
  });
}

/**
 * "Effective limit": one line per limit, naming what binds —
 * "$2.00 a call — set by this agent's spending limit".
 */
export function EffectiveLimitLines({ lines, className }: { lines: LimitLine[]; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-testid="effective-limit">
      <span className="text-label-13 text-01">Effective limit</span>
      {lines.length === 0 ? (
        <p className="text-body-13 text-02">No limit is set, so only your balance stops spending.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {lines.map((line) => (
            <li key={line.id} className="text-body-13 text-02">
              <span className="font-mono font-semibold text-01">{line.amount}</span>
              {line.setBy ? <> — {line.setBy}</> : null}
              {line.left ? <span className="text-03"> · {line.left}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-body-xs text-03">The lowest limit wins: this agent&apos;s spending limits sit under your account ceiling.</p>
    </div>
  );
}

/** Edit an agent's Assay-checked limits when it has no on-chain permission (non-EVM agents). */
export function BudgetOnlySheet({
  open,
  onOpenChange,
  agentName,
  policy,
  bootstrap,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  policy: SpendPolicy | null;
  bootstrap: BudgetBootstrap | null;
}) {
  const draft = useBudgetDraft({ policy, bootstrap, open, mode: "budget" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) setError(null);
  }, [open]);
  const submit = async () => {
    if (!draft.validate()) return;
    if (!draft.dirty) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await draft.save();
      toast.success("Saved. The new limits apply from the next call.");
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? plainError(caught.code) : "The limits could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <SheetContent className="tablet:max-w-[560px]" showCloseButton={!busy}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle>Spending limits for {agentName}</SheetTitle>
          <SheetDescription>
            Checked by Assay before each paid call. Leave a field empty for no limit. Saving needs no signature. Your
            account ceiling keeps applying.
          </SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-4">
          <BudgetFields draft={draft} />
          {error ? (
            <p role="alert" className="text-body-13 text-danger-600">
              {error}
            </p>
          ) : null}
        </div>
        <SheetFooter className="sticky bottom-0 bg-01">
          <div className="flex w-full flex-col-reverse gap-2 tablet:flex-row tablet:justify-end">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" loading={busy} disabled={!draft.creatable} onClick={() => void submit()}>
              Save
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The agent's spending-limit actions, whatever its state: change them (one
 * sheet for the on-chain and Assay-checked parts), or let it pay first.
 */
export function SpendingLimitsActions({
  ctx,
  agent,
  readiness,
  onChanged,
  showStop = true,
}: {
  ctx: LimitsContext;
  agent: AgentRow;
  readiness: AgentReadiness;
  onChanged: () => void;
  showStop?: boolean;
}) {
  const [budgetOpen, setBudgetOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  const name = agent.label ?? "this agent";
  const editable = ctx.editableFor === agent.agentId;
  const grant = readiness.grant;
  const delegation = supportsDelegation(agent.agentAccount);
  const bound = readiness.boundCredential?.delegateAccount ?? null;
  const escrowReady = Boolean(ctx.escrowQuery.data?.exists);
  const editableName = ctx.agents.find((a) => a.agentId === ctx.editableFor)?.label ?? "your own agent";

  if (delegation && grant && grant.status === "ACTIVE") {
    return (
      <GrantActions
        account={agent.agentAccount}
        delegation={grant}
        boundAt={(readiness.boundCredential as { delegateBoundAt?: string | null } | null)?.delegateBoundAt}
        onChanged={onChanged}
        agentName={name}
        showStop={showStop}
        budget={editable ? { policy: ctx.policy, bootstrap: ctx.bootstrap } : undefined}
        budgetNote={
          editable ? undefined : (
            <p className="text-body-xs text-03" data-testid="budget-other-agent">
              A monthly limit and the Advanced limits can be set for {editableName} only, for now.
            </p>
          )
        }
      />
    );
  }

  if (delegation) {
    return (
      <div className="flex flex-col items-start gap-1.5">
        <Button size="sm" type="button" disabled={!bound || !escrowReady} onClick={() => setPayOpen(true)}>
          {grant?.status === "EXPIRED" ? "Let it pay again" : "Let it pay"}
        </Button>
        {!bound ? (
          <p className="text-body-xs text-03">
            Needs its payment key first: see{" "}
            <Link href="/agents" className="font-semibold text-primary-600 hover:underline">
              Agents &amp; keys
            </Link>
            .
          </p>
        ) : !escrowReady ? (
          <p className="text-body-xs text-03">Add funds first: your first deposit opens your escrow.</p>
        ) : null}
        <LetAgentPaySheet
          open={payOpen}
          onOpenChange={(open) => {
            setPayOpen(open);
            if (!open) onChanged();
          }}
          agentName={name}
          delegateAccount={bound}
        />
      </div>
    );
  }

  if (!editable) {
    return <p className="text-body-xs text-03">Its spending limits can be set from {editableName}&apos;s sign-in only, for now.</p>;
  }
  return (
    <>
      <Button size="sm" variant="secondary" type="button" onClick={() => setBudgetOpen(true)}>
        Change spending limits
      </Button>
      <BudgetOnlySheet open={budgetOpen} onOpenChange={setBudgetOpen} agentName={name} policy={ctx.policy} bootstrap={ctx.bootstrap} />
    </>
  );
}

/** One card per agent on the Spending limits page. */
export function AgentLimitsCard({ ctx, agent, onChanged }: { ctx: LimitsContext; agent: AgentRow; onChanged: () => void }) {
  const readiness = ctx.readiness[agent.agentId];
  if (!readiness) return null;
  const name = agent.label ?? "Agent";
  const delegation = supportsDelegation(agent.agentAccount);
  const active = readiness.grant?.status === "ACTIVE" ? readiness.grant : null;
  const canPay = !delegation || Boolean(active);
  const applies = ctx.editableFor === agent.agentId;
  const lines = limitLines(rowsFor(ctx, agent));
  const monthly = applies ? ctx.policy?.monthlyCap ?? null : null;
  const paused = ctx.policy?.paused === true;

  return (
    <section aria-label={name} data-testid="agent-limits-card" className="flex w-full flex-col gap-3.5 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5">
      <header className="flex w-full flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-label-md text-01">{name}</h2>
          <p className="text-body-13 text-02">{readiness.sentence}</p>
        </div>
        <StatusChip status={readiness.status} />
      </header>

      {readiness.liveCredentials.length === 0 ? (
        <p className="text-body-13 text-02">
          Connect it first on{" "}
          <Link href="/agents" className="font-semibold text-primary-600 hover:underline">
            Agents &amp; keys
          </Link>
          .
        </p>
      ) : (
        <>
          {canPay ? (
            <>
              <EffectiveLimitLines lines={lines} />
              {paused ? <p className="text-body-13 text-danger-600">All paid calls are paused, so it spends nothing until you resume.</p> : null}
              {active ? (
                <CapMeter label="Spent by this agent in the last 24 hours" used={active.spentInWindow} limit={active.maxPerWindow} />
              ) : null}
              {monthly ? (
                <CapMeter
                  label="Spent this month"
                  used={ctx.spentMonth ?? { ...monthly, amount: "0" }}
                  limit={monthly}
                  refillsAt={nextUtcMonth()}
                  refillHint={REFILL_HINT.month}
                />
              ) : null}
              {!delegation && applies && ctx.policy?.dailyCap ? (
                <CapMeter
                  label="Spent today"
                  used={ctx.spentToday ?? { ...ctx.policy.dailyCap, amount: "0" }}
                  limit={ctx.policy.dailyCap}
                  refillsAt={nextUtcMidnight()}
                  refillHint={REFILL_HINT.day}
                />
              ) : null}
            </>
          ) : null}
          <SpendingLimitsActions ctx={ctx} agent={agent} readiness={readiness} onChanged={onChanged} showStop={false} />
        </>
      )}
    </section>
  );
}

/** The account ceiling, read-only here; it is changed on Money. */
export function AccountCeilingCard({ ctx }: { ctx: LimitsContext }) {
  const escrow = ctx.escrowQuery.data;
  if (!escrow?.exists) return null;
  const set = capsAreSet(escrow);
  return (
    <section aria-label="Account ceiling" className="flex w-full flex-col gap-2.5 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5">
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-label-md text-01">Account ceiling</h2>
          <p className="text-body-13 text-02">
            {set
              ? `${formatLimit(escrow.maxVoucherAmount)} a call · ${formatLimit(escrow.maxPerWindow)} per 24 hours, for all your agents together. Enforced on chain; it protects your whole escrow.`
              : "Not set, so paid calls are refused. It takes one free signature."}
          </p>
        </div>
        <Button size="sm" variant={set ? "secondary" : "primary"} asChild>
          <Link href="/funding?action=caps">{set ? "Change account ceiling" : "Set account ceiling"}</Link>
        </Button>
      </div>
      {set ? (
        <CapMeter
          label="Spent from your escrow in the last 24 hours, all agents"
          used={escrow.spentInWindow ?? { ...escrow.maxPerWindow!, amount: "0" }}
          limit={escrow.maxPerWindow}
          refillsAt={windowRefillAt(escrow.windowStartedAt, escrow.windowSeconds)}
          refillHint={REFILL_HINT.rolling}
        />
      ) : null}
      {set &&
      ceilingCountsMoreThanAgents(
        escrow.spentInWindow,
        ctx.agents.map((agent) => {
          const grant = ctx.readiness[agent.agentId]?.grant;
          return grant?.status === "ACTIVE" ? grant.spentInWindow : null;
        }),
      ) ? (
        <p className="text-body-xs text-03" data-testid="ceiling-counts-all">
          This counts every payment from your escrow, including keys you revoked and agents you removed, so it can be more
          than the agents above add up to.
        </p>
      ) : null}
    </section>
  );
}

/** The older refuse-above rule: one line with a remove action, only while it is set. */
export function OldRuleLine({ policy }: { policy: SpendPolicy | null }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);
  const remove = useMutation({
    mutationFn: () => updateSpendPolicy({ requireApprovalAbove: null, changeReason: "Removed the older refuse-above rule" }),
    onSuccess: (next) => {
      queryClient.setQueryData<SpendPolicy | null>(["spend-policy"], (previous) =>
        next.usage === undefined && previous?.usage ? { ...next, usage: previous.usage } : next,
      );
      void queryClient.invalidateQueries({ queryKey: ["spend-policy"] });
      void queryClient.invalidateQueries({ queryKey: ["spend-policy-history"] });
      toast.success("Removed. Only your spending limits and account ceiling apply now.");
    },
  });
  const oldBudget = [
    policy?.perCallMax ? `${formatLimit(policy.perCallMax)} a call` : null,
    policy?.dailyCap ? `${formatLimit(policy.dailyCap)} a day` : null,
  ].filter(Boolean);
  if (!policy?.requireApprovalAbove && oldBudget.length === 0) return null;
  const amount = policy?.requireApprovalAbove ? formatLimit(policy.requireApprovalAbove) : "";
  // Both leftovers in one place, each with its own way out, so nobody meets
  // one here and a different set of numbers in an agent's sheet.
  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-01 px-4 py-3" data-testid="old-rule-line">
      <p className="text-label-13 text-01">Older rules still checked</p>
      {policy?.requireApprovalAbove ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-body-13 text-02">
            For every agent: any single call above {amount} is refused.
          </p>
          <Button size="sm" variant="secondary" type="button" onClick={() => setConfirming(true)}>
            Remove it
          </Button>
        </div>
      ) : null}
      {oldBudget.length > 0 ? (
        <p className="text-body-13 text-02">
          For this agent: an older budget of {oldBudget.join(" and ")}. Saving its spending limits replaces it.
        </p>
      ) : null}
      <ConfirmSheet
        open={confirming}
        onOpenChange={setConfirming}
        tone="primary"
        title="Remove the older account-wide rule?"
        description={`Calls above ${amount} are no longer refused by it. Each agent's spending limits and your account ceiling still apply.`}
        changes={[{ label: "Refuse calls above", before: amount, after: "No rule" }]}
        confirmLabel="Remove the rule"
        onConfirm={() => remove.mutateAsync()}
        describeError={(error) => (error instanceof ApiError ? plainError(error.code) : "That did not go through. Try again.")}
      />
    </div>
  );
}
