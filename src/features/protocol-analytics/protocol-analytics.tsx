"use client";

import { useState, type ReactNode } from "react";

import { MetricTile } from "@/components/ui/metric-tile";
import { Panel, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";

import { SampleChart } from "./sample-chart";
import {
  SAMPLE_DATA,
  sampleAnalytics,
  percentChange,
  formatMoney,
  formatCount,
  formatPercent,
  formatSampleDate,
  type AnalyticsRange,
  type DailyMetric,
  type SampleTool,
} from "./sample-analytics";

const RANGES: { value: AnalyticsRange; label: string; description: string }[] =
  [
    { value: "7d", label: "7D", description: "Last 7 days" },
    { value: "30d", label: "30D", description: "Last 30 days" },
    { value: "90d", label: "90D", description: "Last 90 days" },
    { value: "all", label: "All", description: "Since launch" },
  ];
const METRICS: { value: DailyMetric; label: string }[] = [
  { value: "fees_usd", label: "Revenue" },
  { value: "volume_usd", label: "Volume" },
  { value: "paid_calls", label: "Paid calls" },
];
const TOOL_COLUMNS: { key: keyof SampleTool; label: string }[] = [
  { key: "tool", label: "Tool" },
  { key: "category", label: "Category" },
  { key: "paid_calls", label: "Paid calls" },
  { key: "volume_usd", label: "Volume" },
  { key: "price_usd", label: "Avg price" },
  { key: "pass_rate", label: "Passed checks" },
];
const DEFINITIONS = [
  [
    "Revenue",
    "The protocol fee on each collected payment: the fee in AssayEscrow’s HeldCollected events.",
  ],
  [
    "Paid volume",
    "Amounts paid into escrow for tool calls, including payments later refunded: amount in PaymentHeld events.",
  ],
  [
    "Paid calls",
    "The number of payments made for tool calls: the count of PaymentHeld events in the selected period.",
  ],
  [
    "Refunded to agents",
    "Amounts returned to payer wallets: amount in HeldRefunded events.",
  ],
  [
    "Passed their checks",
    "For live data: collected payments divided by collected plus refunded payments, excluding pending. This fixture assumes the historical daily calls have finished checking.",
  ],
  [
    "Paying agents",
    "Distinct payer wallets with at least one payment in the period. One person can run several agents.",
  ],
  [
    "Tools earning",
    "Distinct tools with at least one collected payment in the period, joined to Assay’s tool registry.",
  ],
  [
    "Change figures",
    "Comparison with the previous period of the same length, when available. Since launch has no previous-period comparison.",
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

function changeLabel(change: number | null, range: AnalyticsRange): string {
  if (range === "all") return "Since launch";
  if (change === null) return "Previous period unavailable";
  return `${change >= 0 ? "▲" : "▼"} ${formatPercent(Math.abs(change))} vs previous ${range.slice(0, -1)} days`;
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

/** Fictional sample dashboard. The fixture is never represented as live protocol activity. */
export function ProtocolAnalytics() {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [metric, setMetric] = useState<DailyMetric>("fees_usd");
  const [sort, setSort] = useState<{
    key: keyof SampleTool;
    direction: 1 | -1;
  }>({ key: "paid_calls", direction: -1 });
  const {
    rows,
    current,
    previous,
    uniques,
    passRate,
    previousPassRate,
    growth,
  } = sampleAnalytics(range);
  const rangeDescription = RANGES.find(
    (item) => item.value === range,
  )!.description;
  const metricLabel = METRICS.find((item) => item.value === metric)!.label;
  const end = SAMPLE_DATA.daily.at(-1)!;
  const escrow = SAMPLE_DATA.escrow[0];
  const headline = [
    {
      label: "Revenue",
      value: formatMoney(current.fees_usd),
      sub: "Assay’s fee on payments that passed their checks.",
      change: percentChange(current.fees_usd, previous?.fees_usd ?? null),
    },
    {
      label: "Paid volume",
      value: formatMoney(current.volume_usd),
      sub: "Everything agents paid for tool calls, before refunds.",
      change: percentChange(current.volume_usd, previous?.volume_usd ?? null),
    },
    {
      label: "Paid calls",
      value: formatCount(current.paid_calls),
      sub: "Tool calls an agent paid for.",
      change: percentChange(current.paid_calls, previous?.paid_calls ?? null),
    },
    {
      label: "Paying agents",
      value: uniques.agents.toLocaleString("en-US"),
      sub: "Different payer wallets that paid at least once.",
      change: percentChange(uniques.agents, uniques.agents_prev),
    },
    {
      label: "Tools earning",
      value: formatCount(uniques.tools),
      sub: "Tools with at least one collected payment.",
      change: percentChange(uniques.tools, uniques.tools_prev),
    },
    {
      label: "Refunded to agents",
      value: formatMoney(current.refunded_usd),
      sub: "Payments returned when a result failed its checks.",
      change: percentChange(
        current.refunded_usd,
        previous?.refunded_usd ?? null,
      ),
    },
  ];
  const flow = [
    {
      label: "To tool providers",
      note: "Paid once the result passed",
      amount: current.provider_usd,
      color: "var(--chart-1)",
    },
    {
      label: "Assay revenue",
      note: "The protocol fee",
      amount: current.fees_usd,
      color: "var(--chart-2)",
    },
    {
      label: "Refunded to agents",
      note: "The result failed its checks",
      amount: current.refunded_usd,
      color: "var(--chart-4)",
    },
  ];
  const tools = [...SAMPLE_DATA.tools].sort((a, b) => {
    const first = a[sort.key];
    const second = b[sort.key];
    return (
      (typeof first === "string"
        ? first.localeCompare(String(second))
        : first - Number(second)) * sort.direction
    );
  });
  function sortTools(key: keyof SampleTool) {
    setSort((old) => ({
      key,
      direction:
        old.key === key
          ? old.direction === 1
            ? -1
            : 1
          : key === "tool" || key === "category"
            ? 1
            : -1,
    }));
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-8 px-4 py-8 tablet:px-8 tablet:pb-16">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-heading-lg text-01">Assay protocol analytics</h1>
          <span className="rounded-full border border-02 bg-01 px-3 py-1 text-label-xs text-02">
            Robinhood Chain · USDG · Sample
          </span>
        </div>
        <div className="rounded-lg border border-warning-20 bg-warning-10 px-4 py-3 text-body-13 text-01">
          <strong>Sample data.</strong> Every number, chart and payment on this
          page is fictional, copied from the design prototype to demonstrate the
          layout. These are not Assay’s real figures.
        </div>
        <p className="max-w-3xl text-body-sm text-01">
          In this sample, Assay earned{" "}
          <strong>{formatMoney(current.fees_usd)}</strong> in{" "}
          {range === "all"
            ? "the period since launch"
            : `the ${rangeDescription.toLowerCase()}`}
          , and <strong>{formatPercent(passRate)}</strong> of paid calls passed
          their checks.
        </p>
        <p className="max-w-3xl text-body-13 text-02">
          An agent pays for a tool call into escrow. The result is checked
          before the provider is paid. If the result fails its checks, the held
          payment is returned to the agent.
        </p>
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
        <p aria-live="polite" className="text-body-13 text-03">
          {rangeDescription} · to {formatSampleDate(end.day)} · UTC · Sample
        </p>
      </div>

      <section
        aria-label="Headline figures"
        className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 tablet:grid-cols-3"
      >
        {headline.map((tile) => (
          <MetricTile
            key={tile.label}
            label={tile.label}
            value={tile.value}
            sub={tile.sub}
            meta={changeLabel(tile.change, range)}
          />
        ))}
      </section>

      <Section id="revenue" title="Revenue and volume">
        <Panel>
          <PanelHeader className="flex-wrap">
            <div className="flex flex-col gap-1">
              <PanelTitle>Daily activity</PanelTitle>
              <p className="text-body-13 text-03">
                Per UTC day. Sample protocol fee:{" "}
                {formatPercent(escrow.take_rate)}.
              </p>
            </div>
            <Segmented
              aria-label="Metric"
              value={metric}
              onValueChange={(value) => setMetric(value as DailyMetric)}
            >
              {METRICS.map((item) => (
                <SegmentedItem key={item.value} value={item.value}>
                  {item.label}
                </SegmentedItem>
              ))}
            </Segmented>
          </PanelHeader>
          <div className="p-5">
            <SampleChart
              label={`${metricLabel} per day`}
              points={rows.map((row) => ({ day: row.day, value: row[metric] }))}
              kind="bars"
              format={metric === "paid_calls" ? "count" : "money"}
            />
          </div>
        </Panel>
        <div className="grid gap-4 tablet:grid-cols-2">
          <ChartCard
            title="Where agents’ money went"
            description={`Payments in the ${rangeDescription.toLowerCase()}, split three ways. Sample data.`}
          >
            <div
              aria-hidden="true"
              className="flex h-8 overflow-hidden rounded-md"
            >
              {flow.map((item) => (
                <div
                  key={item.label}
                  style={{
                    width: `${(item.amount / current.volume_usd) * 100}%`,
                    background: item.color,
                  }}
                />
              ))}
            </div>
            <dl className="flex flex-col divide-y divide-01">
              {flow.map((item) => (
                <div
                  key={item.label}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-body-13"
                >
                  <dt className="flex items-center gap-2 text-02">
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: item.color }}
                    />
                    <span>
                      {item.label}
                      <small className="block text-body-xs text-03">
                        {item.note}
                      </small>
                    </span>
                  </dt>
                  <dd className="font-mono text-01">
                    {formatMoney(item.amount)}{" "}
                    <span className="text-03">
                      {formatPercent(item.amount / current.volume_usd)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </ChartCard>
          <ChartCard
            title="Results that passed their checks"
            description="Share of historical sample calls collected rather than refunded."
          >
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-mono-2xl text-01">{formatPercent(passRate)}</p>
              <p className="text-body-13 text-02">
                {previousPassRate === null
                  ? range === "all"
                    ? "Since launch"
                    : "Previous period unavailable"
                  : `${passRate >= previousPassRate ? "▲" : "▼"} ${Math.abs((passRate - previousPassRate) * 100).toFixed(1)} pts vs previous ${range.slice(0, -1)} days`}
              </p>
            </div>
            <SampleChart
              label="Passed checks per day"
              format="percent"
              points={rows.map((row) => ({
                day: row.day,
                value: 1 - row.calls_refunded / row.paid_calls,
              }))}
            />
          </ChartCard>
        </div>
      </Section>

      <Section id="adoption" title="Adoption">
        <div className="grid gap-4 tablet:grid-cols-3">
          <ChartCard
            title="Agents paying each day"
            description="Different payer wallets with a paid call that day. Sample data."
          >
            <SampleChart
              compact
              label="Paying agents per day"
              kind="bars"
              points={rows.map((row) => ({
                day: row.day,
                value: row.active_agents,
              }))}
            />
          </ChartCard>
          <ChartCard
            title="Agents since launch"
            description="Running total of payer wallets that have paid. Sample data."
          >
            <SampleChart
              compact
              label="Agents since launch"
              points={growth.map((row) => ({
                day: row.day,
                value: row.agents,
              }))}
            />
          </ChartCard>
          <ChartCard
            title="Tools since launch"
            description="Running total of tools paid at least once. Sample data."
          >
            <SampleChart
              compact
              label="Tools since launch"
              points={growth.map((row) => ({ day: row.day, value: row.tools }))}
            />
          </ChartCard>
        </div>
      </Section>

      <Section id="now" title="Right now">
        <p className="text-body-13 text-03">
          Sample snapshot as of {formatSampleDate(end.day)}. Not live balances.
        </p>
        <div className="grid gap-4 tablet:grid-cols-2">
          <MetricTile
            label="Agent funds in escrow"
            value={formatMoney(escrow.agent_balances_usd)}
            sub="Deposited funds available for agents to spend on tool calls."
            meta="Sample balance"
          />
          <MetricTile
            label="Held while checks run"
            value={formatMoney(escrow.held_usd)}
            sub="Payments awaiting a result check, before collection or refund."
            meta="Sample balance"
          />
        </div>
      </Section>

      <Section id="tools" title="Top tools">
        <p className="text-body-13 text-02">
          The twelve sample tools with the most paid calls in the last 30 days.
          This table has a fixed 30-day window. Select a column to sort.
        </p>
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-13">
              <caption className="sr-only">
                Top tools — fictional sample data, last 30 days
              </caption>
              <thead className="border-b border-01 bg-02 text-02">
                <tr>
                  {TOOL_COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={
                        sort.key === column.key
                          ? sort.direction === 1
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                      className="whitespace-nowrap px-5 py-3"
                    >
                      <button
                        type="button"
                        onClick={() => sortTools(column.key)}
                        className="min-h-10 rounded-md text-label-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                      >
                        {column.label}
                        {sort.key === column.key
                          ? sort.direction === 1
                            ? " ▲"
                            : " ▼"
                          : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tools.map((tool) => (
                  <tr
                    key={tool.tool}
                    className="border-b border-01 last:border-0"
                  >
                    <td className="whitespace-nowrap px-5 py-4 font-mono text-01">
                      {tool.tool}
                    </td>
                    <td className="px-5 py-4 text-02">{tool.category}</td>
                    <td className="px-5 py-4 text-right font-mono text-01">
                      {tool.paid_calls.toLocaleString("en-US")}
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-01">
                      {formatMoney(tool.volume_usd)}
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-01">
                      {formatMoney(tool.price_usd, true)}
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-01">
                      {formatPercent(tool.pass_rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </Section>

      <Section id="latest" title="Latest payments">
        <p className="text-body-13 text-02">
          Fictional payments from {formatSampleDate(end.day)}, newest first.
          Times are UTC. This sample feed is independent of the time-range
          filter.
        </p>
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-13">
              <caption className="sr-only">
                Latest payments — fictional sample data
              </caption>
              <thead className="border-b border-01 bg-02 text-02">
                <tr>
                  {["Time", "Agent wallet", "Tool", "Amount", "Status"].map(
                    (column) => (
                      <th
                        key={column}
                        scope="col"
                        className="whitespace-nowrap px-5 py-4 text-label-sm"
                      >
                        {column}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {SAMPLE_DATA.recent.map((payment) => (
                  <tr
                    key={payment.time}
                    className="border-b border-01 last:border-0"
                  >
                    <td className="whitespace-nowrap px-5 py-4 font-mono text-02">
                      {payment.time.slice(11, 19)}
                    </td>
                    <td className="px-5 py-4 font-mono text-02">
                      <abbr
                        title={payment.agent}
                        className="whitespace-nowrap no-underline"
                      >
                        {payment.agent.slice(0, 8)}…{payment.agent.slice(-6)}
                      </abbr>
                    </td>
                    <td className="px-5 py-4 font-mono text-01">
                      {payment.tool}
                    </td>
                    <td className="px-5 py-4 text-right font-mono text-01">
                      {formatMoney(payment.amount_usd, true)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={
                          payment.outcome === "Settled"
                            ? "rounded-full bg-success-10 px-2 py-1 text-label-xs text-success-600"
                            : "rounded-full bg-warning-10 px-2 py-1 text-label-xs text-warning-600"
                        }
                      >
                        {payment.outcome}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </Section>

      <Section id="definitions" title="How each number is counted">
        <p className="max-w-3xl text-body-13 text-02">
          The figures above are fictional sample data, denominated in USDG in
          the prototype. Future live figures will come from escrow payment
          records and Assay’s tool registry. Internal project traffic must be
          identified separately from external activity.
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
