"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import * as React from "react";

import { ApiErrorSentence } from "@/components/patterns/api-error-sentence";
import { Radio } from "@/components/ui/radio";
import type { Money, PayoutCadence, PayoutSchedule } from "@/interfaces";
import { getPayoutSchedule, setPayoutCadence } from "@/services/provider-payouts.service";
import { cn } from "@/utils";
import { toast } from "@/utils/toast";

import { providerMoney } from "./not-credited";
import { CADENCE_NOTE, cadenceLabel, nextPayoutLine, PAYOUT_CADENCES, type PayoutStage } from "./payout-stages";

/**
 * The four payout stages, in order, as one list (SPEC-W2 §11). An empty stage
 * stays, in the muted text token (not opacity, which fails contrast), so the
 * reader always sees where money goes next. A plain list: the order is the
 * reading order, with no typed numbers for a screen reader to read twice.
 */
export function PayoutStagesList({ stages, compact = false }: { stages: readonly PayoutStage[]; compact?: boolean }) {
  return (
    <ul
      aria-label="Where your money is"
      className={cn("grid grid-cols-1 gap-2", compact ? "tablet:grid-cols-2" : "tablet:grid-cols-4")}
      data-testid="payout-stages"
    >
      {stages.map((stage, index) => (
        <li
          key={`${stage.key}-${index}`}
          data-testid={`payout-stage-${stage.key}`}
          className={cn(
            "flex flex-col gap-0.5 rounded-lg border px-3 py-2.5",
            // The unpaid line is its own row, never read as part of "In your wallet".
            stage.key === "unpaid" ? "col-span-full border-warning-20 bg-warning-10" : "border-01 bg-02",
          )}
        >
          <span className="text-body-xs text-03">{stage.label}</span>
          <span className={cn("font-mono text-mono-13 font-semibold", stage.empty ? "text-03" : "text-01")}>{stage.amount}</span>
          {stage.calls != null && stage.calls > 0 ? (
            <span className="text-body-xs text-03">
              {stage.calls.toLocaleString("en-US")} {stage.calls === 1 ? "call" : "calls"}
            </span>
          ) : null}
          {stage.note ? <span className="text-body-xs text-02">{stage.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export const PAYOUT_SCHEDULE_KEY = ["provider", "payout-cadence"] as const;

/** The provider's payout schedule; `data` is null on a server without it. */
export function usePayoutSchedule() {
  return useQuery({ queryKey: PAYOUT_SCHEDULE_KEY, queryFn: getPayoutSchedule, retry: 0 });
}

/**
 * The payout cadence setting (SPEC-W2 §8): every 6 hours (default) or every
 * hour once at least the hourly minimum is ready, and when the next run is.
 * Hidden on a server that does not have it.
 */
export function PayoutCadenceSetting({
  now,
  ready,
}: {
  now: number;
  /** `readyForPayout` from the earnings: says why an hourly schedule shows a later run. */
  ready?: Money | null;
}) {
  const queryClient = useQueryClient();
  const schedule = usePayoutSchedule();
  const save = useMutation({
    mutationFn: (cadence: PayoutCadence) => setPayoutCadence(cadence),
    onSuccess: (next: PayoutSchedule) => {
      queryClient.setQueryData(PAYOUT_SCHEDULE_KEY, next);
      void queryClient.invalidateQueries({ queryKey: ["provider", "earnings"] });
      toast.success("Payout schedule saved", { description: "It applies from the next payout run." });
    },
  });
  const data = schedule.data;
  if (!data) return null;
  const minimum = data.hourlyMinimum ? providerMoney(data.hourlyMinimum) : null;
  const next = nextPayoutLine(data.nextPayoutAt, now, {
    inputs: { cadence: data.cadence, minimum: data.hourlyMinimum, ready },
    format: providerMoney,
  });
  const current = save.isPending && save.variables ? save.variables : data.cadence;
  return (
    <fieldset
      className="flex flex-col gap-2 rounded-lg border border-01 bg-02 px-3.5 py-3"
      data-testid="payout-cadence"
      aria-busy={save.isPending}
    >
      <legend className="sr-only">Payout schedule</legend>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-label-13 text-01">Payout schedule</span>
        {next ? (
          <span className="inline-flex items-center gap-1 text-body-xs text-02" data-testid="next-payout">
            <Clock aria-hidden="true" className="size-3.5" />
            {next}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        {PAYOUT_CADENCES.filter((cadence) => !data.options || data.options.includes(cadence)).map((cadence) => (
          <Radio
            key={cadence}
            name="payout-cadence"
            value={cadence}
            checked={current === cadence}
            // Stays focusable while saving (no `disabled`, which drops focus): the fieldset says it is busy.
            aria-busy={save.isPending}
            onChange={() => {
              if (!save.isPending && cadence !== data.cadence) save.mutate(cadence);
            }}
            label={cadenceLabel(cadence, minimum)}
          />
        ))}
      </div>
      <p className="text-body-xs text-03">{CADENCE_NOTE}</p>
      {save.isError ? (
        <p role="alert" className="text-body-xs text-danger-600">
          <ApiErrorSentence error={save.error} />
        </p>
      ) : null}
    </fieldset>
  );
}
