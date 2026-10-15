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
import { formatLocalDateTime, utcTitle, zoneLabel } from "@/libs/local-time";
import { cn } from "@/utils";
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
 *
 * ## Two audiences
 *
 * The provider page speaks to the provider ("your failures", "our side").
 * The operator console reads the same panel about the provider, in Assay's
 * voice, with sans labels (mono is for ids and formulas only there):
 * `audience="operator"`.
 */

export type ContextAudience = "provider" | "operator";

const COPY: Record<
  ContextAudience,
  {
    subtitle: string;
    overlayHead: (after: string, total: string, at: string, by: string) => string;
    overlayDefect: string;
    noOverlay: string;
    byRule: string;
    byAgent: string;
  }
> = {
  provider: {
    subtitle: "we build your strongest argument for you — we would rather find our own defect than win a dispute about it",
    overlayHead: (after, total, at, by) => `${after} of your ${total} failures occurred after a binding change on ${at} by ${by}`,
    overlayDefect: "This may be a mapping defect on our side rather than a change in your data.",
    noOverlay: "No binding or mapping edit published inside this window, so nothing here correlates the failures with a change on our side.",
    byRule: "failures by rule",
    byAgent: "failures by agent",
  },
  operator: {
    subtitle: "Whether Assay itself could have caused the failures: earlier windows, recent changes, and where the failures came from.",
    overlayHead: (after, total, at, by) => `${after} of the provider's ${total} failures came after a binding change on ${at} by ${by}`,
    overlayDefect: "This may be a mapping defect at Assay rather than a change in the provider's data.",
    noOverlay: "No binding or mapping change was published inside this window, so nothing ties the failures to a change at Assay.",
    byRule: "Failures by rule",
    byAgent: "Failures by agent",
  },
};

/**
 * An instant as each audience reads times elsewhere: the provider page in UTC
 * throughout; the operator console in the reader's local time with its zone
 * (the exact UTC instant goes in a tooltip), like every other operator screen.
 */
export function contextStamp(audience: ContextAudience): (iso: string) => string {
  return audience === "provider"
    ? (iso) => `${stampUtc(iso)} UTC`
    : (iso) => `${formatLocalDateTime(iso, { midSentence: true })} ${zoneLabel(iso)}`.trim();
}

/** The design's `ag_7K2`-width column, without inventing a new identifier. */
function shortKey(key: string): string {
  return key.length > 18 ? `${key.slice(0, 8)}…` : key;
}

function Bars({ windows, mono, stamp }: { windows: SlashPriorWindow[]; mono: boolean; stamp: (iso: string) => string }) {
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
      <span className={mono ? "shrink-0 self-center font-mono text-mono-12 text-03" : "shrink-0 self-center text-body-xs text-03"}>
        {subjectIsNewest
          ? `${mono ? "p" : "P"}revious ${Math.max(0, windows.length - 1)} windows`
          : `${mono ? "l" : "L"}ast ${windows.length} closed windows`}
      </span>
      <div className="flex min-w-0 flex-1 items-end justify-end gap-2 tablet:gap-4">
        {windows.map((window) => {
          const height = Math.max(6, Math.round((window.observedRate / peak) * 96));
          return (
            <div
              key={window.windowId}
              title={mono ? undefined : `Closed ${stamp(window.closedAt)} · ${utcTitle(window.closedAt) ?? ""}`}
              className="flex flex-col items-center gap-1.5"
            >
              <span className="sr-only">
                {window.label}: {percent(window.observedRate)} observed failure rate, closed {stamp(window.closedAt)}
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
                className={cn(
                  mono ? "font-mono text-mono-12" : "text-body-xs tabular-nums",
                  window.isSubject ? "font-semibold text-danger-600" : "text-03",
                )}
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
  monoTitle = true,
}: {
  title: string;
  rows: SlashAttributionRow[];
  mono?: boolean;
  /** The provider page's mono title; the operator console's is sans. */
  monoTitle?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <p className={monoTitle ? "font-mono text-mono-12 text-03" : "text-label-13 text-03"}>{title}</p>
      {rows.length === 0 ? (
        <p className="text-body-13 text-02">nothing recorded</p>
      ) : (
        <dl className="flex w-full flex-col">
          {rows.map((row) => (
            <div key={row.key} className="flex w-full items-center justify-between gap-3 py-[5px]">
              <dt title={row.key} className="min-w-0 truncate font-mono text-mono-13 text-01">
                {mono ? shortKey(row.key) : row.key}
              </dt>
              <dd className={monoTitle ? "shrink-0 font-mono text-mono-13 font-semibold text-01" : "shrink-0 text-body-13 font-medium tabular-nums text-01"}>
                {count(row.count)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function CaseContext({ data, audience = "provider" }: { data: SlashProposalCaseDetail; audience?: ContextAudience }) {
  const copy = COPY[audience];
  const provider = audience === "provider";
  const overlay = data.changeOverlay;
  const totalOverlayFailures = overlay ? overlay.failuresBefore + overlay.failuresAfter : 0;
  const prefilled = data.suggestedClaim === "PLATFORM_MAPPING_CHANGE";
  const stamp = contextStamp(audience);

  return (
    <Panel>
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>Context</PanelTitle>
          {/* Not `PanelDescription`: that primitive truncates to one line, and
              this subtitle is two sentences the design wraps. */}
          <p className="text-body-xs leading-[1.5] text-03">{copy.subtitle}</p>
        </PanelTitles>
      </PanelHeader>

      <PanelBody>
        <Bars windows={data.priorWindows} mono={provider} stamp={stamp} />

        {overlay ? (
          <div className="mx-5 mb-4 flex w-auto items-start gap-3 rounded-lg bg-warning-10 px-4 py-3.5">
            <GitCompare aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-600" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-label-sm text-01" title={provider ? undefined : utcTitle(overlay.changedAt)}>
                {copy.overlayHead(
                  count(overlay.failuresAfter),
                  count(totalOverlayFailures),
                  provider ? stampUtc(overlay.changedAt) : stamp(overlay.changedAt),
                  overlay.changedBy,
                )}
              </p>
              <p className="text-body-13 leading-[1.55] text-02">
                {percent(overlay.rateBefore, 1)} before the change ({count(overlay.verifiedBefore)}{" "}
                verified calls) against {percent(overlay.rateAfter, 1)} after (
                {count(overlay.verifiedAfter)}). {copy.overlayDefect}
                {prefilled && provider ? " It is prefilled as a dispute claim." : ""}
              </p>
              <p className="font-mono text-mono-12 text-03">
                {overlay.fromVersion} → {overlay.toVersion}
              </p>
            </div>
          </div>
        ) : (
          <p className="border-t border-01 px-5 py-3.5 text-body-13 text-02">{copy.noOverlay}</p>
        )}

        <div className="flex w-full flex-col gap-5 border-t border-01 px-5 py-4 tablet:flex-row tablet:gap-8">
          <AttributionColumn title={copy.byRule} rows={data.failuresByRule} monoTitle={provider} />
          <AttributionColumn title={copy.byAgent} rows={data.failuresByAgent} mono monoTitle={provider} />
        </div>
      </PanelBody>
    </Panel>
  );
}
