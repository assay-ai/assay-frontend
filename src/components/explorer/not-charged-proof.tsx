"use client";

import { EyeOff, ShieldCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { MoneySplit } from "@/components/patterns/money-flow";
import { PageState } from "@/components/patterns/page-state";
import { Term } from "@/components/patterns/term";
import {
  formatCallPrice,
  notChargedEmptyText,
  notChargedPrivacyNote,
  notChargedRowText,
  notChargedSplit,
  plural,
  shortDay,
} from "@/features/explorer/explorer-text";
import { publicErrorText, usePublicNotCharged } from "@/features/explorer/use-public-explorer";
import { useChainName } from "@/hooks/useChainName";
import type { Money } from "@/interfaces";
import { routes } from "@/libs/routes";
import type { PublicNotChargedCall } from "@/services/public-explorer.service";
import { cn } from "@/utils";
import { chainIdOfAsset } from "@/utils/chain";
import { formatMoney } from "@/utils/money";

/**
 * The proof of the promise, on the public Explorer: what the platform's checks
 * refused to charge across every buyer in the last 30 days, and the most recent
 * such calls. Aggregated data only (k-anonymous, dated by day, a day late).
 *
 * The guarantee firing ("Result failed our check") is never merged with the
 * other reasons; each row carries the same label and colour as its reason's
 * count line. When the server withholds rows for privacy we say exactly that —
 * never "nothing happened".
 */

export function amountsText(amounts: readonly Money[], chainName: (id: string) => string): string {
  if (amounts.length === 0) return "$0.00";
  if (amounts.length === 1) return formatMoney(amounts[0], { decimals: 2 });
  return amounts.map((m) => `${formatMoney(m, { decimals: 2 })} on ${chainName(chainIdOfAsset(m.asset) ?? "")}`).join(" + ");
}

/** The dot beside a row's tag: the same colour as its reason's count line. */
const DOT_TONE: Record<ReturnType<typeof notChargedRowText>["tone"], string> = {
  teal: "bg-teal-500",
  info: "bg-info-500",
  indigo: "bg-indigo-500",
  primary: "bg-primary-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
  pink: "bg-pink-500",
  neutral: "bg-chart-6",
};

function BucketTag({ row }: { row: PublicNotChargedCall }) {
  const { tag, tone } = notChargedRowText(row);
  const failed = tone === "teal";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-label-xs",
        failed ? "bg-teal-10 text-teal-600" : "bg-03 text-02",
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOT_TONE[tone])} />
      {tag}
    </span>
  );
}

/**
 * One line of the same proof, for the top of the Explorer: the totals only,
 * with a link down to the full record (`NotChargedProof`, below the tool
 * list), so the tools are on the first screen and the proof is still the
 * first thing read. Says nothing while loading, on error, or before any paid
 * call was checked; the full block below explains each of those.
 */
export function NotChargedSummary({ className }: { className?: string }) {
  const query = usePublicNotCharged();
  const chainName = useChainName();
  if (!query.isSuccess) return null;
  const { callsChecked, callsNotCharged, amountNotCharged } = query.data.totals;
  if (callsChecked === 0) return null;
  return (
    <p className={cn("flex items-start gap-2 text-body-13 text-02", className)}>
      <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-teal-600" />
      <span>
        Last {query.data.windowDays} days: {plural(callsChecked, "paid call")} checked,{" "}
        <span className="font-semibold text-teal-600">{callsNotCharged.toLocaleString("en-US")} not charged</span> (
        {amountsText(amountNotCharged, chainName)} kept by buyers).{" "}
        <a href="#not-charged" className="text-01 underline underline-offset-2 hover:text-primary-700">
          See what was refused
        </a>
      </span>
    </p>
  );
}

/**
 * `toolId` scopes the record to one tool (the tool pages); `provider` to the
 * calls one provider served (the provider page), matched on the registered
 * name the feed carries and limited to their tools. Both only filter rows the
 * server already published under its k rule, so neither reveals anything the
 * full record does not.
 */
export function NotChargedProof({
  toolId,
  provider,
  limit = 6,
  className,
}: {
  toolId?: string;
  provider?: { name: string; toolIds: readonly string[] };
  limit?: number;
  className?: string;
}) {
  const query = usePublicNotCharged();
  const chainName = useChainName();
  const titleId = React.useId();
  const scope = toolId ? "tool" : provider ? "provider" : "all";

  if (query.isPending) {
    return (
      <section className={cn("rounded-xl border border-01 bg-01 p-5", className)}>
        <PageState kind="loading" rows={3} label="Loading what was not charged" />
      </section>
    );
  }
  if (query.isError) {
    const code = query.error instanceof Error && "code" in query.error ? String(query.error.code) : null;
    return (
      <PageState
        kind="error"
        className={className}
        title="The not-charged record is not available"
        description={publicErrorText(query.error, "the not-charged record")}
        onRetry={() => void query.refetch()}
        code={code}
      />
    );
  }

  const data = query.data;
  const recent = data.recent
    .filter((row) =>
      toolId
        ? row.toolId === toolId
        : provider
          ? row.providerName === provider.name && provider.toolIds.includes(row.toolId)
          : true,
    )
    .slice(0, limit);
  const { callsChecked, callsNotCharged, amountNotCharged } = data.totals;
  const quiet = callsChecked === 0 && !data.withheldForPrivacy;

  return (
    <section
      id={scope === "all" ? "not-charged" : undefined}
      aria-labelledby={titleId}
      className={cn("flex w-full scroll-mt-4 flex-col gap-4 rounded-xl border border-teal-20 bg-01 p-4 tablet:p-6", className)}
    >
      <div className="flex items-start gap-3">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-teal-600" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={titleId} className="text-heading-sm text-01">
            {scope === "tool"
              ? "Recently not charged on this tool"
              : scope === "provider"
                ? "Recently not charged on their tools"
                : "You don't pay for results you can't use"}
          </h2>
          <p className="text-body-13 text-02">
            {scope === "tool"
              ? "Calls to this tool that ended without a charge, across every buyer."
              : scope === "provider"
                ? `Their calls among the most recent public not-charged calls, across every buyer — not a complete record of the last ${data.windowDays} days.`
                : `What our checks refused to charge, across every buyer, in the last ${data.windowDays} days.`}
          </p>
        </div>
      </div>

      {scope === "all" && !quiet ? (
        <div className="grid grid-cols-1 gap-4 tablet:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] tablet:gap-6">
          <dl className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-0.5">
              <dt className="text-body-xs text-03">Paid calls checked</dt>
              <dd className="font-mono text-mono-md font-semibold text-01">{callsChecked.toLocaleString("en-US")}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-body-xs text-03">
                <Term k="not-charged">Not charged</Term>
              </dt>
              <dd className="font-mono text-mono-md font-semibold text-teal-600">{callsNotCharged.toLocaleString("en-US")}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-body-xs text-03">Value kept by buyers</dt>
              <dd className="font-mono text-mono-md font-semibold text-teal-600">{amountsText(amountNotCharged, chainName)}</dd>
            </div>
          </dl>
          {callsNotCharged > 0 ? (
            <MoneySplit
              showPercent={false}
              segments={notChargedSplit(data.totals).map((line) => ({
                label: line.label,
                value: line.calls,
                amount: plural(line.calls, "call"),
                tone: line.tone,
              }))}
            />
          ) : null}
        </div>
      ) : null}

      {quiet ? (
        <p className="text-body-13 text-02">
          No paid calls were checked in the last {data.windowDays} days yet. As soon as agents pay for calls, this
          shows what was not charged and why.
        </p>
      ) : recent.length > 0 ? (
        <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01">
          {recent.map((row, index) => (
            <li key={`${row.toolId}-${row.day}-${index}`} className="flex flex-col gap-1.5 px-3.5 py-3 tablet:flex-row tablet:items-center tablet:gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <BucketTag row={row} />
                  {toolId ? null : (
                    <Link href={routes.publicTool(row.toolId)} className="font-mono text-mono-13 font-semibold text-01 hover:underline">
                      {row.toolName}
                    </Link>
                  )}
                  {/* On the provider's own page every row is theirs: no need to say so on each. */}
                  {scope === "provider" ? null : <span className="text-body-xs text-03">by {row.providerName}</span>}
                </div>
                <p className="text-body-13 text-02">{notChargedRowText(row).text}</p>
              </div>
              <div className="flex shrink-0 items-baseline gap-2 tablet:flex-col tablet:items-end tablet:gap-0.5">
                <span className="font-mono text-mono-13 font-semibold text-teal-600">
                  {formatCallPrice(row.price)} not charged
                </span>
                <span className="text-body-xs text-03">{shortDay(row.day)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-13 text-02" data-testid="not-charged-empty">
          {notChargedEmptyText(scope, data.withheldForPrivacy, data.minBuyers)}
        </p>
      )}

      {/* An empty tool or provider record already says why, in its own words: no second privacy note under it. */}
      {(data.withheldForPrivacy || (scope === "all" && !quiet)) && !(scope !== "all" && !quiet && recent.length === 0) ? (
        <p className="flex items-start gap-2 text-body-xs text-03">
          <EyeOff aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{notChargedPrivacyNote(data.withheldForPrivacy, data.minBuyers)}</span>
        </p>
      ) : null}
      <p className="text-body-xs text-03">
        Calls appear here a day after they happen, dated by day (UTC). A call&apos;s amount is what it would have
        cost: the price of the provider that served it, or, when none did, the most that was held for it.
      </p>
    </section>
  );
}
