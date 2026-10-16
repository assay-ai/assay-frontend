"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Rocket, TriangleAlert } from "lucide-react";
import * as React from "react";

import { BindingNav } from "@/features/provider-binding/binding-nav";
import { freeFirstHint } from "@/features/provider-binding/free-first";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import type { PricingMode, UpdateToolBindingBody } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import {
  getToolBinding,
  updateToolBinding,
} from "@/services/provider-tool-bindings.service";
import { toast } from "@/utils/toast";

import { dailyCallsFromInput, integerFromInput, Note, PageHeader } from "@/features/provider-binding/chrome";
import { useSearchParam } from "@/hooks/useSearchParam";

/**
 * Free-tier controls.
 * Route `/provider/bindings/[bindingId]/configuration/free-tier`.
 *
 * ## Two limits, both call counts
 *
 *  - `freeQuotaPerAgent`: the free calls **one agent** gets from this binding
 *    per day.
 *  - `freeDailyBudget`: the most free calls **this binding** serves per day,
 *    across all agents together. A call count, not money (BUG-R17g-01): the
 *    backend enforces it by counting free calls, and the PATCH body takes a
 *    whole number.
 *
 * Both read and write as `number | null`. Clearing a box sends `null` (the
 * platform default); leaving it untouched omits the key. The two are
 * distinguishable on purpose and are not collapsed.
 *
 * ## Two things the design draws that the API cannot back
 *
 *  - **"Result cap on the free path" (3 items).** `UpdateToolBindingBody` has
 *    no result-cap field — not under any name — so the control is absent
 *    rather than rendered as a box that saves nothing. Its hint ("Your
 *    measured free-tier failure rate is not comparable to paid…") is real
 *    product copy that goes with it, and is lost with it.
 *  - **The whole "Consumption" panel.** Both meters need a *usage* numerator —
 *    free calls served today, free budget consumed — and no provider endpoint
 *    reports either. `/traffic` buckets by intent status, not by call class,
 *    and has no free-budget figure. The panel keeps its header and renders an
 *    empty state; drawing a meter at 0% would assert a measurement.
 *
 * ## Known backend defect, not this screen's bug
 *
 * A binding in `FREE` mode 409s at call time — `secureFunds` → `createHold`
 * refuses a zero amount. The mode is still offered here, because the configuration write
 * itself succeeds and papering over it in the UI would hide the defect.
 */

/** The free-tier controls screen's own wording for FREEMIUM, which differs from the pricing screen's. Both verbatim. */
const MODE_LABEL: Record<PricingMode, string> = {
  FREE: "Free",
  FREEMIUM: "Freemium — capped preview, paid full result",
  PAID: "Paid",
};

export default function FreeTierPage() {
  const bindingId = useSearchParam("binding");
  const queryClient = useQueryClient();

  const bindingQuery = useQuery({
    queryKey: ["provider", "tool-binding", bindingId],
    queryFn: () => getToolBinding(bindingId),
    enabled: Boolean(bindingId),
  });
  const binding = bindingQuery.data;

  const [mode, setMode] = React.useState<PricingMode | "">("");
  const [quotaInput, setQuotaInput] = React.useState("");
  const [budgetInput, setBudgetInput] = React.useState("");

  const seededFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!binding) return;
    const stamp = `${binding.id}:${binding.version}:${binding.freeQuotaPerAgent}:${binding.freeDailyBudget}`;
    if (seededFor.current === stamp) return;
    seededFor.current = stamp;
    setMode(binding.pricingMode);
    setQuotaInput(binding.freeQuotaPerAgent == null ? "" : String(binding.freeQuotaPerAgent));
    setBudgetInput(binding.freeDailyBudget == null ? "" : String(binding.freeDailyBudget));
  }, [binding]);

  const quota = integerFromInput(quotaInput);
  const budget = dailyCallsFromInput(budgetInput);

  const modeChanged = Boolean(binding) && mode !== "" && mode !== binding!.pricingMode;
  const quotaChanged = Boolean(binding) && quota.error === null && quota.value !== binding!.freeQuotaPerAgent;
  const budgetChanged = Boolean(binding) && budget.error === null && budget.value !== binding!.freeDailyBudget;

  const hasChanges = modeChanged || quotaChanged || budgetChanged;
  const hasError = Boolean(quota.error || budget.error);

  const save = useMutation({
    mutationFn: () => {
      const body: UpdateToolBindingBody = {};
      if (modeChanged) body.pricingMode = mode;
      // `null` clears the ceiling; omitting the key leaves it alone. Both
      // fields below send `null` only when the box was actually emptied.
      if (quotaChanged) body.freeQuotaPerAgent = quota.value;
      if (budgetChanged) body.freeDailyBudget = budget.value;
      return updateToolBinding(bindingId, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider"] });
      toast.success("Free tier saved");
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "Could not save the free tier");
    },
  });

  if (bindingQuery.isError) {
    const error = bindingQuery.error;
    return (
      <Note tone="warning" icon={<TriangleAlert className="h-full w-full" />}>
        {error instanceof ApiError ? error.message : "This binding could not be loaded."}
      </Note>
    );
  }

  return (
    <>
      <PageHeader
        title={`Free tier · ${bindingId}`}
        sub="agents try your tool before funding, and you build a published quality record without staking"
        actions={
          <Button
            icon={<Check />}
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!binding || !hasChanges || hasError}
          >
            Save
          </Button>
        }
      />

      <BindingNav bindingId={bindingId} />

      <div className="flex w-full flex-col items-start gap-4 desktop:flex-row">
        <Panel className="flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Free offer</PanelTitle>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3.5 p-5">
            <Select
              label="Mode"
              value={mode}
              disabled={!binding}
              onChange={(event) => setMode(event.target.value as PricingMode)}
            >
              {(["FREE", "FREEMIUM", "PAID"] as const).map((value) => (
                <option key={value} value={value}>
                  {MODE_LABEL[value]}
                </option>
              ))}
            </Select>
            {freeFirstHint(mode) ? <p className="text-body-xs text-03">{freeFirstHint(mode)}</p> : null}

            <Field
              id="free-quota-per-agent"
              label="Free calls per agent, per day"
              inputMode="numeric"
              value={quotaInput}
              onChange={(event) => setQuotaInput(event.target.value)}
              suffix="calls"
              error={quota.error ?? undefined}
              hint="what one agent can use from this binding · resets at 00:00 UTC · the platform's own per-agent limit applies on top"
              disabled={!binding}
            />

            {/*
              Not in the design. `freeDailyBudget` is a writable field on this
              binding and the only control for the binding-wide cap, so a
              screen called "Free-tier controls" that omits it leaves the
              provider no way to set it anywhere in the console.
            */}
            <Field
              id="free-daily-budget"
              label="Free calls per day (all agents)"
              inputMode="numeric"
              value={budgetInput}
              onChange={(event) => setBudgetInput(event.target.value)}
              suffix="calls"
              error={budget.error ?? undefined}
              hint={
                budget.error
                  ? undefined
                  : "The most free calls this binding serves in a day, all agents together. Leave empty for the platform default. Resets at 00:00 UTC. When it runs out, agents are told the free calls are used up and are offered the tool's paid option with its price."
              }
              disabled={!binding}
            />
          </PanelBody>
        </Panel>

        <Panel className="desktop:w-[560px] desktop:flex-none">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Consumption</PanelTitle>
              <PanelDescription>free calls are funded by the platform</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="p-5">
            <EmptyState
              className="max-w-none"
              icon={null}
              title="Free-tier usage is not available yet"
              description="Free calls served today are not shown yet. The limits you set still apply: when one runs out, agents are told so and are offered the tool's paid option with its price."
            />
          </PanelBody>
        </Panel>
      </div>

      <Note tone="teal" icon={<Rocket className="h-full w-full" />}>
        Free traffic builds a published quality record you can cite in your own sales — and lets you stake only when
        you decide to charge.
      </Note>
    </>
  );
}
