"use client";

import { useState, type ReactNode } from "react";

import { MetricTile } from "@/components/ui/metric-tile";
import { Panel, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";

const RANGES = [
  { value: "7d", label: "7D", description: "Last 7 days" },
  { value: "30d", label: "30D", description: "Last 30 days" },
  { value: "90d", label: "90D", description: "Last 90 days" },
  { value: "all", label: "All", description: "Since launch" },
];
const METRICS = ["Revenue", "Volume", "Paid calls"];
const HEADLINE_METRICS = [
  ["Revenue", "Assay’s fee on payments that passed their checks."],
  ["Paid volume", "Everything agents paid for tool calls, before refunds."],
  ["Paid calls", "Tool calls an agent paid for."],
  ["Paying agents", "Different payer wallets that paid at least once."],
  ["Tools earning", "Tools with at least one collected payment."],
  ["Refunded to agents", "Payments returned when a result failed its checks."],
] as const;
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
    "Collected payments divided by collected plus refunded payments. Payments still being checked are excluded.",
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

function EmptyChart({ label }: { label: string }) {
  return (
    <div
      role="img"
      aria-label={`${label}: no data available`}
      className="relative flex min-h-48 items-center justify-center rounded-md border border-01 bg-02 p-5"
    >
      <div
        aria-hidden="true"
        className="absolute inset-5 flex flex-col justify-between"
      >
        {[0, 1, 2, 3].map((line) => (
          <div key={line} className="border-t border-01" />
        ))}
      </div>
      <span className="relative bg-02 px-3 font-mono text-03">—</span>
    </div>
  );
}

function ChartCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Panel className="min-w-0 gap-4 p-5">
      <h3 className="text-label-md text-01">{title}</h3>
      <p className="text-body-13 text-02">{description}</p>
      <EmptyChart label={title} />
    </Panel>
  );
}

function EmptyTable({
  title,
  columns,
}: {
  title: string;
  columns: readonly string[];
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
          <tbody>
            <tr>
              <td
                colSpan={columns.length}
                className="px-5 py-12 text-center text-03"
              >
                No data available.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function ProtocolAnalytics() {
  const [range, setRange] = useState("30d");
  const [metric, setMetric] = useState("Revenue");
  const rangeDescription = RANGES.find(
    (item) => item.value === range,
  )!.description;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-8 px-4 py-8 tablet:px-8 tablet:pb-16">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-heading-lg text-01">Assay protocol analytics</h1>
          <span className="rounded-full border border-02 bg-01 px-3 py-1 text-label-xs text-02">
            Robinhood Chain · USDG
          </span>
        </div>
        <p className="max-w-3xl text-body-sm text-01">
          Revenue, tool activity and agent adoption across the Assay protocol.
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
          onValueChange={setRange}
        >
          {RANGES.map((item) => (
            <SegmentedItem key={item.value} value={item.value}>
              {item.label}
            </SegmentedItem>
          ))}
        </Segmented>
        <p aria-live="polite" className="text-body-13 text-03">
          {rangeDescription} · UTC
        </p>
      </div>

      <section
        aria-label="Headline figures"
        className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 tablet:grid-cols-3"
      >
        {HEADLINE_METRICS.map(([label, sub]) => (
          <MetricTile key={label} label={label} value="—" sub={sub} />
        ))}
      </section>

      <Section id="revenue" title="Revenue and volume">
        <Panel>
          <PanelHeader className="flex-wrap">
            <div className="flex flex-col gap-1">
              <PanelTitle>Daily activity</PanelTitle>
              <p className="text-body-13 text-03">
                Per UTC day. {rangeDescription}.
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
            <EmptyChart label={`${metric} per day`} />
          </div>
        </Panel>
        <div className="grid gap-4 tablet:grid-cols-2">
          <Panel className="min-w-0 gap-4 p-5">
            <h3 className="text-label-md text-01">Where agents’ money went</h3>
            <p className="text-body-13 text-02">
              Payments split between providers, protocol fees and refunds.
            </p>
            <div aria-hidden="true" className="h-8 rounded-md bg-03" />
            <dl className="flex flex-col divide-y divide-01">
              {[
                ["To tool providers", "Paid once the result passed"],
                ["Assay revenue", "The protocol fee"],
                ["Refunded to agents", "The result failed its checks"],
              ].map(([label, note]) => (
                <div
                  key={label}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-body-13"
                >
                  <dt className="text-02">
                    {label}
                    <small className="block text-body-xs text-03">{note}</small>
                  </dt>
                  <dd className="font-mono text-01">
                    — <span className="text-03">—</span>
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
              Share of completed payments collected rather than refunded.
            </p>
            <p className="text-mono-2xl text-01">—</p>
            <EmptyChart label="Passed checks per day" />
          </Panel>
        </div>
      </Section>

      <Section id="adoption" title="Adoption">
        <div className="grid gap-4 tablet:grid-cols-3">
          <ChartCard
            title="Agents paying each day"
            description="Different payer wallets with a paid call that day."
          />
          <ChartCard
            title="Agents since launch"
            description="Running total of payer wallets that have paid."
          />
          <ChartCard
            title="Tools since launch"
            description="Running total of tools paid at least once."
          />
        </div>
      </Section>

      <Section id="now" title="Right now">
        <div className="grid gap-4 tablet:grid-cols-2">
          <MetricTile
            label="Agent funds in escrow"
            value="—"
            sub="Deposited funds available for agents to spend on tool calls."
          />
          <MetricTile
            label="Held while checks run"
            value="—"
            sub="Payments awaiting a result check, before collection or refund."
          />
        </div>
      </Section>

      <Section id="tools" title="Top tools">
        <p className="text-body-13 text-02">
          Tools with the most paid calls in the last 30 days.
        </p>
        <EmptyTable
          title="Top tools"
          columns={[
            "Tool",
            "Category",
            "Paid calls",
            "Volume",
            "Avg price",
            "Passed checks",
          ]}
        />
      </Section>

      <Section id="latest" title="Latest payments">
        <p className="text-body-13 text-02">
          The most recent paid calls, newest first. Times are UTC.
        </p>
        <EmptyTable
          title="Latest payments"
          columns={["Time", "Agent wallet", "Tool", "Amount", "Status"]}
        />
      </Section>

      <Section id="definitions" title="How each number is counted">
        <p className="max-w-3xl text-body-13 text-02">
          Metrics cover escrow payments and Assay’s tool registry.
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
