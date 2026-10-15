"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { useAgentsAndKeys, useSpendPolicyQuery } from "@/components/buyer-money/use-agents";
import { PauseAllCard } from "@/components/buyer-money/pause-all";
import { CapMeter } from "@/components/patterns/cap-meter";
import { EffectiveLimit, type EffectiveLimitRow } from "@/components/patterns/effective-limit";
import { EntityPicker } from "@/components/patterns/entity-picker";
import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { PresetChips } from "@/components/patterns/preset-chips";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  BUDGET_PRESETS,
  budgetFormFrom,
  budgetPatch,
  plainActor,
  type BudgetField,
  type BudgetForm,
} from "@/features/buyer-money/budget-form";
import { capsAreSet } from "@/features/buyer-money/caps";
import { nextUtcMidnight, nextUtcMonth } from "@/features/buyer-money/refill";
import { policyBootstrapAsset } from "@/features/limits/policy-bootstrap";
import { useChains } from "@/hooks/useChains";
import { useEntityNames } from "@/hooks/useEntityNames";
import type { Money } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { listAgents } from "@/services/account.service";
import { listSpendPolicyHistory, updateSpendPolicy, type SpendPolicy } from "@/services/limits.service";
import { getReceiptsSummary } from "@/services/receipts.service";
import { toast } from "@/utils/toast";

import { formatLimit, monthBounds, relativeTime, todayBounds } from "./format";

/**
 * Controls › Budgets: what Assay checks before each paid call, next to the
 * one number that matters — what the agent can actually spend, across the
 * budget, its permission on chain and the escrow's safety caps.
 *
 * - The kill switch is the first thing on the page (and in the top bar).
 * - The edit form has three fields; rate limits and the tool list sit under
 *   Advanced, and tools are picked by name, never typed as ids.
 * - "Approval required above" is not offered: approvals cannot be decided
 *   yet, so it only ever refused calls. An existing value is shown and can be
 *   removed.
 */

function summaryCharged(summary: unknown): Money | null {
  return (summary as { totals?: { chargedTotal?: Money } } | undefined)?.totals?.chargedTotal ?? null;
}

export function LimitsView() {
  const policyQuery = useSpendPolicyQuery();
  const policy = policyQuery.data ?? null;
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: () => listAgents({ limit: 50 }) });
  const { chains } = useChains();
  const bootstrap = agentsQuery.isError
    ? ({ kind: "unknown", reason: "your agents could not be read" } as const)
    : policyBootstrapAsset(agentsQuery.data?.items, chains);
  const [editing, setEditing] = React.useState(false);

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
  const spentToday = usage?.spendToday ?? summaryCharged(todaySpend.data);
  const spentMonth = usage?.spendThisMonth ?? summaryCharged(monthSpend.data);

  return (
    <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:gap-5 tablet:px-7 tablet:py-[22px]">
      <header className="flex w-full flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Budgets</h1>
          <p className="text-body-13 text-02">Limits Assay checks before each paid call. Changes apply at once.</p>
        </div>
        {policy ? (
          <Button variant="secondary" icon={<Pencil />} type="button" onClick={() => setEditing(true)}>
            Edit budget
          </Button>
        ) : null}
      </header>

      <PauseAllCard />

      {policyQuery.isPending ? (
        <PageState kind="loading" rows={3} label="Loading your budget" />
      ) : policyQuery.isError ? (
        <PageState
          kind="error"
          title="Your budget could not be loaded"
          description="This says nothing about your limits: they still apply."
          code={policyQuery.error instanceof ApiError ? policyQuery.error.code : null}
          onRetry={() => void policyQuery.refetch()}
        />
      ) : (
        <>
          <EffectiveLimitCard policy={policy} spentToday={spentToday} spentMonth={spentMonth} />

          {!policy ? (
            <PageState
              kind="empty"
              title="No budget yet"
              description={
                <>
                  Without one, only your safety caps and balance limit spending.{" "}
                  <span data-testid="policy-bootstrap-note">
                    {bootstrap.kind === "ready"
                      ? `Amounts are in ${bootstrap.symbol} on ${bootstrap.chainName}.`
                      : bootstrap.kind === "reading"
                        ? "Reading which asset your agent pays in…"
                        : `A budget cannot be created right now: ${bootstrap.reason}.`}
                  </span>
                </>
              }
              action={bootstrap.kind === "ready" ? { label: "Set a budget", icon: <Plus />, onClick: () => setEditing(true) } : undefined}
            />
          ) : (
            <BudgetCard policy={policy} spentToday={spentToday} spentMonth={spentMonth} />
          )}

          <p className="text-body-13 text-02">
            You get an alert at 50%, 80% and 100% of your daily and monthly budgets.{" "}
            <Link href="/alerts" className="font-semibold text-primary-600 hover:underline">
              Alert settings
            </Link>
          </p>

          {policy ? <History /> : null}
        </>
      )}

      <BudgetSheet
        open={editing}
        onOpenChange={setEditing}
        policy={policy}
        bootstrap={bootstrap.kind === "ready" ? bootstrap : null}
      />
    </div>
  );
}

function EffectiveLimitCard({
  policy,
  spentToday,
  spentMonth,
}: {
  policy: SpendPolicy | null;
  spentToday: Money | null;
  spentMonth: Money | null;
}) {
  const data = useAgentsAndKeys();
  const [agentId, setAgentId] = React.useState<string | null>(null);
  const agent = data.agents.find((a) => a.agentId === agentId) ?? data.agents[0];
  if (!agent) return null;
  const readiness = data.readiness[agent.agentId];
  const grant = readiness?.grant?.status === "ACTIVE" ? readiness.grant : null;
  const escrow = data.escrowQuery.data;
  const capsSet = capsAreSet(escrow);

  const rows: EffectiveLimitRow[] = [
    {
      id: "call",
      label: "Per call",
      sources: [
        { source: "Budget", value: policy?.perCallMax ?? null },
        ...(policy?.requireApprovalAbove ? [{ source: "Older refuse-above rule", value: policy.requireApprovalAbove }] : []),
        { source: "Agent permission", value: grant?.maxVoucherAmount ?? null },
        { source: "Safety caps", value: capsSet ? (escrow?.maxVoucherAmount ?? null) : null },
      ],
    },
    {
      id: "day",
      label: "Per day",
      sources: [
        { source: "Budget", value: policy?.dailyCap ?? null, used: spentToday },
        { source: "Agent permission", value: grant?.maxPerWindow ?? null, used: grant?.spentInWindow },
        { source: "Safety caps", value: capsSet ? (escrow?.maxPerWindow ?? null) : null, used: escrow?.spentInWindow },
      ],
    },
    { id: "month", label: "Per month", sources: [{ source: "Budget", value: policy?.monthlyCap ?? null, used: spentMonth }] },
  ];

  const stopped =
    policy?.paused === true
      ? "All paid calls are paused, so this agent can spend nothing until you resume."
      : readiness && ["caps-not-set", "needs-authorisation", "withdrawal-pending", "no-key", "revoked"].includes(readiness.status)
        ? `${readiness.sentence}`
        : undefined;

  return (
    <div className="flex w-full flex-col gap-2">
      {data.agents.length > 1 ? (
        <Segmented value={agent.agentId} onValueChange={setAgentId} aria-label="Agent">
          {data.agents.map((a) => (
            <SegmentedItem key={a.agentId} value={a.agentId}>
              {a.label ?? "Agent"}
            </SegmentedItem>
          ))}
        </Segmented>
      ) : null}
      <EffectiveLimit
        title={`What ${agent.label ?? "this agent"} can spend`}
        rows={rows}
        stopped={stopped}
        footer="The lowest limit wins. Budgets are checked by Assay; the agent's permission and your safety caps are enforced on chain."
      />
    </div>
  );
}

function BudgetCard({ policy, spentToday, spentMonth }: { policy: SpendPolicy; spentToday: Money | null; spentMonth: Money | null }) {
  const { lookup } = useEntityNames({ kinds: ["tool"] });
  const zero: Money = { amount: "0", asset: policy.asset, decimals: policy.decimals };
  const advanced = [
    policy.maxCallsPerMinute != null ? `${policy.maxCallsPerMinute} calls a minute` : null,
    policy.maxCallsPerHour != null ? `${policy.maxCallsPerHour} calls an hour` : null,
    policy.maxSpendPerHour ? `${formatLimit(policy.maxSpendPerHour)} an hour` : null,
  ].filter(Boolean);
  const tools =
    policy.allowedTools === null
      ? "Every tool"
      : policy.allowedTools.length === 0
        ? "No tool (every paid call is refused)"
        : `Only ${policy.allowedTools.map((id) => lookup("tool", id) ?? "a tool no longer listed").join(", ")}`;

  return (
    <section aria-label="Budget" className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 p-4 shadow-hair tablet:p-5">
      <h2 className="text-label-md text-01">Your budget</h2>
      <p className="text-body-13 text-02">
        Per call: <span className="font-mono text-01">{policy.perCallMax ? formatLimit(policy.perCallMax) : "no limit"}</span>
      </p>
      <CapMeter
        label="Today"
        used={spentToday ?? zero}
        limit={policy.dailyCap}
        refillsAt={policy.dailyCap ? nextUtcMidnight() : null}
        consequence="Paid calls are refused"
      />
      <CapMeter
        label="This month"
        used={spentMonth ?? zero}
        limit={policy.monthlyCap}
        refillsAt={policy.monthlyCap ? nextUtcMonth() : null}
        consequence="Paid calls are refused"
      />
      <p className="text-body-xs text-03">
        Tools: {tools}
        {advanced.length > 0 ? ` · At most ${advanced.join(", ")}` : ""}
        {policy.requireApprovalAbove ? ` · Calls above ${formatLimit(policy.requireApprovalAbove)} are refused (older rule)` : ""}
      </p>
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
          <p className="py-2 text-body-13 text-03">Loading…</p>
        ) : history.isError ? (
          <p className="py-2 text-body-13 text-02">The history could not be loaded.</p>
        ) : items.length === 0 ? (
          <p className="py-2 text-body-13 text-03">No changes yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-01">
            {items.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5 py-2">
                <span className="text-body-13 text-01">{entry.changeReason ?? "Budget changed"}</span>
                <span className="text-body-xs text-03">
                  {plainActor(entry.changedBy)} · <LocalTime value={entry.changedAt} /> ({relativeTime(entry.changedAt)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function BudgetSheet({
  open,
  onOpenChange,
  policy,
  bootstrap,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy: SpendPolicy | null;
  bootstrap: { assetId: string; decimals: number; symbol: string } | null;
}) {
  const queryClient = useQueryClient();
  const { index } = useEntityNames({ kinds: ["tool"] });
  const toolOptions = React.useMemo(
    () => [...index.tool.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    [index],
  );
  const [form, setForm] = React.useState<BudgetForm>(() => budgetFormFrom(policy));
  const [errors, setErrors] = React.useState<Partial<Record<BudgetField, string>>>({});
  const [seeded, setSeeded] = React.useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setForm(budgetFormFrom(policy));
    setErrors({});
  }
  if (!open && seeded) setSeeded(false);

  const decimals = policy?.decimals ?? bootstrap?.decimals ?? 6;
  const save = useMutation({
    mutationFn: (body: Parameters<typeof updateSpendPolicy>[0]) => updateSpendPolicy(body),
    onSuccess: (next) => {
      queryClient.setQueryData<SpendPolicy | null>(["spend-policy"], (previous) =>
        next.usage === undefined && previous?.usage ? { ...next, usage: previous.usage } : next,
      );
      void queryClient.invalidateQueries({ queryKey: ["spend-policy"] });
      void queryClient.invalidateQueries({ queryKey: ["spend-policy-history"] });
      toast.success("Saved. Your new budget applies from the next call.");
      onOpenChange(false);
    },
  });

  const set = (patch: Partial<BudgetForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors({});
  };
  const presetValue = BUDGET_PRESETS.find((p) => p.perCall === form.perCall && p.perDay === form.perDay && p.perMonth === form.perMonth)?.id ?? "";

  const submit = () => {
    const result = budgetPatch(form, policy, decimals, !policy);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    if (!result.changed) {
      toast.info("Nothing changed.");
      onOpenChange(false);
      return;
    }
    const body = { ...result.body };
    if (!policy && bootstrap) {
      body.assetId = bootstrap.assetId;
      body.decimals = bootstrap.decimals;
    }
    save.mutate(body);
  };

  const unit = bootstrap?.symbol ?? "USD";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{policy ? "Edit budget" : "Set a budget"}</SheetTitle>
          <SheetDescription>Leave a field empty for no limit. Applies to every agent on this account.</SheetDescription>
        </SheetHeader>
        <form
          className="flex w-full flex-col gap-4 px-[18px] pb-4 pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <PresetChips
            label="Budget presets"
            allowCustom={false}
            value={presetValue}
            onChange={() => undefined}
            presets={BUDGET_PRESETS.map((p) => ({
              value: p.id,
              label: p.label,
              description: `$${p.perCall} a call · $${p.perDay} a day · $${p.perMonth} a month`,
              onPick: () => set({ perCall: p.perCall, perDay: p.perDay, perMonth: p.perMonth }),
            }))}
          />
          <Field id="budget-per-call" label="Most per call" inputMode="decimal" suffix={unit} placeholder="No limit" value={form.perCall} error={errors.perCall} onChange={(e) => set({ perCall: e.target.value })} />
          <Field id="budget-per-day" label="Most per day" inputMode="decimal" suffix={unit} placeholder="No limit" hint="Resets at 00:00 UTC." value={form.perDay} error={errors.perDay} onChange={(e) => set({ perDay: e.target.value })} />
          <Field id="budget-per-month" label="Most per month" inputMode="decimal" suffix={unit} placeholder="No limit" value={form.perMonth} error={errors.perMonth} onChange={(e) => set({ perMonth: e.target.value })} />

          <details className="rounded-lg border border-01 bg-02 px-3 py-2.5" open={Boolean(errors.callsPerMinute || errors.callsPerHour || errors.spendPerHour || errors.tools)}>
            <summary className="cursor-pointer select-none text-label-13 text-01">Advanced: rate limits and tools</summary>
            <div className="mt-3 flex flex-col gap-4">
              <Field id="budget-calls-minute" label="Calls per minute" inputMode="numeric" placeholder="No limit" hint="Stops a retry loop. Refused attempts count too." value={form.callsPerMinute} error={errors.callsPerMinute} onChange={(e) => set({ callsPerMinute: e.target.value })} />
              <Field id="budget-calls-hour" label="Calls per hour" inputMode="numeric" placeholder="No limit" value={form.callsPerHour} error={errors.callsPerHour} onChange={(e) => set({ callsPerHour: e.target.value })} />
              <Field id="budget-spend-hour" label="Spend per hour" inputMode="decimal" suffix={unit} placeholder="No limit" value={form.spendPerHour} error={errors.spendPerHour} onChange={(e) => set({ spendPerHour: e.target.value })} />
              <div className="flex flex-col gap-2">
                <span className="text-label-13 text-01">Tools your agents may pay for</span>
                <Segmented value={form.toolsMode} onValueChange={(v) => set({ toolsMode: v as BudgetForm["toolsMode"] })} aria-label="Tools allowed">
                  <SegmentedItem value="all">Every tool</SegmentedItem>
                  <SegmentedItem value="only">Only these</SegmentedItem>
                  <SegmentedItem value="none">None</SegmentedItem>
                </Segmented>
                {form.toolsMode === "only" ? (
                  <>
                    {form.tools.length > 0 ? (
                      <ul className="flex flex-wrap gap-1.5">
                        {form.tools.map((id) => (
                          <li key={id} className="inline-flex items-center gap-1 rounded-full bg-03 py-0.5 pl-2.5 pr-1 text-label-xs text-01">
                            {index.tool.get(id) ?? "A tool no longer listed"}
                            <button
                              type="button"
                              aria-label={`Remove ${index.tool.get(id) ?? "this tool"}`}
                              className="rounded-full p-0.5 text-03 hover:bg-02 hover:text-01"
                              onClick={() => set({ tools: form.tools.filter((t) => t !== id) })}
                            >
                              <X aria-hidden="true" className="size-3" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <EntityPicker
                      label="Add a tool"
                      value={null}
                      placeholder="Search tools by name"
                      options={toolOptions.filter((o) => !form.tools.includes(o.id))}
                      onChange={(id) => id && set({ tools: [...form.tools, id] })}
                      error={errors.tools}
                    />
                  </>
                ) : form.toolsMode === "none" ? (
                  <p className="text-body-xs text-warning-700">Every paid call is refused. Free calls still work.</p>
                ) : null}
              </div>
              {policy?.requireApprovalAbove ? (
                <label className="flex items-start gap-2 text-body-13 text-02">
                  <input type="checkbox" className="mt-1" checked={form.clearRefuseAbove} onChange={(e) => set({ clearRefuseAbove: e.target.checked })} />
                  Remove the older rule that refuses calls above {formatLimit(policy.requireApprovalAbove)}. The per-call limit above does the same job.
                </label>
              ) : null}
            </div>
          </details>

          <Field id="budget-reason" label="Note (optional)" placeholder="e.g. raised for the launch week" value={form.reason} onChange={(e) => set({ reason: e.target.value })} hint="Shown in the change history." />
          {save.isError ? (
            <p role="alert" className="text-body-13 text-danger-600">
              {save.error instanceof ApiError ? plainError(save.error.code) : "The budget could not be saved. Try again."}
            </p>
          ) : null}
        </form>
        <SheetFooter className="sticky bottom-0 bg-01">
          <Button type="button" className="w-full" loading={save.isPending} onClick={submit}>
            {policy ? "Save budget" : "Create budget"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
