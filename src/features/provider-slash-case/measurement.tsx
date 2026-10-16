"use client";

import * as React from "react";

import { Arithmetic, type ArithmeticRow } from "@/components/ui/arithmetic";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/libs/utc-time";
import type { SlashProposalCaseDetail } from "@/interfaces/provider-slash-cases";
import { formatMoney } from "@/utils/money";

import { presentArithmeticRow } from "./labels";
import {
  SLASH_AGENT_BPS,
  SLASH_PLATFORM_BPS,
  SLASH_SPLIT_SOURCE,
  splitPenalty,
} from "./distribution";

/**
 * `dObK1`'s "The measurement" — the full derivation, ending in Distribution.
 *
 * ## The rows come from the strike, not from this file
 *
 * `sla_strikes.computation` froze the arithmetic at the moment the window
 * closed — precisely so that, as `SlaStrikeEntity`'s docstring puts it, "a
 * person in a dispute six months from now can rebuild the entire argument from
 * this row alone", without the binding (whose price and declared rate have
 * moved) and without the constants file (which may have been tuned). The
 * server renders that freeze into a fixed row list and this component prints
 * it. Nothing here recomputes a rate, a tolerance, a threshold or a penalty,
 * and no row is added that the response did not send. The field names and
 * minor units it arrives in are put into words by `./labels`.
 *
 * Two rows are worth knowing about because they look like gaps and are not:
 *
 * - **`declared_sla`** arrives with no `note`. The design writes "in force
 *   since 2026-06-01"; nothing records when a binding's declared SLA came into
 *   force (`binding_versions` carries the mapping, price and timeout fields,
 *   not `slaFailureRate`), so the server sends no note and this prints none.
 * - **`per_window_cap`** arrives with the *value* "enforced on chain — not
 *   computed here". The design writes "$5.00 · penalty capped at $5.00". The
 *   per-window ceiling and the 10%-of-stake daily cap are enforced on chain
 *   against a signed attestation, and the backend deliberately keeps no second
 *   unsigned copy of a consensus rule. So the capped figure is genuinely not
 *   known off chain; `./labels` shows a dash and says so in a user sentence.
 *
 * `arithmetic` is `[]` for a `DATA_FAIL` proposal — there is no strike, so
 * there is nothing frozen to render. That is an empty state, not an error.
 *
 * ## Distribution — where the design is wrong
 *
 * The design's third share reads `$0.50 insurance reserve`. **There is no
 * insurance reserve.** See `./distribution.ts` for the program source; the
 * short version is that the provider's 10% is never taken from them at all,
 * so it is rendered as money they keep rather than a fund they paid into.
 *
 * The split is of the **proposed** penalty. What the chain finally takes may
 * be less, because the caps apply there and not here — the line says so
 * rather than presenting a number the caps could reduce as the outcome.
 *
 * ## "Re-derive yourself"
 *
 * The design's header action is not drawn. Nothing in this app or its API
 * offers a second derivation to check the first against, and the table below
 * it *is* the derivation, step by step.
 */

const toneMap: Record<"NEUTRAL" | "GOOD" | "BAD", ArithmeticRow["valueTone"]> =
  {
    NEUTRAL: "default",
    GOOD: "success",
    BAD: "danger",
  };

/** The window's own line under the title — only the parts the response carries. */
function subtitleFor(data: SlashProposalCaseDetail): string {
  const parts: string[] = [];
  if (data.proposal.windowLabel)
    parts.push(`window ${data.proposal.windowLabel}`);

  const subject = data.priorWindows.find((window) => window.isSubject);
  if (subject) parts.push(`closed ${formatDateTime(subject.closedAt)}`);

  // The design also reads "binding v3 · policy v3". The binding version is real
  // only when a change overlay exists (that is the only place a version pair
  // appears on this response); the POLICY version appears nowhere on the wire
  // at all and is not printed.
  if (data.changeOverlay) parts.push(`binding ${data.changeOverlay.toVersion}`);

  return parts.join(" · ");
}

export function Measurement({ data }: { data: SlashProposalCaseDetail }) {
  // The server's field names, minor units and ids, in words — see `./labels`.
  const rows: ArithmeticRow[] = data.arithmetic.map((row) => ({
    id: row.key,
    ...presentArithmeticRow(row, data.proposal.penaltyAmount),
    valueTone: toneMap[row.tone],
  }));

  const split = splitPenalty(data.proposal.penaltyAmount);

  return (
    <Panel>
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>The measurement</PanelTitle>
          <PanelDescription>{subtitleFor(data)}</PanelDescription>
        </PanelTitles>
      </PanelHeader>

      <PanelBody>
        {rows.length === 0 ? (
          <div className="px-5 py-5">
            <EmptyState
              title="No window arithmetic for this case"
              description="This proposal came from a single failed call rather than from a window that breached, so there is no frozen derivation to show. The penalty and both clocks above are the whole of it."
            />
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <div className="min-w-[720px] py-2">
              <Arithmetic rows={rows} />
            </div>
          </div>
        )}

        {/* ── Distribution ───────────────────────────────────────────────
            The design's `$0.50 insurance reserve` is wrong and is not
            rendered. The third share is money that is never taken. */}
        <div className="flex w-full flex-col gap-2 border-t border-01 bg-02 px-5 py-4">
          <div className="flex w-full flex-col gap-1.5 tablet:flex-row tablet:items-baseline tablet:gap-3">
            <span className="shrink-0 font-mono text-mono-12 text-03">
              Distribution
            </span>
            <p className="min-w-0 flex-1 font-mono text-mono-13 text-01">
              <span className="font-semibold">{formatMoney(split.agent)}</span>{" "}
              agents who bought from this binding
              <span className="text-03"> · </span>
              <span className="font-semibold">
                {formatMoney(split.platform)}
              </span>{" "}
              platform
              <span className="text-03"> · </span>
              <span className="font-semibold text-success-600">
                {formatMoney(split.neverTaken)}
              </span>{" "}
              <span className="text-success-700">never taken from you</span>
            </p>
          </div>
          <p className="text-body-xs leading-[1.55] text-02">
            {SLASH_AGENT_BPS / 100}% goes to the agents harmed and{" "}
            {SLASH_PLATFORM_BPS / 100}% to the platform; the remaining{" "}
            {(10_000 - SLASH_AGENT_BPS - SLASH_PLATFORM_BPS) / 100}% is not paid
            to anyone — it is never taken out of your stake, so a proposal of{" "}
            {formatMoney(data.proposal.penaltyAmount)} reduces your stake by{" "}
            {formatMoney(split.taken)}. This is the split of the proposal as
            made. On chain the amount reserved for a penalty is what it takes,
            always in full: when today&rsquo;s penalty limit has no room, the
            penalty waits until it has, and is then paid in full.
          </p>
          <p className="text-body-xs leading-[1.55] text-02">
            Split as published on {SLASH_SPLIT_SOURCE.readAt}. These
            proportions are set on chain, inside bounds the program enforces on
            whoever holds the admin key — there is no waiting period on a
            change, so this figure is a snapshot of the published split and not
            a guarantee about the next one.
          </p>
        </div>
      </PanelBody>
    </Panel>
  );
}
