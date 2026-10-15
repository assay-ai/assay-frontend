"use client";

import * as React from "react";

import type { ArithmeticRow } from "@/components/ui/arithmetic";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { arithmeticLabel, presentArithmeticRow } from "@/features/provider-slash-case/labels";
import type { SlashProposalCaseDetail } from "@/interfaces/provider-slash-cases";
import { formatLocalDateTime } from "@/libs/local-time";
import { cn } from "@/utils";

/**
 * The penalty's measurement, for an operator: the frozen derivation the
 * server sends, row by row, in plain labels.
 *
 * The provider screen's `Measurement` speaks to the provider ("never taken
 * from you", "the rate you declared") and ends in its own Distribution line;
 * on the operator page the split is drawn once, in the money card
 * (`PenaltyMoney`), so this ends at the penalty.
 *
 * Labels are prose, so they are sans; values are right-aligned tabular
 * figures; only the breach formula keeps the mono face. The verdict
 * ("Breach: 12.62% failed vs 6.81% allowed") leads the table. Labels come from the same
 * `./labels` table, with "you/your" turned to "the provider", and a key the
 * table does not know is put into words rather than printed raw.
 */

const VALUE_TONE: Record<NonNullable<ArithmeticRow["valueTone"]>, string> = {
  default: "text-01",
  success: "text-success-600",
  danger: "text-danger-600",
  muted: "text-02",
};

const toneMap: Record<"NEUTRAL" | "GOOD" | "BAD", ArithmeticRow["valueTone"]> = {
  NEUTRAL: "default",
  GOOD: "success",
  BAD: "danger",
};

/** "declared_rate" → "Declared rate". Pure. */
export function plainKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The provider-facing wording, said about the provider. Pure. */
export function aboutProvider(text: string): string {
  return text
    .replace(/\byou declared\b/g, "the provider declared")
    .replace(/\byour declared\b/g, "the provider's declared")
    .replace(/\bYour\b/g, "The provider's")
    .replace(/\byour\b/g, "the provider's")
    .replace(/\byou\b/g, "the provider");
}

/** One row's label: the shared table's, else the key in words — never a raw field name. */
export function operatorRowLabel(key: string): string {
  const label = arithmeticLabel(key);
  return aboutProvider(label === key ? plainKey(key) : label);
}

/** Rows whose expression is a formula, not a sentence: kept in the mono face. */
const FORMULA_KEYS = new Set(["effective_threshold", "tolerance"]);

/** "Breach: 12.62% failed vs 6.81% allowed", from the measured and threshold rows. Null without both. Pure. */
export function breachVerdict(rows: readonly { key: string; value: string }[]): string | null {
  const observed = rows.find((row) => row.key === "observed_rate")?.value;
  const threshold = rows.find((row) => row.key === "effective_threshold")?.value;
  if (!observed || !threshold) return null;
  const over = Number.parseFloat(observed) > Number.parseFloat(threshold);
  return `${over ? "Breach" : "Within the allowance"}: ${observed} failed vs ${threshold} allowed`;
}

export function OperatorMeasurement({ data }: { data: SlashProposalCaseDetail }) {
  const rows = data.arithmetic.map((row) => {
    const presented = presentArithmeticRow(row, data.proposal.penaltyAmount);
    return {
      id: row.key,
      label: operatorRowLabel(row.key),
      expression: presented.expression ? aboutProvider(presented.expression) : undefined,
      formula: FORMULA_KEYS.has(row.key),
      value: presented.value,
      note: presented.note ? aboutProvider(presented.note) : undefined,
      valueTone: toneMap[row.tone],
    };
  });
  const verdict = breachVerdict(data.arithmetic);
  const subject = data.priorWindows.find((window) => window.isSubject);
  const meta = data.proposal.windowLabel
    ? `Measured over window ${data.proposal.windowLabel}${subject ? `, closed ${formatLocalDateTime(subject.closedAt)}` : ""}`
    : subject
      ? `Window closed ${formatLocalDateTime(subject.closedAt)}`
      : null;

  return (
    <Panel>
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>The measurement</PanelTitle>
          {meta ? <PanelDescription>{meta}</PanelDescription> : null}
        </PanelTitles>
      </PanelHeader>
      <PanelBody>
        {rows.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState
              title="No window arithmetic for this penalty"
              description="It came from a single failed call rather than from a window that breached, so there is no derivation to show."
            />
          </div>
        ) : (
          <>
            {verdict ? (
              <p className="border-b border-01 bg-danger-10 px-4 py-2.5 text-label-13 tabular-nums text-danger-700 tablet:px-5">{verdict}</p>
            ) : null}
            <dl className="flex w-full flex-col">
              {rows.map((row, index) => (
                <div
                  key={row.id ?? `${row.label}-${index}`}
                  className="flex w-full items-start justify-between gap-4 border-b border-01 px-4 py-2.5 last:border-b-0 tablet:px-5"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-body-13 text-02">{row.label}</dt>
                    {row.expression ? (
                      <dd className={cn("break-words text-03", row.formula ? "font-mono text-mono-12" : "text-body-xs")}>{row.expression}</dd>
                    ) : null}
                    {row.note ? <dd className="text-body-xs text-03">{row.note}</dd> : null}
                  </div>
                  <dd className={cn("shrink-0 text-right text-body-13 font-medium tabular-nums", VALUE_TONE[row.valueTone ?? "default"])}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
