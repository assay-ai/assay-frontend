"use client";

import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import * as React from "react";

import { formatLimit } from "@/components/g31/format";
import { EntityPicker } from "@/components/patterns/entity-picker";
import { Field } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { budgetFormFrom, budgetPatch, type BudgetField, type BudgetForm } from "@/features/buyer-money/budget-form";
import { hasOldBudget } from "@/features/buyer-money/spending-limits";
import { useEntityNames } from "@/hooks/useEntityNames";
import { updateSpendPolicy, type SpendPolicy } from "@/services/limits.service";

/**
 * The Assay-checked part of an agent's spending limits: per month, and rate
 * limits and tools under Advanced. Two modes:
 *
 * - `chain`: the agent's per call and per 24 hours live on chain (its payment
 *   permission). The older budget per call / per day is then cleared on save —
 *   said in the sheet before anyone saves — so the person keeps one set of
 *   numbers with one clock.
 * - `budget`: the agent has no on-chain permission (it pays from a non-EVM
 *   account), so per call and per day are Assay-checked too.
 *
 * `PATCH /spend-policy` writes the signed-in session's own agent, so this is
 * only offered for that agent; see `budgetAgentId`.
 */
export interface BudgetBootstrap {
  assetId: string;
  decimals: number;
  symbol: string;
}

export type BudgetMode = "chain" | "budget";

function seed(policy: SpendPolicy | null, mode: BudgetMode): BudgetForm {
  const form = budgetFormFrom(policy);
  return mode === "chain" ? { ...form, perCall: "", perDay: "" } : form;
}

export function useBudgetDraft({
  policy,
  bootstrap,
  open,
  mode,
}: {
  policy: SpendPolicy | null;
  bootstrap: BudgetBootstrap | null;
  open: boolean;
  mode: BudgetMode;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<BudgetForm>(() => seed(policy, mode));
  const [errors, setErrors] = React.useState<Partial<Record<BudgetField, string>>>({});
  const [seeded, setSeeded] = React.useState(false);
  if (open && !seeded) {
    setSeeded(true);
    setForm(seed(policy, mode));
    setErrors({});
  }
  if (!open && seeded) setSeeded(false);

  const decimals = policy?.decimals ?? bootstrap?.decimals ?? 6;
  const creatable = policy !== null || bootstrap !== null;
  const result = budgetPatch(form, policy, decimals, !policy);
  const dirty = creatable && (result.ok ? result.changed : true);

  const set = (patch: Partial<BudgetForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors({});
  };

  const validate = (): boolean => {
    const checked = budgetPatch(form, policy, decimals, !policy);
    if (!checked.ok) {
      setErrors(checked.errors);
      return false;
    }
    return true;
  };

  const save = async (): Promise<void> => {
    const checked = budgetPatch(form, policy, decimals, !policy);
    if (!checked.ok) {
      setErrors(checked.errors);
      throw new Error("Check the limits marked in red.");
    }
    if (!checked.changed || !creatable) return;
    const body = { ...checked.body, changeReason: form.reason.trim() || "Spending limits changed" };
    if (!policy && bootstrap) {
      body.assetId = bootstrap.assetId;
      body.decimals = bootstrap.decimals;
    }
    const next = await updateSpendPolicy(body);
    queryClient.setQueryData<SpendPolicy | null>(["spend-policy"], (previous) =>
      next.usage === undefined && previous?.usage ? { ...next, usage: previous.usage } : next,
    );
    void queryClient.invalidateQueries({ queryKey: ["spend-policy"] });
    void queryClient.invalidateQueries({ queryKey: ["spend-policy-history"] });
  };

  return { form, set, errors, dirty, validate, save, mode, policy, unit: bootstrap?.symbol ?? "USD", creatable };
}

export type BudgetDraft = ReturnType<typeof useBudgetDraft>;

export function BudgetFields({ draft, unit = draft.unit }: { draft: BudgetDraft; unit?: string }) {
  const { form, set, errors, mode, policy } = draft;
  const { index } = useEntityNames({ kinds: ["tool"] });
  const toolOptions = React.useMemo(
    () => [...index.tool.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    [index],
  );
  const advancedError = Boolean(errors.callsPerMinute || errors.callsPerHour || errors.spendPerHour || errors.tools);
  const old = mode === "chain" && hasOldBudget(policy);

  if (!draft.creatable) {
    return (
      <p className="text-body-13 text-02" data-testid="budget-unavailable">
        A monthly limit cannot be set right now: we could not tell which asset this agent pays in.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="budget-fields">
      {mode === "budget" ? (
        <>
          <Field id="budget-per-call" label="Most per call" inputMode="decimal" suffix={unit} placeholder="No limit" value={form.perCall} error={errors.perCall} onChange={(e) => set({ perCall: e.target.value })} />
          <Field
            id="budget-per-day"
            label="Most per day"
            inputMode="decimal"
            suffix={unit}
            placeholder="No limit"
            hint="A calendar day: it starts again at 00:00 UTC."
            value={form.perDay}
            error={errors.perDay}
            onChange={(e) => set({ perDay: e.target.value })}
          />
        </>
      ) : null}
      <Field
        id="budget-per-month"
        label="Most per month"
        inputMode="decimal"
        suffix={unit}
        placeholder="No limit"
        hint="Checked by Assay before each call. Starts again on the 1st at 00:00 UTC."
        value={form.perMonth}
        error={errors.perMonth}
        onChange={(e) => set({ perMonth: e.target.value })}
      />
      {old ? (
        <p className="rounded-lg bg-warning-10 px-3 py-2 text-body-13 text-warning-700" data-testid="old-budget-note">
          Assay also still checks an older budget of{" "}
          {[policy?.perCallMax ? `${formatLimit(policy.perCallMax)} a call` : null, policy?.dailyCap ? `${formatLimit(policy.dailyCap)} a day` : null]
            .filter(Boolean)
            .join(" and ")}
          . Saving removes it, so only the numbers above apply.
        </p>
      ) : null}

      <details className="rounded-lg border border-01 bg-02 px-3 py-2.5" open={advancedError || undefined}>
        <summary className="cursor-pointer select-none text-label-13 text-01">Advanced: rate limits and tools</summary>
        <div className="mt-3 flex flex-col gap-4">
          <Field id="budget-calls-minute" label="Calls per minute" inputMode="numeric" placeholder="No limit" hint="Stops a retry loop. Refused attempts count too." value={form.callsPerMinute} error={errors.callsPerMinute} onChange={(e) => set({ callsPerMinute: e.target.value })} />
          <Field id="budget-calls-hour" label="Calls per hour" inputMode="numeric" placeholder="No limit" value={form.callsPerHour} error={errors.callsPerHour} onChange={(e) => set({ callsPerHour: e.target.value })} />
          <Field id="budget-spend-hour" label="Spend per hour" inputMode="decimal" suffix={unit} placeholder="No limit" value={form.spendPerHour} error={errors.spendPerHour} onChange={(e) => set({ spendPerHour: e.target.value })} />
          <div className="flex flex-col gap-2">
            <span className="text-label-13 text-01">Tools it may pay for</span>
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
        </div>
      </details>
    </div>
  );
}
