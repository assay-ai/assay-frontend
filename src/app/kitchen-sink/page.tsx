"use client";

import * as React from "react";

import { BalanceCards } from "@/components/funding/balance-cards";
import { AlertBadge } from "@/components/ui/alert-badge";
import { ApprovalCard } from "@/components/ui/approval-card";
import { Arithmetic, type ArithmeticRow } from "@/components/ui/arithmetic";
import { Avatar, type AvatarColor } from "@/components/ui/avatar";
import { Badge, BADGE_VARIANTS, type BadgeVariant } from "@/components/ui/badge";
import { Banner, BannerAction } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CardRow, type CardRowFigure } from "@/components/ui/card-row";
import { Checkbox } from "@/components/ui/checkbox";
import { CodeBlock } from "@/components/ui/code-block";
import { Donut, type DonutSlice } from "@/components/ui/donut";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Meter } from "@/components/ui/meter";
import { MetricTile } from "@/components/ui/metric-tile";
import { MoneyPair } from "@/components/ui/money-pair";
import {
  Panel,
  PanelAction,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Radio } from "@/components/ui/radio";
import { SamplingExplainer } from "@/components/ui/sampling-explainer";
import { Search } from "@/components/ui/search";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import {
  capSeries,
  StackedBarChart,
  type ChartBar,
  type ChartSeries,
} from "@/components/ui/stacked-bar-chart";
import { StageList, type StageCheck } from "@/components/ui/stage-list";
import { Switch } from "@/components/ui/switch";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Timeline, type TimelineEvent } from "@/components/ui/timeline";
import { WindowGauge } from "@/components/ui/window-gauge";

import { BottomTabBar } from "@/components/layout/bottom-tab-bar";
import { MobileTopBar } from "@/components/layout/mobile-top-bar";
import { PublicTopBar } from "@/components/layout/public-top-bar";
import { Sidebar, type SidebarBindingItem } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";

import { cn } from "@/utils";

import { PatternsGallery } from "./patterns-gallery";

/* ------------------------------------------------------------------------
 * Local, page-only icons. The design-system components draw their own
 * icons internally; this page only needs a handful of generic glyphs to
 * exercise icon slots (`Button.icon`, `IconButton.icon`, `Banner.icon`).
 * ---------------------------------------------------------------------- */

function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function EllipsisIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" {...props}>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function ShieldIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 2 4 5v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function CompassIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="m16.24 7.76-3.06 7.5-7.5 3.06 3.06-7.5z" />
    </svg>
  );
}

/* ------------------------------------------------------------------------
 * Spec-sheet scaffolding — group headers and a labelled specimen wrapper.
 * The overflow-x-auto wrapper is the safety net that keeps components with
 * fixed pixel widths (Arithmetic, Timeline, StageList, Table, …) from ever
 * forcing the page itself to scroll horizontally at 390px.
 * ---------------------------------------------------------------------- */

function Group({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex w-full flex-col gap-8">
      <div className="flex items-baseline gap-3 border-b border-01 pb-3">
        <span className="font-mono text-mono-xs text-03">{index}</span>
        <h2 className="text-label-md text-01">{title}</h2>
      </div>
      <div className="flex w-full flex-col gap-9">{children}</div>
    </section>
  );
}

function Spec({
  name,
  children,
  className,
}: {
  name: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full flex-col gap-2.5", className)}>
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-03">{name}</span>
      <div className="w-full overflow-x-auto">
        <div className="flex min-w-fit flex-wrap items-start gap-3">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------
 * Sample data — plausible Assay product content.
 * ---------------------------------------------------------------------- */

const arithmeticRows: ArithmeticRow[] = [
  { label: "verified_calls", expression: "92 / 612 =", value: "15.03%", note: "sample rate this window" },
  { label: "stake_bonded", value: "$4,200.0000", note: "raw input, no formula", valueTone: "muted" },
  { label: "exposure_delta", expression: "$4,200.00 − $3,958.20 =", value: "$241.80", valueTone: "success" },
  { label: "slash_amount", expression: "$1.00 × 3 =", value: "−$3.0000", note: "capped per economic parameters", valueTone: "danger" },
];

const donutSlices: DonutSlice[] = [
  { label: "Passed", value: 560, colorVar: "var(--success-500)" },
  { label: "Failed our checks", value: 14, colorVar: "var(--danger-500)" },
  { label: "Degraded", value: 22, colorVar: "var(--warning-500)" },
  { label: "Not sampled", value: 1200, colorVar: "var(--bg-04)" },
];

const donutEmptySlices: DonutSlice[] = [
  { label: "Passed", value: 0, displayValue: "—", colorVar: "var(--success-500)" },
  { label: "Failed our checks", value: 0, displayValue: "—", colorVar: "var(--danger-500)" },
  { label: "Degraded", value: 0, displayValue: "—", colorVar: "var(--warning-500)" },
  { label: "Not sampled", value: 0, displayValue: "—", colorVar: "var(--bg-04)" },
];

const chartSeriesFull: ChartSeries[] = [
  { key: "search_web", label: "search_web", tone: 1 },
  { key: "get_token_price", label: "get_token_price", tone: 2 },
  { key: "scrape_url", label: "scrape_url", tone: 3 },
  { key: "deep_research", label: "deep_research", tone: 4 },
  { key: "summarize_doc", label: "summarize_doc", tone: 5 },
];

const chartBarsFull: ChartBar[] = [
  { label: "Aug 14", values: { search_web: 18, get_token_price: 9, scrape_url: 6, deep_research: 4, summarize_doc: 3 } },
  { label: "Aug 15", values: { search_web: 21, get_token_price: 7, scrape_url: 5, deep_research: 6, summarize_doc: 2 } },
  { label: "Aug 16", values: { search_web: 15, get_token_price: 11, scrape_url: 8, deep_research: 3, summarize_doc: 4 } },
  { label: "Aug 17", values: { search_web: 24, get_token_price: 6, scrape_url: 4, deep_research: 5, summarize_doc: 1 } },
  { label: "Aug 18", values: { search_web: 19, get_token_price: 10, scrape_url: 7, deep_research: 2, summarize_doc: 3 } },
  { label: "Aug 19", values: { search_web: 22, get_token_price: 8, scrape_url: 5, deep_research: 4, summarize_doc: 2 } },
  { label: "Aug 20", values: { search_web: 17, get_token_price: 9, scrape_url: 6, deep_research: 3, summarize_doc: 5 } },
];

const chartSeriesSmall: ChartSeries[] = [
  { key: "search_web", label: "search_web", tone: 1 },
  { key: "get_token_price", label: "get_token_price", tone: 2 },
  { key: "scrape_url", label: "scrape_url", tone: 3 },
];

const chartBarsSmall: ChartBar[] = chartBarsFull.map((bar) => ({
  label: bar.label,
  values: {
    search_web: bar.values.search_web ?? 0,
    get_token_price: bar.values.get_token_price ?? 0,
    scrape_url: bar.values.scrape_url ?? 0,
  },
}));

const cappedChart = capSeries(chartSeriesFull, chartBarsFull, 3);

interface CallRow extends TableRowData {
  tool: string;
  calls: string;
  listed: string;
  charged: string;
  notCharged: string;
  fail: string;
  p95: string;
}

const callColumns: TableColumn<CallRow>[] = [
  { key: "tool", header: "TOOL", cell: (row) => row.tool, mono: true },
  { key: "calls", header: "CALLS", cell: (row) => row.calls, width: 110, align: "end", mono: true },
  { key: "listed", header: "LISTED", cell: (row) => row.listed, width: 110, align: "end", mono: true },
  { key: "charged", header: "CHARGED", cell: (row) => row.charged, width: 110, align: "end", mono: true },
  { key: "notCharged", header: "NOT CHARGED", cell: (row) => row.notCharged, width: 130, align: "end", mono: true, notCharged: true },
  { key: "fail", header: "FAIL", cell: (row) => row.fail, width: 90, align: "end", mono: true },
  { key: "p95", header: "P95", cell: (row) => row.p95, width: 90, align: "end", mono: true },
];

const callRows: CallRow[] = [
  {
    id: "search_web",
    tool: "search_web",
    calls: "14,760",
    listed: "$36.9000",
    charged: "$36.0200",
    notCharged: "$0.8800",
    fail: "2.4%",
    p95: "1.8s",
    drill: [
      { id: "prv_crawlco", tool: "prv_crawlco", calls: "9,200", listed: "$23.0000", charged: "$22.5400", notCharged: "$0.4600", fail: "2.1%", p95: "1.6s" } as CallRow,
      { id: "prv_searchly", tool: "prv_searchly", calls: "5,560", listed: "$13.9000", charged: "$13.4800", notCharged: "$0.4200", fail: "2.9%", p95: "2.2s" } as CallRow,
    ],
  },
  {
    id: "get_token_price",
    tool: "get_token_price",
    calls: "3,780",
    listed: "$9.4500",
    charged: "$9.3100",
    notCharged: "$0.1400",
    fail: "0.6%",
    p95: "0.4s",
  },
];

const callTotal = {
  label: "Total",
  values: { calls: "18,540", listed: "$46.3500", charged: "$45.3300", notCharged: "$1.0200", fail: "", p95: "" },
};

const stageChecksPassed: StageCheck[] = [
  { name: "Response shape", status: "passed", note: "runs on every call", detail: "Returned valid JSON matching the tool's declared schema." },
  { name: "Result quality rules", status: "passed", note: "runs on every call" },
  { name: "Independent cross-check", status: "passed", note: "1 call in 12 at this price" },
  { name: "Relevance judgement", status: "not-sampled", note: "1 call in 125 at this price" },
];

const stageChecksFailed: StageCheck[] = [
  { name: "Response shape", status: "passed", note: "runs on every call" },
  { name: "Result quality rules", status: "failed", note: "runs on every call", detail: "EXPECTED_FIELD_MISSING: response.result.price", detailVariant: "error" },
  { name: "Independent cross-check", status: "not-reached" },
  { name: "Relevance judgement", status: "not-reached" },
];

const timelineEvents: TimelineEvent[] = [
  { time: "10:00:00.004", label: "Call created", tone: "neutral" },
  { time: "10:00:00.041", label: "Funds held", meta: "$0.0100", tone: "primary" },
  { time: "10:00:00.812", label: "Response returned", meta: "408ms", tone: "neutral" },
  { time: "10:00:01.203", label: "Verification sampled", meta: "prv_searchly · 391ms" },
  { time: "10:00:01.980", label: "Refunded", meta: "$0.0100", tone: "teal" },
  { time: "10:00:02.001", label: "Settled", meta: "prv_searchly · TRUSTED · 408ms", tone: "success" },
];

const codeSampleA = `{
  "tool": "search_web",
  "arguments": {
    "query": "solana restaking apy",
    "max_results": 5
  }
}`;

const codeSampleB = `{
  "mcpServers": {
    "x402": {
      "url": "https://mcp.example.com",
      "headers": { "Authorization": "Bearer sk_live_..." }
    }
  }
}`;

const sidebarBindings: SidebarBindingItem[] = [
  { id: "search_web", label: "Web search", status: "live", href: "#" },
  { id: "get_token_price", label: "Token price", status: "live", href: "#" },
  { id: "scrape_url", label: "Page scraper", status: "paused", href: "#" },
];

const AVATAR_COLOR_LIST: AvatarColor[] = [
  "primary",
  "indigo",
  "pink",
  "teal",
  "yellow",
  "lime",
  "success",
  "danger",
  "warning",
  "info",
];

const cardRowFiguresA: CardRowFigure[] = [
  { label: "Listed", value: "$36.9000" },
  { label: "Charged", value: "$36.0200" },
  { label: "Not charged", value: "$0.8800", tone: "teal" },
];

const cardRowFiguresB: CardRowFigure[] = [
  { label: "Listed", value: "$9.4500" },
  { label: "Charged", value: "$9.3100" },
  { label: "Not charged", value: "$0.1400", tone: "teal" },
];

/* ------------------------------------------------------------------------
 * Page
 * ---------------------------------------------------------------------- */

export default function KitchenSinkPage() {
  const [theme, setTheme] = React.useState<"light" | "dark">("light");
  const [expandedRows, setExpandedRows] = React.useState<string[]>(["search_web"]);
  const [sliderValue, setSliderValue] = React.useState(220);
  const [activeTab, setActiveTab] = React.useState("overview");

  // The app locks data-theme to light; take that as the starting point and
  // put it back on unmount so the dark preview does not leak into other routes.
  const previousTheme = React.useRef<string | null>(null);
  React.useEffect(() => {
    const root = document.documentElement;
    previousTheme.current = root.getAttribute("data-theme");
    setTheme(previousTheme.current === "dark" ? "dark" : "light");
    return () => {
      if (previousTheme.current === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previousTheme.current);
    };
  }, []);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <div className="min-h-screen w-full bg-01 pb-24">
      <div className="sticky top-0 z-[60] flex w-full items-center justify-between gap-3 border-b border-01 bg-01/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-10">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="truncate text-label-md text-01">Assay design system — kitchen sink</h1>
          <p className="truncate font-mono text-mono-xs text-03">Acceptance surface — every component, every state</p>
        </div>
        <button
          type="button"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          className="shrink-0 rounded-md border border-02 bg-01 px-3 py-1.5 text-label-13 text-01 shadow-hair transition-colors hover:bg-02"
        >
          {theme === "dark" ? "Switch to light" : "Switch to dark"}
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-16 px-4 py-10 sm:px-6 lg:px-10">
        {/* ================================================================
         * 1. Primitives
         * ============================================================== */}
        <Group index="01" title="Primitives">
          {(["primary", "secondary", "ghost", "danger", "success"] as const).map((variant) => (
            <Spec key={variant} name={`button · ${variant}`}>
              <Button variant={variant}>Approve this call</Button>
              <Button variant={variant} size="sm">
                Approve
              </Button>
              <Button variant={variant} disabled>
                Approve this call
              </Button>
              <Button variant={variant} loading>
                Approve this call
              </Button>
              <Button variant={variant} icon={<PlusIcon className="h-[15px] w-[15px]" />}>
                Approve $10 today
              </Button>
            </Spec>
          ))}

          <Spec name="icon-button">
            <IconButton icon={<EllipsisIcon className="h-4 w-4" />} aria-label="More actions" />
            <IconButton icon={<EllipsisIcon className="h-4 w-4" />} aria-label="More actions" disabled />
          </Spec>

          <Spec name="badge · all variants">
            {(Object.keys(BADGE_VARIANTS) as BadgeVariant[]).map((variant) => (
              <Badge key={variant} variant={variant} />
            ))}
          </Spec>

          <Spec name="avatar · sizes (xs → xl)">
            {(["xs", "sm", "md", "lg", "xl"] as const).map((size) => (
              <Avatar key={size} size={size} name="Agent Prod" />
            ))}
          </Spec>
          <Spec name="avatar · color ramp (md, initials)">
            {AVATAR_COLOR_LIST.map((color) => (
              <Avatar key={color} color={color} initials={color.slice(0, 2).toUpperCase()} />
            ))}
          </Spec>
          <Spec name="avatar · image + broken-src fallback">
            <Avatar name="Agent Prod" src="/images/favicon.png" />
            <Avatar name="QA Runner" src="/images/does-not-exist-xyz.png" />
            <Avatar initials="X4" color="pink" />
          </Spec>
          <Spec name="avatar · seeded by wallet address (sm / md / xl)">
            {[
              "0x52908400098527886E0F7030069857D2E4169EE7",
              "0x8617e340b3d01fa5f11f306f4090fd50e238070d",
              "0xde709f2102306220921060314715629080e2fb77",
              "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
              "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
            ].map((address) => (
              <React.Fragment key={address}>
                <Avatar name={address} seed={address} size="sm" />
                <Avatar name={address} seed={address} size="md" />
                <Avatar name={address} seed={address} size="xl" />
              </React.Fragment>
            ))}
          </Spec>

          <Spec name="checkbox">
            <Checkbox label="38% of monthly budget" defaultChecked />
            <Checkbox label="Notify on every settlement" />
            <Checkbox label="Auto-approve under $1" defaultChecked disabled />
            <Checkbox label="Auto-approve under $1" disabled />
          </Spec>

          <Spec name="radio">
            <Radio name="policy-scope" label="This call only" defaultChecked />
            <Radio name="policy-scope" label="This session" />
            <Radio name="policy-scope" label="Always for this tool" disabled />
          </Spec>

          <Spec name="switch">
            <Switch label="SLA breach webhook" defaultChecked />
            <Switch label="Shadow-mode slashing" />
            <Switch label="Auto-pause on grace expiry" defaultChecked disabled />
            <Switch label="Auto-pause on grace expiry" disabled />
          </Spec>

          <Spec name="slider · custom formatters">
            <Slider
              label="slaFailureRate"
              min={0}
              max={0.1}
              step={0.001}
              defaultValue={0.02}
              formatValue={(v) => `${(v * 100).toFixed(1)}%`}
              formatBound={(v) => `${(v * 100).toFixed(0)}%`}
            />
          </Spec>
          <Spec name="slider · controlled">
            <Slider
              label="minimumStakeOverride"
              min={0}
              max={500}
              step={10}
              value={sliderValue}
              onValueChange={setSliderValue}
              formatValue={(v) => `$${v.toFixed(2)}`}
            />
          </Spec>
          <Spec name="slider · disabled">
            <Slider label="samplingRate (locked)" min={0} max={1} step={0.01} defaultValue={0.08} disabled />
          </Spec>

          <Spec name="field · default / error / disabled / focused">
            <Field id="amount-default" label="Amount" suffix="USDC" defaultValue="11.40" hint="Withdrawable $11.40" />
            <Field id="amount-error" label="Amount" suffix="USDC" defaultValue="500.00" error="Exceeds withdrawable balance" />
            <Field id="amount-disabled" label="Amount" suffix="USDC" defaultValue="0.00" disabled />
            <Field id="amount-focused" label="Destination memo" placeholder="optional" autoFocus hint="autofocused on load, to show the focus ring" />
          </Spec>

          <Spec name="select · default / disabled">
            <Select id="destination" label="Destination" hint="3 allowlisted destinations">
              <option>7xKX…vault (added 2026-07-02)</option>
              <option>9mQz…cold (added 2026-05-11)</option>
            </Select>
            <Select id="destination-disabled" label="Destination" disabled>
              <option>7xKX…vault</option>
            </Select>
          </Spec>

          <Spec name="search · with shortcut / without / disabled">
            <Search placeholder="Receipt, ULID, tool or tx…" />
            <Search placeholder="Receipt, ULID, tool or tx…" shortcut={null} />
            <Search placeholder="Receipt, ULID, tool or tx…" disabled />
          </Spec>

          <Spec name="segmented">
            <Segmented defaultValue="24h">
              <SegmentedItem value="24h">24h</SegmentedItem>
              <SegmentedItem value="7d">7d</SegmentedItem>
              <SegmentedItem value="30d" disabled>
                30d
              </SegmentedItem>
            </Segmented>
          </Spec>

          <Spec name="tabs">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="calls">Calls</TabsTrigger>
                <TabsTrigger value="audit" disabled>
                  Audit log
                </TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="pt-3 text-body-13 text-02">
                prv_crawlco · verified tier · bonded $4,200.0000
              </TabsContent>
              <TabsContent value="calls" className="pt-3 text-body-13 text-02">
                14,760 calls this window · fail 2.4% · p95 1.8s
              </TabsContent>
            </Tabs>
          </Spec>

          <Spec name="banner · warning (custom icon)">
            <Banner
              tone="warning"
              icon={<ShieldIcon className="h-full w-full" />}
              title="Provider stake below minimum"
              description="prv_crawlco is 12% under its minimum stake — new calls may be declined."
            />
          </Spec>
          <Spec name="banner · danger (shown-as copy)">
            <Banner
              tone="danger"
              title="Failed our checks — you were not charged"
              description="search_web · pi_01J8XZQ8H4M2K7YT · $0.0100"
              action={<BannerAction onClick={() => {}}>View details</BannerAction>}
            />
          </Spec>
          <Spec name="banner · teal (shown-as copy)">
            <Banner
              tone="teal"
              title="Passed every check we run on this call"
              description="get_token_price · pi_01J8XZQ4M7K2N9P3 · $0.0025"
              action={<BannerAction onClick={() => {}}>View receipt</BannerAction>}
            />
          </Spec>
          <Spec name="banner · primary (no icon)">
            <Banner
              tone="primary"
              icon={null}
              title="Verification sampling is on for this tool"
              description="1 call in 125 is judged; the rest lean on the provider's stake."
            />
          </Spec>
        </Group>

        {/* ================================================================
         * 2. Money and measurement
         * ============================================================== */}
        <Group index="02" title="Money and measurement">
          <Spec name="arithmetic">
            <Arithmetic rows={arithmeticRows} className="min-w-[720px]" />
          </Spec>

          <Spec name="meter · warning / primary / teal / overflow">
            <Meter label="Per day" amount="$8.20 of $10.00" percent={82} note="82% used · resets 00:00 UTC" tone="warning" className="w-[280px]" />
            <Meter label="Per month" amount="$212.40 of $460.00" percent={46} note="46% used · resets in 12 days" tone="primary" className="w-[280px]" />
            <Meter label="Free quota" amount="$0.00 of $5.00" percent={0} note="0% used · resets 00:00 UTC" tone="teal" className="w-[280px]" />
            <Meter label="Per day (over ceiling)" amount="$12.10 of $10.00" percent={121} note="121% used — over daily ceiling" tone="warning" className="w-[280px]" />
          </Spec>

          <Spec name="metric-tile · default / teal / meta tones">
            <MetricTile label="Balance" value="$212.4090" sub="available" meta="$0.06 held · 4 in flight" className="w-[220px]" />
            <MetricTile label="Today" value="$8.2000" sub="1,412 calls" meta="▲ 38% vs yesterday" metaTone="warning" className="w-[220px]" />
            <MetricTile label="Not charged" value="$1.1400" sub="24 calls" tone="teal" className="w-[220px]" />
          </Spec>

          <Spec name="money-pair · with / without the counterfactual">
            <MoneyPair listedValue="$0.0025" paidValue="$0.0025" className="w-[280px]" />
            <MoneyPair listedValue="$0.0100" paidValue="$0.0000" notChargedValue="$0.0100" className="w-[280px]" />
          </Spec>

          <Spec name="donut · verdict breakdown / empty">
            <Donut slices={donutSlices} centerValue="96.6%" centerLabel="pass rate" className="w-[240px]" />
            <Donut slices={donutEmptySlices} centerValue="—" centerLabel="no calls yet" className="w-[240px]" />
          </Spec>

          <Spec name="stacked-bar-chart · default (3 series)">
            <StackedBarChart
              series={chartSeriesSmall}
              bars={chartBarsSmall}
              ticks={["$30", "$22.5", "$15", "$7.5", "$0"]}
              scaleMax={30}
              caption="Spend per day for the last 7 days, by tool."
              className="min-w-[560px]"
            />
          </Spec>
          <Spec name="stacked-bar-chart · capSeries fold (5 → 3 + other)">
            <StackedBarChart
              series={cappedChart.series}
              bars={cappedChart.bars}
              ticks={["$40", "$30", "$20", "$10", "$0"]}
              scaleMax={40}
              caption="Spend per day for the last 7 days, by tool, folded to the mobile cap."
              className="min-w-[560px]"
            />
          </Spec>

          <Spec name="window-gauge · primary / success / danger / warning">
            <WindowGauge
              value={218}
              max={400}
              label="verified calls"
              tone="primary"
              state={<Badge variant="checking" />}
              hint="below 400, no proposal can be issued"
              className="w-[320px]"
            />
            <WindowGauge value={400} max={400} label="verified calls (met)" tone="success" state={<Badge variant="active" />} hint="threshold met" className="w-[320px]" />
            <WindowGauge value={0} max={400} label="verified calls (none yet)" tone="danger" state={<Badge variant="not-sampled" />} hint="collection just started" className="w-[320px]" />
            <WindowGauge value={250} max={300} label="grace window" tone="warning" state={<Badge variant="degraded" />} hint="closes in 4h 12m" className="w-[320px]" />
          </Spec>

          <Spec name="card-row · interactive / static">
            <CardRow name="scrape_url" callsLabel="14,760 calls" figures={cardRowFiguresA} meta="fail 2.4% · p95 1.8s · $0.0025 each" onClick={() => {}} className="w-[300px]" />
            <CardRow name="get_token_price" callsLabel="3,780 calls" figures={cardRowFiguresB} meta="fail 0.6% · p95 0.4s · $0.0025 each" className="w-[300px]" />
          </Spec>

          <Spec name="table · drill rows, totals, empty">
            <Table
              columns={callColumns}
              rows={callRows}
              total={callTotal}
              expanded={expandedRows}
              onToggleRow={(id) => setExpandedRows((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
              caption="Calls by tool, last 7 days"
              className="min-w-[760px]"
            />
          </Spec>
          <Spec name="table · empty (no rows)">
            <Table columns={callColumns} rows={[]} caption="Calls by tool — no data" className="min-w-[760px]" />
          </Spec>
        </Group>

        {/* ================================================================
         * 3. Verification
         * ============================================================== */}
        <Group index="03" title="Verification">
          <Spec name="approval-card · default">
            <ApprovalCard
              amount="$2.50"
              toolName="deep_research"
              context="agent prod · prv_findr · verified tier"
              requestPayload={'{\n  "query": "solana restaking risk",\n  "depth": 3\n}'}
              spentToday="$8.20 of $10.00"
              sessionSpend="$0.86"
              balanceAfter="$9.90"
              scopedLimit="$10"
              scopedToolName="deep_research (batch)"
              className="w-[380px]"
              onApprove={() => {}}
              onApproveScoped={() => {}}
              onDecline={() => {}}
            />
          </Spec>
          <Spec name="approval-card · disabled, overridden copy">
            <ApprovalCard
              title="Approve this call?"
              expiryLabel="Expires in 4 minutes"
              amount="$0.0100"
              toolName="search_web"
              context="agent prod · prv_searchly · verified tier"
              requestPayload={'{\n  "query": "solana restaking apy"\n}'}
              spentToday="$9.98 of $10.00"
              sessionSpend="$1.04"
              balanceAfter="$0.02"
              scopedLimit="$5"
              disabled
              className="w-[380px]"
            />
          </Spec>

          <Spec name="stage-list · all passed">
            <StageList checks={stageChecksPassed} className="min-w-[560px]" />
          </Spec>
          <Spec name="stage-list · stopped at a failure">
            <StageList checks={stageChecksFailed} className="min-w-[560px]" />
          </Spec>

          <Spec name="sampling-explainer · default">
            <SamplingExplainer rate="1 call in 125 at this price" className="w-[420px]" />
          </Spec>
          <Spec name="sampling-explainer · overridden copy">
            <SamplingExplainer
              rate="1 call in 8 at this price"
              body="This binding is new enough that we judge it more often while we learn its baseline quality."
              tail="The rate widens automatically as observedCalls accumulates."
              className="w-[420px]"
            />
          </Spec>

          <Spec name="timeline">
            <Timeline events={timelineEvents} className="min-w-[560px]" />
          </Spec>

          <Spec name="code-block · copyable">
            <CodeBlock title="tools/call" code={codeSampleA} className="w-[380px]" />
          </Spec>
          <Spec name="code-block · not copyable">
            <CodeBlock title="mcp.json" code={codeSampleB} copyable={false} className="w-[380px]" />
          </Spec>
        </Group>

        {/* ================================================================
         * 4. Structure
         * ============================================================== */}
        <Group index="04" title="Structure">
          <Spec name="panel · header, description, action">
            <Panel className="w-full max-w-[420px]">
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>Needs attention</PanelTitle>
                  <PanelDescription>3 bindings below minimum stake</PanelDescription>
                </PanelTitles>
                <PanelAction>
                  <IconButton icon={<EllipsisIcon className="h-4 w-4" />} aria-label="More actions" />
                </PanelAction>
              </PanelHeader>
              <PanelBody className="gap-0">
                {[
                  { tool: "search_web", amount: "$36.9000", variant: "degraded" as BadgeVariant },
                  { tool: "scrape_url", amount: "$14.2000", variant: "failed" as BadgeVariant },
                  { tool: "get_token_price", amount: "$9.4500", variant: "checking" as BadgeVariant },
                ].map((row) => (
                  <div key={row.tool} className="flex items-center justify-between gap-3 border-b border-01 px-5 py-3 last:border-b-0">
                    <span className="font-mono text-mono-13 text-01">{row.tool}</span>
                    <span className="font-mono text-mono-13 text-02">{row.amount}</span>
                    <Badge variant={row.variant} />
                  </div>
                ))}
              </PanelBody>
            </Panel>
          </Spec>
          <Spec name="panel · title only, nested empty-state">
            <Panel className="w-full max-w-[420px]">
              <PanelHeader>
                <PanelTitles>
                  <PanelTitle>Recent calls</PanelTitle>
                </PanelTitles>
              </PanelHeader>
              <PanelBody className="p-5">
                <EmptyState />
              </PanelBody>
            </Panel>
          </Spec>

          <Spec name="empty-state · default / custom">
            <EmptyState className="w-[360px]" />
            <EmptyState
              icon={<CompassIcon width={22} height={22} />}
              title="No providers match your filters"
              description="Try widening the price range or removing the verified-tier filter."
              className="w-[360px]"
            />
          </Spec>

          <Spec name="sheet · open, close button, footer">
            {/*
              Deliberately NOT defaultOpen. A Radix sheet renders a modal
              overlay over the whole document, so an open-by-default specimen
              blurs every other component on this page and makes the whole
              acceptance surface unreadable.
            */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary" size="sm">
                  Open withdraw sheet
                </Button>
              </SheetTrigger>
              <SheetContent showCloseButton>
                <SheetHeader>
                  <SheetTitle>Withdraw funds</SheetTitle>
                  <SheetDescription>Sent to an allowlisted destination only.</SheetDescription>
                </SheetHeader>
                <div className="flex flex-col gap-3 px-[18px] py-2">
                  <Field id="withdraw-amount" label="Amount" suffix="USDC" defaultValue="11.40" hint="Withdrawable $11.40" />
                </div>
                <SheetFooter>
                  <Button variant="primary">Confirm withdrawal</Button>
                  <SheetClose asChild>
                    <Button variant="ghost">Cancel</Button>
                  </SheetClose>
                </SheetFooter>
              </SheetContent>
            </Sheet>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="secondary">Open sheet (no close button)</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Decline this call</SheetTitle>
                  <SheetDescription>The agent decides what to do next; nothing else is stopped.</SheetDescription>
                </SheetHeader>
                <SheetFooter>
                  <Button variant="danger">Decline</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </Spec>
        </Group>

        {/* ================================================================
         * 5. Navigation and shell
         * ============================================================== */}
        <Group index="05" title="Navigation and shell">
          <Spec name="top-bar · default nav, alerts">
            <TopBar
              className="min-w-[900px]"
              activeNavId="activity"
              alertCount={3}
              onAlertsClick={() => {}}
              avatarName="Agent Prod"
            />
          </Spec>
          <Spec name="top-bar · zero alerts, custom search slot">
            <TopBar
              className="min-w-[900px]"
              activeNavId="controls"
              alertCount={0}
              avatarName="QA Runner"
              search={<Search placeholder="Receipt, ULID, tool or tx…" wrapperClassName="hidden w-[240px] desktop:flex" />}
            />
          </Spec>

          <Spec name="sidebar · desktop rail (visible ≥ 834px)">
            <Sidebar
              activeItemId="search_web"
              counts={{ inbox: 4, penalties: 2 }}
              bindings={sidebarBindings}
              className="h-[420px]"
            />
          </Spec>

          <Spec name="alert-badge · zero / default / overflow">
            <AlertBadge count={0} onClick={() => {}} />
            <AlertBadge count={2} onClick={() => {}} />
            <AlertBadge count={15} onClick={() => {}} />
          </Spec>

          <Spec name="public-top-bar">
            <PublicTopBar className="min-w-[900px]" onSignInClick={() => {}} onListToolClick={() => {}} />
          </Spec>
        </Group>

        {/* ================================================================
         * 6. Mobile
         * ============================================================== */}
        <Group index="06" title="Mobile">
          <Spec name="mobile-top-bar · default">
            <MobileTopBar title="Overview" subtitle="5 of 7 allowed" alertCount={2} className="w-full max-w-[390px]" onSearch={() => {}} onAlertsClick={() => {}} />
          </Spec>
          <Spec name="mobile-top-bar · minimal (no search, no alerts)">
            <MobileTopBar title="Receipt 4471-3310" showSearch={false} showAlerts={false} className="w-full max-w-[390px]" />
          </Spec>
          <Spec name="mobile-top-bar · zero alerts">
            <MobileTopBar title="Limits" subtitle="agent prod · policy v7" alertCount={0} className="w-full max-w-[390px]" />
          </Spec>

          <Spec name="bottom-tab-bar · active tab, badge, mixed href/onClick">
            <BottomTabBar
              active="money"
              onTabChange={() => {}}
              hrefs={{ overview: "#overview", activity: "#activity" }}
              badges={{ controls: true }}
              className="w-full max-w-[390px]"
            />
          </Spec>
        </Group>

        {/* ================================================================
         * 7. Balances, per chain
         * ============================================================== */}
        <Group index="07" title="Balances, per chain">
          {/*
            A two-chain BalanceCards, with DIFFERENT amounts on purpose.

            This is the only place a browser can read computed style off these
            cards without an API or a session: /kitchen-sink is static,
            unauthenticated and prerendered. `cn()` silently drops custom design
            tokens — invisible to tsc, to the CSS and to review — so a card whose
            colours are wrong looks perfect in every other gate.

            12.50 and 4.00 are deliberately unequal and deliberately not round:
            first-row, last-row and sum are three distinguishable answers, and
            $16.50 must appear nowhere on this page.
          */}
          <Spec name="balance-cards · two chains, no total">
            <section id="balance-cards" className="flex w-full flex-col gap-3">
              <BalanceCards
                emptyNote={{ kind: "none", text: "unused — this spec has two rows" }}
                chains={[
                  {
                    chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
                    namespace: "solana",
                    displayName: "Solana devnet",
                    explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
                    settlementAsset: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMM",
                    settlementAssetSymbol: "USDC",
                    decimals: 6,
                  },
                  {
                    chainId: "eip155:46630",
                    namespace: "eip155",
                    displayName: "Robinhood Chain testnet",
                    explorerBaseUrl: "https://testnet-explorer.example/",
                    settlementAsset: "eip155:46630/erc20:0xa0b8",
                    settlementAssetSymbol: "USDG",
                    decimals: 6,
                  },
                ]}
                balances={[
                  {
                    chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
                    accountId:
                      "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:AgentAccount1111111111111111111111111111111",
                    asset: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMM",
                    decimals: 6,
                    available: { amount: "12500000", asset: "solana:.../token:4zMM", decimals: 6 },
                    held: { amount: "300000", asset: "solana:.../token:4zMM", decimals: 6 },
                    /* Read: the chain answered, and this is what it said. */
                    withdrawable: { amount: "12200000", asset: "solana:.../token:4zMM", decimals: 6 },
                    chainReadable: true,
                  },
                  {
                    chainId: "eip155:46630",
                    accountId: "eip155:46630:0x83ab1234567890abcdef1234567890abcdef2913",
                    asset: "eip155:46630/erc20:0xa0b8",
                    decimals: 6,
                    available: { amount: "4000000", asset: "eip155:46630/erc20:0xa0b8", decimals: 6 },
                    held: { amount: "0", asset: "eip155:46630/erc20:0xa0b8", decimals: 6 },
                    /*
                      Unreadable, deliberately — the gallery is where the two
                      states are compared side by side. This card must never
                      look like the one above it with a smaller number.
                    */
                    withdrawable: null,
                    chainReadable: false,
                  },
                ]}
              />
            </section>
          </Spec>

          <Spec name="balance-cards · empty, the ABSENT state">
            {/* An array is always truthy; this is the branch that proves the
                component branches on `.length`. It must NOT read $0.00. */}
            <section id="balance-cards-empty" className="flex w-full flex-col gap-3">
              <BalanceCards
                chains={[]}
                balances={[]}
                emptyNote={{
                  kind: "none",
                  text: "No balance to read for this account. Add funds to open one.",
                }}
              />
            </section>
          </Spec>
        </Group>

        {/* ================================================================
         * 8. Patterns (components/patterns)
         * ============================================================== */}
        <Group index="08" title="Patterns">
          <PatternsGallery />
        </Group>
      </div>
    </div>
  );
}
