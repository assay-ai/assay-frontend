"use client";

import { DisplayAssetSelect } from "@/components/display-asset-select";
import { useQuery } from "@tanstack/react-query";
import { Download, Info, List } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import type { Money } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { getReceiptsSummary } from "@/services/receipts.service";
import { formatMoney } from "@/utils/money";

import { KeyValueRow, MicroLabel, PageHeader } from "./chrome";
import { formatCount, monthBounds } from "./format";

/**
 * Statements and export.
 *
 * The design's own footnote says this document is Phase 2 and that CSV export
 * ships at MVP on the Spend explorer — so this screen is honest about being a
 * partial statement rather than pretending to be a finance-grade one.
 *
 * What reconciles for real: gross tool spend, amount withheld and net charged
 * all come from one call to `GET /receipts/summary` over UTC month bounds,
 * and the per-tool table from the same endpoint with `groupBy=tool`. The
 * design's line about that is the point — the same endpoint serves the
 * dashboard, the export and the statement, so the three cannot disagree in
 * front of a finance approver.
 *
 * What cannot: opening balance, closing balance, deposits and withdrawals.
 * `GET /balances` is a point-in-time reading with no `asOf` parameter, and
 * there is no historical-balance endpoint, so a month's opening and closing
 * figures cannot be derived without guessing. They are named and left
 * unanswered rather than filled with today's balance, which would be wrong by
 * exactly the month's activity.
 *
 * `groupBy=provider` currently 500s on the API ("column intent.providerid does
 * not exist"), so only the by-tool grouping is offered.
 */

interface SummaryFigures {
  calls: number;
  refundedCalls: number;
  listedTotal: Money;
  chargedTotal: Money;
  withheldTotal: Money;
  failRate: number;
}

interface SummaryGroup extends SummaryFigures {
  key: string;
}

interface Summary {
  groups: SummaryGroup[];
  totals: SummaryFigures;
  asset: string;
}

function monthLabel(from: string): string {
  return new Date(from).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function StatementsView() {
  const month = React.useMemo(() => monthBounds(), []);

  const summary = useQuery({
    queryKey: ["receipts-summary", "statement", month.from],
    retry: false,
    queryFn: () =>
      getReceiptsSummary({ from: month.from, to: month.to, groupBy: "tool" }) as Promise<Summary>,
  });

  const totals = summary.data?.totals;

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Statements"
        subtitle="generated on a UTC month boundary · reconciles to the ledger to the atomic unit"
        actions={
          <>
            <Button variant="secondary" icon={<List />} type="button" disabled>
              Usage view
            </Button>
            <Button variant="secondary" icon={<Download />} type="button" disabled>
              Download PDF
            </Button>
            <Button icon={<Download />} type="button" disabled>
              Export CSV
            </Button>
          </>
        }
      />

      <DisplayAssetSelect />

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>{monthLabel(month.from)}</PanelTitle>
            <PanelDescription className="whitespace-normal">
              opening balance → deposits → gross tool spend → amount withheld → net charged →
              withdrawals → closing balance
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-5 pb-[18px] pt-2">
          {summary.isPending ? (
            <p className="font-mono text-mono-13 text-03">Loading…</p>
          ) : summary.isError ? (
            <p className="py-2 text-body-13 text-danger-600">
              This period could not be read:{" "}
              {summary.error instanceof ApiError ? summary.error.message : "the request failed"}. No
              figures are shown until it can be read.
            </p>
          ) : (
            <>
              <KeyValueRow
                label="Opening balance"
                sub="not available yet"
                value="—"
                valueClassName="text-03"
              />
              <KeyValueRow
                label="Deposits"
                sub="not included in this statement yet — see Funding"
                value="—"
                valueClassName="text-03"
              />
              <KeyValueRow
                label="Gross tool spend"
                sub={`${formatCount(totals?.calls ?? 0)} calls at listed price`}
                value={totals ? `−${formatMoney(totals.listedTotal, { decimals: 2 })}` : "—"}
              />
              <KeyValueRow
                label="Amount withheld"
                sub={`${formatCount(totals?.refundedCalls ?? 0)} calls · the guarantee`}
                value={totals ? `+${formatMoney(totals.withheldTotal, { decimals: 2 })}` : "—"}
                valueClassName="text-teal-600"
              />
              <KeyValueRow
                label="Net charged"
                value={
                  <span className="text-heading-sm">
                    {totals ? `−${formatMoney(totals.chargedTotal, { decimals: 2 })}` : "—"}
                  </span>
                }
              />
              <KeyValueRow
                label="Withdrawals"
                sub="not included in this statement yet — see Funding"
                value="—"
                valueClassName="text-03"
              />
              <KeyValueRow
                label="Closing balance"
                sub="not available yet"
                value="—"
                valueClassName="text-03"
                divider={false}
              />
            </>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>By tool</PanelTitle>
            <PanelDescription className="whitespace-normal">
              the same figures as the dashboard and the CSV export
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          {summary.isPending ? (
            <p className="p-3 font-mono text-mono-13 text-03">Loading…</p>
          ) : summary.isError ? (
            <p className="p-3 text-body-13 text-danger-600">
              The per-tool breakdown could not be read.
            </p>
          ) : (summary.data?.groups.length ?? 0) === 0 ? (
            <p className="p-3 text-body-13 text-02">
              No call settled in this period, so there is nothing to itemise.
            </p>
          ) : (
            <div className="w-full overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="flex items-center gap-3 border-b border-02 px-3 pb-2.5">
                  <div className="min-w-0 flex-1">
                    <MicroLabel>Tool</MicroLabel>
                  </div>
                  <div className="w-[120px] text-right">
                    <MicroLabel>Calls</MicroLabel>
                  </div>
                  <div className="w-[120px] text-right">
                    <MicroLabel>Listed</MicroLabel>
                  </div>
                  <div className="w-[130px] text-right">
                    <MicroLabel>Withheld</MicroLabel>
                  </div>
                  <div className="w-[130px] text-right">
                    <MicroLabel>Charged</MicroLabel>
                  </div>
                </div>
                {summary.data?.groups.map((group) => (
                  <div
                    key={group.key}
                    className="flex items-center gap-3 border-b border-01 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1 truncate font-mono text-mono-12 font-semibold text-01">
                      {group.key}
                    </div>
                    <div className="w-[120px] text-right font-mono text-mono-12 text-02">
                      {formatCount(group.calls)}
                    </div>
                    <div className="w-[120px] text-right font-mono text-mono-12 text-02">
                      {formatMoney(group.listedTotal, { decimals: 2 })}
                    </div>
                    <div className="w-[130px] text-right font-mono text-mono-12 text-teal-600">
                      {formatMoney(group.withheldTotal, { decimals: 2 })}
                    </div>
                    <div className="w-[130px] text-right font-mono text-mono-12 text-02">
                      {formatMoney(group.chargedTotal, { decimals: 2 })}
                    </div>
                  </div>
                ))}
                {totals ? (
                  <div className="flex items-center gap-3 border-t border-02 px-3 py-3">
                    <div className="min-w-0 flex-1 text-label-sm text-01">Total</div>
                    <div className="w-[120px] text-right font-mono text-mono-13 font-semibold text-01">
                      {formatCount(totals.calls)}
                    </div>
                    <div className="w-[120px] text-right font-mono text-mono-13 font-semibold text-01">
                      {formatMoney(totals.listedTotal, { decimals: 2 })}
                    </div>
                    <div className="w-[130px] text-right font-mono text-mono-13 font-semibold text-teal-600">
                      {formatMoney(totals.withheldTotal, { decimals: 2 })}
                    </div>
                    <div className="w-[130px] text-right font-mono text-mono-13 font-semibold text-01">
                      {formatMoney(totals.chargedTotal, { decimals: 2 })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </PanelBody>
      </Panel>

      <div className="flex w-full items-start gap-2.5 rounded-lg border border-01 bg-02 p-3.5 tablet:p-[15px]">
        <Info aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-03" />
        <p className="text-body-13 text-02">
          A downloadable statement is not available yet. You can export your calls as CSV from Spend.
        </p>
      </div>
    </div>
  );
}
