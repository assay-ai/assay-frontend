"use client";

import { GitCompare } from "lucide-react";
import * as React from "react";

import {
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { count, percent, stampUtc } from "@/features/g34a/stats";
import type { SlashAttributionRow } from "@/interfaces/provider-disputes";
import type { SlashProposalCaseDetail, SlashPriorWindow } from "@/interfaces/provider-slash-cases";

/**
 * `dObK1`'s Context panel — the previous windows, the change overlay, and the
 * two attribution columns.
 *
 * Its subtitle is the platform making a promise about its own incentives —
 * *"we would rather find our own defect than win a dispute about it"* — and
 * every element under it is the evidence a provider would otherwise have to
 * assemble by hand to argue against the penalty.
 *
 * ## The bars
 *
 * `priorWindows` is this window and up to five before it, oldest first, and
 * only `CLOSED` windows appear — an open window has no settled rate to plot.
 * There may be fewer than six (a young binding), and the strip renders what
 * is there rather than padding to six. Heights are drawn against the largest
 * rate in the set, not against a fixed ceiling, because the interesting fact
 * is the *step*, and a fixed axis flattens it whenever the subject is small.
 *
 * ## The change overlay
 *
 * Null whenever no binding or mapping edit published inside the window, and
 * the DTO's own comment says that "read honestly, is itself evidence". The
 * panel says so rather than hiding the row.
 *
 * The design's second sentence — *"It is prefilled as a dispute claim."* — is
 * a claim about the dispute form's behaviour, so it renders only when `suggestedClaim`
 * is actually `PLATFORM_MAPPING_CHANGE`. The overlay existing does not by
 * itself mean the claim was prefilled: the server prefills it only when the
 * majority of failures fall after the edit.
 *
 * The design's **View diff** control has no destination in this app — no route
 * renders a diff between two `binding_versions`, and no endpoint returns one.
 * The version pair the diff would be *of* is real (`fromVersion` →
 * `toVersion`) and is rendered as text; the button is not drawn, because a
 * button that goes nowhere is a worse answer than no button.
 *
 * ## The attribution columns
 *
 * `failuresByRule` keys are the verification engine's own reason codes
 * (`insufficient_results`, `stale_timestamp`); `failuresByAgent` keys are
 * agent UUIDs. The design writes agents as `ag_7K2`, which is a rendering
 * convention **no backend field supplies** — `SlashAttributionRow.key` is the
 * raw id. It is shortened for width and carries a `title` with the full value,
 * rather than being re-encoded into a label that would not match anything a
 * provider could search for.
 *
 * Both lists are already truncated server-side to the top three plus an
 * "N others" row, so this renders whatever arrives without re-truncating.
 */

/** The design's `ag_7K2`-width column, without inventing a new identifier. */
function shortKey(key: string): string {
  return key.length > 18 ? `${key.slice(0, 8)}…` : key;
}

function Bars({ windows }: { windows: SlashPriorWindow[] }) {
  if (windows.length === 0) {
    return (
      <p className="px-5 py-4 text-body-13 text-02">
        No earlier window has closed for this binding, so there is nothing to compare this one
        against.
      </p>
    );
  }

  const peak = Math.max(...windows.map((w) => w.observedRate), 0.0001);

  // The server sends the six most recent CLOSED windows for the binding,
  // whichever one the case is about. That is normally the newest, and then the
  // design's own words are exact. It is NOT the newest for an older case — and
  // then "previous N windows" would be a claim about ordering that the strip
  // itself contradicts, so the label says what is actually drawn instead.
  const subjectIsNewest = windows[windows.length - 1]?.isSubject ?? false;

  return (
    <div className="flex w-full items-end gap-3 overflow-x-auto px-5 py-4">
      <span className="shrink-0 self-center font-mono text-mono-12 text-03">
        {subjectIsNewest
          ? `previous ${Math.max(0, windows.length - 1)} windows`
          : `last ${windows.length} closed windows`}
      </span>
      <div className="flex min-w-0 flex-1 items-end justify-end gap-2 tablet:gap-4">
        {windows.map((window) => {
          const height = Math.max(6, Math.round((window.observedRate / peak) * 96));
          return (
            <div key={window.windowId} className="flex flex-col items-center gap-1.5">
              <span className="sr-only">
                {window.label}: {percent(window.observedRate)} observed failure rate, closed{" "}
                {stampUtc(window.closedAt)} UTC
              </span>
              <div
                aria-hidden="true"
                style={{ height: `${height}px` }}
                className={
                  window.isSubject
                    ? "w-9 rounded-[3px] bg-danger-500 tablet:w-11"
                    : "w-9 rounded-[3px] bg-03 tablet:w-11"
                }
              />
              <span
                aria-hidden="true"
                className={
                  window.isSubject
                    ? "font-mono text-mono-12 font-semibold text-danger-600"
                    : "font-mono text-mono-12 text-03"
                }
              >
                {percent(window.observedRate, 1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AttributionColumn({
  title,
  rows,
  mono,
}: {
  title: string;
  rows: SlashAttributionRow[];
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <p className="font-mono text-mono-12 text-03">{title}</p>
      {rows.length === 0 ? (
        <p className="text-body-13 text-02">nothing recorded</p>
      ) : (
        <dl className="flex w-full flex-col">
          {rows.map((row) => (
            <div key={row.key} className="flex w-full items-center justify-between gap-3 py-[5px]">
              <dt title={row.key} className="min-w-0 truncate font-mono text-mono-13 text-01">
                {mono ? shortKey(row.key) : row.key}
              </dt>
              <dd className="shrink-0 font-mono text-mono-13 font-semibold text-01">
                {count(row.count)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function CaseContext({ data }: { data: SlashProposalCaseDetail }) {
  const overlay = data.changeOverlay;
  const totalOverlayFailures = overlay ? overlay.failuresBefore + overlay.failuresAfter : 0;
  const prefilled = data.suggestedClaim === "PLATFORM_MAPPING_CHANGE";

  return (
    <Panel>
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>Context</PanelTitle>
          {/* Not `PanelDescription`: that primitive truncates to one line, and
              this subtitle is two sentences the design wraps. */}
          <p className="text-body-xs leading-[1.5] text-03">
            we build your strongest argument for you — we would rather find our own defect than win
            a dispute about it
          </p>
        </PanelTitles>
      </PanelHeader>

      <PanelBody>
        <Bars windows={data.priorWindows} />

        {overlay ? (
          <div className="mx-5 mb-4 flex w-auto items-start gap-3 rounded-lg bg-warning-10 px-4 py-3.5">
            <GitCompare aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-600" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-label-sm text-01">
                {count(overlay.failuresAfter)} of your {count(totalOverlayFailures)} failures
                occurred after a binding change on {stampUtc(overlay.changedAt)} by{" "}
                {overlay.changedBy}
              </p>
              <p className="text-body-13 leading-[1.55] text-02">
                {percent(overlay.rateBefore, 1)} before the change ({count(overlay.verifiedBefore)}{" "}
                verified calls) against {percent(overlay.rateAfter, 1)} after (
                {count(overlay.verifiedAfter)}). This may be a mapping defect on our side rather
                than a change in your data.
                {prefilled ? " It is prefilled as a dispute claim." : ""}
              </p>
              <p className="font-mono text-mono-12 text-03">
                {overlay.fromVersion} → {overlay.toVersion}
              </p>
            </div>
          </div>
        ) : (
          <p className="border-t border-01 px-5 py-3.5 text-body-13 text-02">
            No binding or mapping edit published inside this window, so nothing here correlates the
            failures with a change on our side.
          </p>
        )}

        <div className="flex w-full flex-col gap-5 border-t border-01 px-5 py-4 tablet:flex-row tablet:gap-8">
          <AttributionColumn title="failures by rule" rows={data.failuresByRule} />
          <AttributionColumn title="failures by agent" rows={data.failuresByAgent} mono />
        </div>
      </PanelBody>
    </Panel>
  );
}
