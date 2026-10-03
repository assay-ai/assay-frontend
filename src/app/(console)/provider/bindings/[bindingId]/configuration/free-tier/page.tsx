"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Rocket, TriangleAlert } from "lucide-react";
import { useParams } from "next/navigation";
import * as React from "react";

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
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";

import {
  integerFromInput,
  majorInputFromMoney,
  minorUnitsFromMajorInput,
  moneyFromMinorNumber,
  Note,
  PageHeader,
} from "@/features/provider-binding/chrome";

/**
 * Free-tier controls.
 * Route `/provider/bindings/[bindingId]/configuration/free-tier`.
 *
 * ## `freeDailyBudget` has two types, and this file does not hide it
 *
 * The same field **reads as `number | null` and writes as a digits-only
 * string**, both in minor units. That is the backend's asymmetry, and the read
 * side breaks the project's money rule (money crosses the wire as a string).
 * It is handled in exactly two places and never laundered into one type:
 *
 *  - read  → `moneyFromMinorNumber()` turns the number into a `Money` at the
 *            boundary, so every render still goes through `formatMoney` and no
 *            amount is ever a JS number downstream;
 *  - write → `minorUnitsFromMajorInput()` turns the box's major-unit text into
 *            the digits-only string the PATCH body validates. Sending the
 *            number back verbatim is rejected: `freeDailyBudget must be an
 *            integer in minor units`.
 *
 * Clearing the box sends `null` (the API's "no budget"); leaving it untouched
 * omits the key. The two are distinguishable on purpose and are not collapsed.
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
  const params = useParams<{ bindingId: string }>();
  const bindingId = params.bindingId;
  const queryClient = useQueryClient();

  const bindingQuery = useQuery({
    queryKey: ["provider", "tool-binding", bindingId],
    queryFn: () => getToolBinding(bindingId),
    enabled: Boolean(bindingId),
  });
  const binding = bindingQuery.data;

  const decimals = binding?.price.decimals ?? 6;
  const asset = binding?.price.asset ?? "";

  /** The read side, converted at the boundary and nowhere else. */
  const savedBudget = moneyFromMinorNumber(binding?.freeDailyBudget, asset, decimals);

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
    setBudgetInput(
      majorInputFromMoney(moneyFromMinorNumber(binding.freeDailyBudget, binding.price.asset, binding.price.decimals))
    );
  }, [binding]);

  const quota = integerFromInput(quotaInput);
  const budget = minorUnitsFromMajorInput(budgetInput, decimals);

  const modeChanged = Boolean(binding) && mode !== "" && mode !== binding!.pricingMode;
  const quotaChanged = Boolean(binding) && quota.error === null && quota.value !== binding!.freeQuotaPerAgent;
  const budgetChanged =
    Boolean(binding) &&
    budget.error === null &&
    budget.amount !== (savedBudget ? savedBudget.amount : null);

  const hasChanges = modeChanged || quotaChanged || budgetChanged;
  const hasError = Boolean(quota.error || budget.error);

  const save = useMutation({
    mutationFn: () => {
      const body: UpdateToolBindingBody = {};
      if (modeChanged) body.pricingMode = mode;
      // `null` clears the ceiling; omitting the key leaves it alone. Both
      // fields below send `null` only when the box was actually emptied.
      if (quotaChanged) body.freeQuotaPerAgent = quota.value;
      if (budgetChanged) body.freeDailyBudget = budget.amount;
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
        sub="the freemium funnel: agents try before funding, you build a published quality record without capital at risk"
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

            <Field
              id="free-quota-per-agent"
              label="Per-agent daily quota"
              inputMode="numeric"
              value={quotaInput}
              onChange={(event) => setQuotaInput(event.target.value)}
              suffix="calls"
              error={quota.error ?? undefined}
              hint="platform-wide free budget applies on top"
              disabled={!binding}
            />

            {/*
              Not in the design. `freeDailyBudget` is a writable field on this
              binding and the only control for the budget the quota hint above
              points at, so a screen called "Free-tier controls" that omits it
              leaves the provider no way to set it anywhere in the console. Its
              label and hint are the design's own strings for this quantity,
              taken from the Consumption panel's second meter.
            */}
            <Field
              id="free-daily-budget"
              label="Platform free budget"
              inputMode="decimal"
              value={budgetInput}
              onChange={(event) => setBudgetInput(event.target.value)}
              suffix="USD"
              error={budget.error ?? undefined}
              hint={
                budget.error
                  ? undefined
                  : savedBudget
                    ? `saved as ${formatMoney(savedBudget, { decimals: 4 })} per day · At exhaustion agents see FREE_BUDGET_EXHAUSTED with your paid alternative and its price. That is our cost control, not your fault, and the copy says so.`
                    : "At exhaustion agents see FREE_BUDGET_EXHAUSTED with your paid alternative and its price. That is our cost control, not your fault, and the copy says so."
              }
              disabled={!binding}
            />
          </PanelBody>
        </Panel>

        <Panel className="desktop:w-[560px] desktop:flex-none">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Consumption</PanelTitle>
              <PanelDescription>platform-funded · relay path, no payment machinery</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="p-5">
            <EmptyState
              className="max-w-none"
              icon={null}
              title="Free-tier consumption is not measured"
              description="No provider endpoint reports free calls served today or free budget consumed, so neither meter can be drawn — and a bar at zero would read as a measurement. The rule still holds: at exhaustion agents see FREE_BUDGET_EXHAUSTED with your paid alternative and its price. That is our cost control, not your fault, and the copy says so."
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
