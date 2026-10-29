"use client";

import { AnalyticsDecimal as Decimal } from "./analytics-format";
import { useState, type ReactNode } from "react";

import { MetricTile } from "@/components/ui/metric-tile";
import { Panel, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import type {
  AnalyticsRange,
  AnalyticsFigures,
} from "@/services/protocol-analytics.service";

import { AnalyticsChart } from "./analytics-chart";
import {
  analyticsMoney,
  analyticsRate,
  analyticsCount,
  analyticsChange,
} from "./analytics-format";
import { useProtocolAnalytics } from "./use-protocol-analytics";

const RANGES: { value: AnalyticsRange; label: string; description: string }[] =
  [
    { value: "7d", label: "7D", description: "Last 7 days" },
    { value: "30d", label: "30D", description: "Last 30 days" },
    { value: "90d", label: "90D", description: "Last 90 days" },
    { value: "all", label: "All", description: "Since launch" },
  ];
const METRICS = ["Revenue", "Volume", "Paid calls"];
const HEADLINE_METRICS = [
  [
    "Revenue",
    "revenue",
    "Protocol fees actually credited after payment collection.",
  ],
  [
    "Paid volume",
    "volume",
    "Listed value of funded paid calls, including pending and released calls.",
  ],
  [
    "Paid calls",
    "paidCalls",
    "Paid calls with a recorded funding hold; free calls are excluded.",
  ],
  [
    "Paying agents",
    "payingAgents",
    "Different payer wallets with at least one funded paid call.",
  ],
  [
    "Tools earning",
    "toolsEarning",
    "Tools with at least one collected payment.",
  ],
  [
    "Refunded to agents",
    "refunded",
    "Funded call value released after a refund was booked.",
  ],
] as const;
const DEFINITIONS = [
  [
    "Revenue",
    "Actual PLATFORM_FEE ledger credits for collected payments in the selected call cohort. A verification pass or an unredeemed voucher alone is not revenue.",
  ],
  [
    "Paid volume",
    "Listed prices of funded PAID calls, grouped by their creation time in UTC. Includes calls later collected, refunded or otherwise released, and calls still in progress.",
  ],
  [
    "Paid calls",
    "Funded PAID payment intents. FREE, TEST, EXPLORATION and unfunded calls are excluded.",
  ],
  [
    "Refunded to agents",
    "Funded call prices where the refund has been booked and the hold released. Voided and expired calls are counted separately as other releases.",
  ],
  [
    "Passed their checks",
    "Collected payments divided by collected plus refunded payments. Pending, lapsed and voided payments are excluded.",
  ],
  [
    "Paying agents",
    "Distinct payer wallets with at least one funded paid call. One person can run several agents.",
  ],
  [
    "Change figures",
    "The selected UTC period, including the partial current day, compared with the preceding period of equal duration. No comparison is shown for All or a zero previous value.",
  ],
  [
    "Public tables",
    "Tool and daily payment groups are published for five or more buyer organizations. Private and unapproved tools are omitted. No wallet or individual payment identifiers are published.",
  ],
] as const;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <h2 id={id} className="text-heading-sm text-01">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Panel className="min-w-0 gap-4 p-5">
      <h3 className="text-label-md text-01">{title}</h3>
      <p className="text-body-13 text-02">{description}</p>
      {children}
    </Panel>
  );
}

function DataTable({
  title,
  columns,
  children,
}: {
  title: string;
  columns: string[];
  children: ReactNode;
}) {
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-13">
          <caption className="sr-only">{title}</caption>
          <thead className="border-b border-01 bg-02 text-02">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="whitespace-nowrap px-5 py-4 text-label-sm"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Panel>
  );
}
function NoRows({ columns }: { columns: number }) {
  return (
    <tr>
      <td colSpan={columns} className="px-5 py-12 text-center text-03">
        No data available.
      </td>
    </tr>
  );
}
const CELL = "whitespace-nowrap px-5 py-4 text-02";

export function ProtocolAnalytics() {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [assetId, setAssetId] = useState<string>();
  const [metric, setMetric] = useState("Revenue");
  const query = useProtocolAnalytics(range, assetId);
  const data = !query.isError && query.data?.state === "OK" ? query.data : null;
  const assets = query.data?.assets ?? [];
  const asset = data?.asset;
  const totals = data?.totals;
  const rangeDescription = RANGES.find(
    (item) => item.value === range,
  )!.description;
  const money = (amount: string | null | undefined) =>
    analyticsMoney(amount, asset);
  const chartValue = (value: string) =>
    asset
      ? new Decimal(value).div(new Decimal(10).pow(asset.decimals)).toString()
      : null;
  const daily = data?.daily ?? [];
  const metricField =
    metric === "Revenue"
      ? "revenue"
      : metric === "Volume"
        ? "volume"
        : "paidCalls";
  const flow: [string, keyof AnalyticsFigures][] = [
    ["To tool providers", "providerEarnings"],
    ["Assay revenue", "revenue"],
    ["Refunded to agents", "refunded"],
    ["Pending", "pending"],
    ["Other releases", "notCharged"],
  ];

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-8 px-4 py-8 tablet:px-8 tablet:pb-16">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-heading-lg text-01">Assay protocol analytics</h1>
          {asset ? (
            <span className="rounded-full border border-02 bg-01 px-3 py-1 text-label-xs text-02">
              {asset.chainName} · {asset.symbol}
            </span>
          ) : null}
        </div>
        <p className="max-w-3xl text-body-sm text-01">
          Revenue, tool activity and agent adoption across the Assay protocol.
        </p>
        <p className="max-w-3xl text-body-13 text-02">
          An agent pays for a tool call into escrow. The result is checked
          before the provider is paid. If the result fails its checks, the held
          payment is returned to the agent.
        </p>
        {query.isError ? (
          <p role="alert" className="text-body-13 text-danger-600">
            We could not refresh analytics. Figures are unavailable. Try
            refreshing again.
          </p>
        ) : null}
        {!query.isError && query.data?.state === "UNAVAILABLE" ? (
          <p role="status" className="text-body-13 text-03">
            Analytics is not configured for this deployment.
          </p>
        ) : null}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          aria-label="Time range"
          value={range}
          onValueChange={(value) => setRange(value as AnalyticsRange)}
        >
          {RANGES.map((item) => (
            <SegmentedItem key={item.value} value={item.value}>
              {item.label}
            </SegmentedItem>
          ))}
        </Segmented>
        <div className="flex flex-wrap items-center gap-3">
          {assets.length > 1 ? (
            <label className="text-body-13 text-02">
              Asset{" "}
              <select
                aria-label="Analytics asset"
                value={assetId ?? query.data?.asset?.id ?? ""}
                onChange={(event) => setAssetId(event.target.value)}
                className="rounded-md border border-02 bg-01 px-2 py-2"
              >
                {assets.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.chainName} · {item.symbol}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p aria-live="polite" className="text-body-13 text-03">
            {rangeDescription} · UTC
            {range === "all" ? " · Charts: latest 90 days" : ""}
          </p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="rounded-md border border-02 bg-01 px-3 py-2 text-label-sm text-02 disabled:opacity-50"
          >
            {query.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      {data ? (
        <p className="text-body-xs text-03">
          Updated{" "}
          {new Date(data.generatedAt)
            .toISOString()
            .replace("T", " ")
            .slice(0, 19)}{" "}
          UTC · Refreshes every 3 seconds while visible.
        </p>
      ) : null}

      <section
        aria-label="Headline figures"
        className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 tablet:grid-cols-3"
      >
        {HEADLINE_METRICS.map(([label, key, sub]) => (
          <MetricTile
            key={label}
            label={label}
            value={
              typeof totals?.[key] === "string"
                ? money(totals[key] as string)
                : analyticsCount(totals?.[key] as number | undefined)
            }
            sub={sub}
            meta={
              range === "all"
                ? undefined
                : analyticsChange(totals?.[key], data?.previous?.[key])
            }
          />
        ))}
      </section>

      <Section id="revenue" title="Revenue and volume">
        <Panel>
          <PanelHeader className="flex-wrap">
            <div className="flex flex-col gap-1">
              <PanelTitle>Daily activity</PanelTitle>
              <p className="text-body-13 text-03">
                Funded calls by creation day, UTC. {rangeDescription}.
              </p>
            </div>
            <Segmented
              aria-label="Metric"
              value={metric}
              onValueChange={setMetric}
            >
              {METRICS.map((item) => (
                <SegmentedItem key={item} value={item}>
                  {item}
                </SegmentedItem>
              ))}
            </Segmented>
          </PanelHeader>
          <div className="p-5">
            <AnalyticsChart
              label={`${metric} per day`}
              values={daily.map((day) => ({
                day: day.day,
                value:
                  metricField === "paidCalls"
                    ? day.paidCalls
                    : chartValue(day[metricField]),
              }))}
            />
          </div>
        </Panel>
        <div className="grid gap-4 tablet:grid-cols-2">
          <Panel className="min-w-0 gap-4 p-5">
            <h3 className="text-label-md text-01">Where agents’ money went</h3>
            <p className="text-body-13 text-02">
              Funded value split by the payment’s current outcome.
            </p>
            <dl className="flex flex-col divide-y divide-01">
              {flow.map(([label, key]) => (
                <div
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-body-13"
                >
                  <dt className="text-02">{label}</dt>
                  <dd className="font-mono text-01">
                    {money(totals?.[key] as string | undefined)}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel className="min-w-0 gap-4 p-5">
            <h3 className="text-label-md text-01">
              Results that passed their checks
            </h3>
            <p className="text-body-13 text-02">
              Collected payments as a share of collected plus refunded payments.
            </p>
            <p className="text-mono-2xl text-01">
              {analyticsRate(totals?.passRate)}
            </p>
            <AnalyticsChart
              label="Passed checks per day"
              values={daily.map((day) => ({
                day: day.day,
                value: day.passRate === null ? null : day.passRate * 100,
              }))}
            />
          </Panel>
        </div>
      </Section>
      <Section id="adoption" title="Adoption">
        <div className="grid gap-4 tablet:grid-cols-3">
          <ChartCard
            title="Agents paying each day"
            description="Different payer wallets with a funded paid call that day."
          >
            <AnalyticsChart
              compact
              label="Paying agents per day"
              values={daily.map((day) => ({
                day: day.day,
                value: day.payingAgents,
              }))}
            />
          </ChartCard>
          <ChartCard
            title="Agents since launch"
            description="Running total of wallets with a funded paid call."
          >
            <AnalyticsChart
              compact
              label="Agents since launch"
              values={daily.map((day) => ({
                day: day.day,
                value: day.agentsSinceLaunch,
              }))}
            />
          </ChartCard>
          <ChartCard
            title="Tools since launch"
            description="Running total of tools with a collected payment."
          >
            <AnalyticsChart
              compact
              label="Tools since launch"
              values={daily.map((day) => ({
                day: day.day,
                value: day.toolsSinceLaunch,
              }))}
            />
          </ChartCard>
        </div>
      </Section>
      <Section id="now" title="Right now">
        <div className="grid gap-4 tablet:grid-cols-2">
          <MetricTile
            label="Agent funds in escrow"
            value={money(data?.escrow?.available)}
            sub="Ledger balance available in registered buyer escrow accounts."
          />
          <MetricTile
            label="Held while checks run"
            value={money(data?.escrow?.held)}
            sub="Ledger balances reserved in registered buyer escrow accounts."
          />
        </div>
      </Section>
      <Section id="tools" title="Top tools">
        <p className="text-body-13 text-02">
          Public tools ranked by funded paid calls in the selected period.
        </p>
        <DataTable
          title="Top tools"
          columns={[
            "Tool",
            "Category",
            "Paid calls",
            "Volume",
            "Avg price",
            "Passed checks",
          ]}
        >
          {data?.topTools.length ? (
            data.topTools.map((tool) => (
              <tr key={tool.name} className="border-b border-01 last:border-0">
                <td className={CELL}>{tool.name}</td>
                <td className={CELL}>{tool.category}</td>
                <td className={CELL}>{analyticsCount(tool.paidCalls)}</td>
                <td className={CELL}>{money(tool.volume)}</td>
                <td className={CELL}>
                  {tool.paidCalls
                    ? money(
                        new Decimal(tool.volume)
                          .div(tool.paidCalls)
                          .toFixed(0, Decimal.ROUND_DOWN),
                      )
                    : "—"}
                </td>
                <td className={CELL}>{analyticsRate(tool.passRate)}</td>
              </tr>
            ))
          ) : (
            <NoRows columns={6} />
          )}
        </DataTable>
      </Section>
      <Section id="latest" title="Latest payments">
        <p className="text-body-13 text-02">
          Recent daily payment groups, newest UTC day first. Individual wallets
          and payment identifiers are not published.
        </p>
        <DataTable
          title="Latest payments"
          columns={[
            "UTC day",
            "Tool",
            "Paid calls",
            "Volume",
            "Collected",
            "Refunded",
          ]}
        >
          {data?.recent.length ? (
            data.recent.map((group) => (
              <tr
                key={`${group.day}:${group.tool}`}
                className="border-b border-01 last:border-0"
              >
                <td className={CELL}>{group.day}</td>
                <td className={CELL}>{group.tool}</td>
                <td className={CELL}>{analyticsCount(group.paidCalls)}</td>
                <td className={CELL}>{money(group.volume)}</td>
                <td className={CELL}>{analyticsCount(group.collectedCalls)}</td>
                <td className={CELL}>{analyticsCount(group.refundedCalls)}</td>
              </tr>
            ))
          ) : (
            <NoRows columns={6} />
          )}
        </DataTable>
        {data?.withheldForPrivacy ? (
          <p className="text-body-xs text-03">
            Some tool groups are withheld for privacy. Protocol totals still
            include them.
          </p>
        ) : null}
      </Section>
      <Section id="definitions" title="How each number is counted">
        <p className="max-w-3xl text-body-13 text-02">
          Each view covers one asset on one enabled chain. Amounts are never
          combined across assets. These are ledger records, not a live on-chain
          balance proof.
        </p>
        <Panel className="px-5">
          <dl className="divide-y divide-01">
            {DEFINITIONS.map(([term, definition]) => (
              <div
                key={term}
                className="grid gap-2 py-4 tablet:grid-cols-3 tablet:gap-6"
              >
                <dt className="text-label-sm text-01">{term}</dt>
                <dd className="text-body-13 text-02 tablet:col-span-2">
                  {definition}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </Section>
    </div>
  );
}
