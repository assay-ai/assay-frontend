"use client";

import { useQuery } from "@tanstack/react-query";
import { Calendar, Download } from "lucide-react";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { DisplayAssetSelect, displayAssetLabel, useDisplayAssetPick } from "@/components/display-asset-select";
import { EntityName } from "@/components/patterns/entity-name";
import { PageState } from "@/components/patterns/page-state";
import { Term } from "@/components/patterns/term";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { recentMonths } from "@/features/buyer/period";
import { spendCsv } from "@/features/g30/spend-view";
import type { ReceiptsSummary } from "@/features/g30/wire";
import { useChains } from "@/hooks/useChains";
import { useEntityNames } from "@/hooks/useEntityNames";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { getReceiptsSummary } from "@/services/receipts.service";
import { formatMoney } from "@/utils/money";

import { KeyValueRow, PageHeader } from "./chrome";
import { formatCount } from "./format";

/**
 * Money › Statements — "get my monthly statement for accounting".
 *
 * One statement card per UTC month (picked here, or `?month=2026-10` from Not
 * charged) with one primary action, Download CSV, built in the browser from
 * the same `GET /receipts/summary` rows the dashboard reads — so the two can
 * never disagree. Opening and closing balances, deposits and withdrawals have
 * no historical endpoint and are not drawn at all rather than shown as "—".
 */

const MONTHS_BACK = 6;

function plural(n: number, one: string): string {
  return `${formatCount(n)} ${n === 1 ? one : `${one}s`}`;
}

function StatementsContent() {
  const anchor = React.useMemo(() => new Date(), []);
  const months = React.useMemo(() => recentMonths(anchor, MONTHS_BACK), [anchor]);
  const requested = useSearchParams().get("month");
  const [selected, setSelected] = React.useState<string | null>(requested);
  const period = months.find((m) => m.key === selected) ?? months[0]!;
  const assetPick = useDisplayAssetPick();
  const names = useEntityNames({ kinds: ["tool"] });
  const { chains } = useChains();

  const summary = useQuery<ReceiptsSummary, ApiError>({
    queryKey: ["receipts-summary", "statement", period.key, assetPick],
    retry: 0,
    queryFn: () =>
      getReceiptsSummary({ from: period.from, to: period.to, groupBy: "tool" }) as Promise<ReceiptsSummary>,
  });

  const totals = summary.data?.totals;
  const groups = summary.data?.groups ?? [];

  const download = React.useCallback(() => {
    if (!summary.data) return;
    const assetLabel = summary.data.asset ? displayAssetLabel(summary.data.asset, chains) : "";
    const body = spendCsv(summary.data.groups, {
      dimensionHeader: "Tool",
      labelOf: (key) => names.name("tool", key),
      assetLabel,
    });
    const t = summary.data.totals;
    const plainAmount = (m: typeof t.listedTotal) => formatMoney(m, { grouped: false, exact: true, symbol: "", decimals: m.decimals });
    const total = ["Total", "", assetLabel, String(t.calls), plainAmount(t.listedTotal), plainAmount(t.chargedTotal), plainAmount(t.withheldTotal), String(t.refundedCalls)].join(",");
    const csv = `${body}\n${total}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `assay-statement_${period.key}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [summary.data, chains, names, period.key]);

  return (
    <>
      <PageHeader
        title="Statements"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" icon={<Calendar />} aria-label={`Month: ${period.label}. Change month`}>
                {period.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border border-01">
              {months.map((m) => (
                <DropdownMenuItem key={m.key} className="text-body-13" onSelect={() => setSelected(m.key)}>
                  {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      <p className="-mt-2 text-body-13 text-03">
        One statement per calendar month (UTC), for your records or your accountant.
      </p>

      <DisplayAssetSelect live />

      {summary.isPending ? (
        <PageState kind="loading" rows={4} label={`Loading the ${period.label} statement`} />
      ) : summary.isError ? (
        <PageState
          kind="error"
          title={`The ${period.label} statement could not be loaded`}
          description={plainError(summary.error.code)}
          onRetry={() => void summary.refetch()}
          code={summary.error.code}
          details={summary.error.message}
        />
      ) : (
        <>
          <Panel>
            <PanelHeader className="flex-col items-start gap-3 tablet:flex-row tablet:items-center">
              <PanelTitles>
                <PanelTitle>{period.label}</PanelTitle>
                <PanelDescription className="whitespace-normal">Matches your balance history exactly.</PanelDescription>
              </PanelTitles>
              <Button icon={<Download />} onClick={download} disabled={!totals || totals.calls === 0}>
                Download CSV
              </Button>
            </PanelHeader>
            <PanelBody className="px-5 pb-[18px] pt-2">
              {!totals || totals.calls === 0 ? (
                <p className="py-3 text-body-13 text-02">No paid calls in {period.label}, so there is nothing to itemise.</p>
              ) : (
                <>
                  <KeyValueRow
                    label="Calls at listed price"
                    sub={plural(totals.calls, "call")}
                    value={formatMoney(totals.listedTotal, { decimals: 2 })}
                  />
                  <KeyValueRow
                    label={<Term k="not-charged">Not charged</Term>}
                    sub={`${plural(totals.refundedCalls, "call")} that failed our checks`}
                    value={`−${formatMoney(totals.withheldTotal, { decimals: 2 })}`}
                    valueClassName="text-teal-600"
                  />
                  <KeyValueRow
                    label="You paid"
                    value={<span className="text-heading-sm">{formatMoney(totals.chargedTotal, { decimals: 2 })}</span>}
                    divider={false}
                  />
                </>
              )}
            </PanelBody>
          </Panel>

          {groups.length > 0 ? (
            <Panel>
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>By tool</PanelTitle>
                  <PanelDescription className="whitespace-normal">The same rows as the CSV</PanelDescription>
                </PanelTitles>
              </PanelHeader>
              <PanelBody>
                <ul className="flex flex-col">
                  {groups.map((group) => (
                    <li key={group.key} className="flex flex-col gap-1 border-b border-01 px-5 py-3 last:border-b-0 tablet:flex-row tablet:items-center tablet:gap-4">
                      <span className="min-w-0 flex-1 truncate font-mono text-mono-13 font-semibold text-01">
                        <EntityName kind="tool" id={group.key} copyable={false} />
                      </span>
                      <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-body-xs text-03 tablet:text-body-13">
                        <span>{plural(group.calls, "call")}</span>
                        <span>listed {formatMoney(group.listedTotal, { decimals: 2 })}</span>
                        <span className="text-teal-600">−{formatMoney(group.withheldTotal, { decimals: 2 })} not charged</span>
                        <span className="font-semibold text-01">paid {formatMoney(group.chargedTotal, { decimals: 2 })}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </PanelBody>
            </Panel>
          ) : null}
        </>
      )}
    </>
  );
}

export function StatementsView() {
  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <React.Suspense fallback={<PageState kind="loading" rows={4} label="Loading statements" />}>
        <StatementsContent />
      </React.Suspense>
    </div>
  );
}
