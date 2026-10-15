"use client";

import * as React from "react";

import { Arithmetic, type ArithmeticRow } from "@/components/ui/arithmetic";
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
 * on the operator page the split is drawn once, in "Where the money goes"
 * (`PenaltyMoney`), so this ends at the penalty. Labels come from the same
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

export function OperatorMeasurement({ data }: { data: SlashProposalCaseDetail }) {
  const rows: ArithmeticRow[] = data.arithmetic.map((row) => {
    const presented = presentArithmeticRow(row, data.proposal.penaltyAmount);
    return {
      id: row.key,
      label: operatorRowLabel(row.key),
      expression: presented.expression ? aboutProvider(presented.expression) : undefined,
      value: presented.value,
      note: presented.note ? aboutProvider(presented.note) : undefined,
      valueTone: toneMap[row.tone],
    };
  });
  const subject = data.priorWindows.find((window) => window.isSubject);
  const subtitle = [
    data.proposal.windowLabel ? `window ${data.proposal.windowLabel}` : null,
    subject ? `closed ${formatLocalDateTime(subject.closedAt)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Panel>
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>The measurement</PanelTitle>
          <PanelDescription>{subtitle}</PanelDescription>
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
            {/* Phone and narrow tablet: label over value, nothing clipped or scrolled sideways. */}
            <dl className="flex w-full flex-col py-1 tablet:hidden">
              {rows.map((row, index) => (
                <div key={row.id ?? `${row.label}-${index}`} className={cn("flex w-full flex-col gap-0.5 px-4 py-2.5", index % 2 === 1 && "bg-02")}>
                  <dt className="text-body-xs text-03">{row.label}</dt>
                  <dd className={cn("break-words font-mono text-mono-13 font-semibold", VALUE_TONE[row.valueTone ?? "default"])}>{row.value}</dd>
                  {row.expression ? <dd className="break-all font-mono text-mono-12 text-03">{row.expression}</dd> : null}
                  {row.note ? <dd className="text-body-xs text-03">{row.note}</dd> : null}
                </div>
              ))}
            </dl>
            <div className="hidden w-full overflow-x-auto tablet:block">
              <div className="min-w-[720px] py-2">
                <Arithmetic rows={rows} />
              </div>
            </div>
          </>
        )}
        <p className="border-t border-01 bg-02 px-5 py-3 text-body-xs text-02">
          Where the penalty goes is shown once, under &ldquo;Where the money goes&rdquo; above.
        </p>
      </PanelBody>
    </Panel>
  );
}
