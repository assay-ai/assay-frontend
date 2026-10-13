"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bookmark, FlaskConical } from "lucide-react";
import * as React from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { getToolBinding } from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";
import { presentVerdict } from "@/utils/verdict";
import { labelForEndpoint } from "@/utils/provider-label";

/**
 * Corpus backtest.
 *
 * ## There is no backtest endpoint
 *
 * The whole surface is drawn against a resource that does not exist. There is
 * no `backtest` route, service, table, DTO or job anywhere in the backend —
 * the backend has no backtest code, and the OpenAPI document lists 31
 * provider paths, none of which produces a corpus run. Backtest jobs are not
 * built yet. So
 * the screen is built to the design and every figure on it is `null`.
 *
 * The nearest real thing is `binding_test_runs` — the mapping tester's own
 * rows — but a tester run is one call against one input and a backtest is a
 * distribution over a recorded corpus with a pinned policy version. Folding
 * the first into the second would put a number under "Implied failure rate"
 * that no corpus supports, which is the exact failure the note at the bottom
 * of this screen warns about.
 *
 * ## The chart is the point, and it has no data
 *
 * The console's reason to exist here is that *"the verdict distribution is a chart, not a log line"*.
 * The design realises that as four counters over two horizontal bar lists —
 * **not** as `StackedBarChart` or `Donut`; both were read
 * and neither is referenced by the design. `StackedBarChart` is a time series
 * (day buckets on the x axis) and this is a category breakdown with no time
 * axis; `Donut` shows parts of one whole, and "failures by rule" overlaps —
 * The design's own subtitle says so: *"rules overlap; 21 distinct cases"* —
 * so the slices would sum past 100%. `BarList` below is the design's own row
 * geometry, and it renders from data the moment backtest jobs land.
 *
 * ## Verdicts
 *
 * The design labels the three counters `PASS`, `FAIL` and `DEGRADED` — raw
 * verdict tokens, which Foundations rule 03 forbids on screen. Rule 03 wins:
 * the labels come from `presentVerdict()`.
 */

// ── The shape a backtest job would return ────────────────────────────────────────────

/**
 * Typed so the render path is real rather than decorative: every section
 * below reads this and shows its empty treatment when it is `null`. It is
 * always `null` today, and there is deliberately no fetch behind it — an
 * invented endpoint would 404 in the network panel and read as a bug.
 */
interface BacktestRun {
  caseCount: number;
  policyVersion: number;
  ranAt: string;
  durationSeconds: number;
  /** Keyed by wire verdict, e.g. `{ PASS: 599, FAIL: 21 }`. */
  counts: Record<string, number>;
  impliedFailureRate: string;
  confidenceInterval: string;
  failuresByRule: BarDatum[];
  failuresByInputShape: BarDatum[];
  worstCases: WorstCase[];
}

interface BarDatum {
  label: string;
  value: number;
}

interface WorstCase {
  id: string;
  input: string;
  score: string;
  reason: string;
}

/** The one glyph for "we do not know", as opposed to a measured zero. */
const UNKNOWN = "—";

// ── Bars ───────────────────────────────────────────────

/**
 * The design's bar row: a 180px mono key, a 44px right-aligned count, then a
 * 9px track at radius 3 whose fill is `$danger-500` for rules and
 * `$warning-500` for input shapes. The fill width in the file is drawn as a
 * literal pixel split ("Fill" + a transparent "Rest"), which is illustrative
 * — here it is the value over the largest value in the list, so the longest
 * bar is full width exactly as drawn.
 */
function BarList({ data, tone }: { data: BarDatum[]; tone: "danger" | "warning" }) {
  const max = data.reduce((highest, row) => Math.max(highest, row.value), 0) || 1;

  return (
    <div className="flex w-full flex-col gap-[9px]">
      {data.map((row) => (
        <div key={row.label} className="flex w-full items-center gap-3">
          <span className="w-[180px] shrink-0 truncate font-mono text-mono-12 text-02">
            {row.label}
          </span>
          <span className="w-11 shrink-0 text-right font-mono text-mono-13 font-semibold text-01">
            {row.value}
          </span>
          <span className="h-[9px] min-w-0 flex-1 overflow-hidden rounded-[3px] bg-03">
            <span
              className={cn(
                "block h-[9px] rounded-[3px]",
                tone === "danger" ? "bg-danger-500" : "bg-warning-500"
              )}
              style={{ width: `${(row.value / max) * 100}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Summary strip ────────────────────────────────────────────────

function SummaryCell({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
      {/* The design's key is one short word (`PASS`). Rule 03 replaces it with
          a whole sentence, which wraps to three lines at this column width and
          would push each figure to a different baseline — so the key reserves
          three lines and the four figures stay on one line, which is the
          property that makes a counter strip readable. */}
      <p className="min-h-[48px] text-body-xs text-03">{label}</p>
      <p className={cn("font-mono text-mono-xl", valueClassName ?? "text-01")}>{value}</p>
      <p className="font-mono text-mono-xs text-03">{sub}</p>
    </div>
  );
}

// ── Worst cases ──────────────────────────────────────────────────

function WorstCasesTable({ rows }: { rows: WorstCase[] }) {
  return (
    <div className="flex w-full min-w-[720px] flex-col">
      <div className="flex w-full gap-3 border-b border-02 px-3 pb-[9px]">
        <span className="min-w-0 flex-1 font-mono text-mono-2xs tracking-[1.1px] text-03">Case</span>
        <span className="w-[380px] shrink-0 text-right font-mono text-mono-2xs tracking-[1.1px] text-03">
          Input
        </span>
        <span className="w-[100px] shrink-0 text-right font-mono text-mono-2xs tracking-[1.1px] text-03">
          Score
        </span>
        <span className="w-[260px] shrink-0 text-right font-mono text-mono-2xs tracking-[1.1px] text-03">
          Reason
        </span>
      </div>
      {rows.map((row) => (
        <div key={row.id} className="flex w-full items-center gap-3 border-b border-01 px-3 py-[11px]">
          <span className="min-w-0 flex-1 truncate font-mono text-mono-13 font-semibold text-01">
            {row.id}
          </span>
          <span className="w-[380px] shrink-0 truncate text-right font-mono text-mono-13 text-02">
            {row.input}
          </span>
          <span className="w-[100px] shrink-0 text-right font-mono text-mono-13 text-02">
            {row.score}
          </span>
          <span className="w-[260px] shrink-0 truncate text-right font-mono text-mono-13 text-02">
            {row.reason}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────

/**
 * The missing half of this screen, in one function.
 *
 * Backtest jobs are not built, so there is nothing to call and this
 * returns `null` on every render. It is a function rather than a `null`
 * constant so the sections below keep their real, typed render path instead of
 * being narrowed away — when the endpoint lands, this body becomes the fetch
 * and nothing else on the screen changes.
 */
function loadBacktestRun(): BacktestRun | null {
  return null;
}

/** The rail labels a binding by its endpoint host; the page header agrees. */

export function BacktestView({ bindingId }: { bindingId: string }) {
  // The binding itself IS real — it is the only part of this screen the API
  // can answer, and it is what makes the header name the right binding rather
  // than the design's `bnd_7QK`.
  const binding = useQuery({
    queryKey: ["provider", "tool-binding", bindingId],
    queryFn: () => getToolBinding(bindingId),
  });

  const run = loadBacktestRun();

  const identity = binding.data ? labelForEndpoint(binding.data.endpoint) : UNKNOWN;
  const title = run
    ? `Backtest · ${identity} · ${run.caseCount} cases · policy v${run.policyVersion}`
    : `Backtest · ${identity}`;

  // Design sub: "ran 2026-08-09 12:41 · 47s · run it in CI, read it here"
  // The tail is verbatim; the leading facts belong to a run.
  const subtitle = run
    ? `ran ${run.ranAt} · ${run.durationSeconds}s · run it in CI, read it here`
    : "no run · run it in CI, read it here";

  const pass = presentVerdict("PASS");
  const fail = presentVerdict("FAIL");
  const degraded = presentVerdict("DEGRADED");

  function share(verdict: string): string {
    if (!run) return UNKNOWN;
    const total = Object.values(run.counts).reduce((sum, count) => sum + count, 0);
    if (total === 0) return UNKNOWN;
    return `${(((run.counts[verdict] ?? 0) / total) * 100).toFixed(1)}%`;
  }

  function count(verdict: string): string {
    return run ? String(run.counts[verdict] ?? 0) : UNKNOWN;
  }

  return (
    <>
      {/* Page Header. */}
      <div className="flex w-full flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 basis-[16rem] flex-col gap-0.5">
          {/* 23px/600/-0.5 in the design; `heading-md` (24px) is the nearest step. */}
          <h1 className="break-all text-heading-md text-01 tablet:truncate">{title}</h1>
          <p className="break-words font-mono text-mono-12 text-03">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Both actions act on a run. With no run there is nothing to save
              and nothing to carry into the workbench, so both are disabled
              rather than wired to a route that would receive nothing. */}
          <Button variant="secondary" icon={<Bookmark aria-hidden="true" />} disabled={!run}>
            Save all as golden set
          </Button>
          <Button icon={<ArrowRight aria-hidden="true" />} disabled={!run}>
            Use in SLA workbench
          </Button>
        </div>
      </div>

      {/* Ours, not the design's: the design has no state for "the feature has
          no backend". Saying it once at the top is what stops every "—" below
          reading as a broken counter. */}
      {run ? null : (
        <Banner
          tone="primary"
          title="No backtest has run against this binding"
          description="Backtests are not available yet. Use the mapping tester to run one case at a time against your endpoint."
        />
      )}

      {/* Summary. */}
      <div className="flex w-full items-center gap-10 rounded-xl border border-01 bg-01 px-6 py-5">
        <SummaryCell
          label={pass.shownAs}
          value={count("PASS")}
          sub={share("PASS")}
          valueClassName={run ? "text-success-600" : "text-03"}
        />
        <SummaryCell
          label={fail.shownAs}
          value={count("FAIL")}
          sub={share("FAIL")}
          valueClassName={run ? "text-danger-600" : "text-03"}
        />
        <SummaryCell
          label={degraded.shownAs}
          value={count("DEGRADED")}
          sub={run ? "never fails a response" : UNKNOWN}
          valueClassName={run ? "text-01" : "text-03"}
        />
        <SummaryCell
          label="Implied failure rate"
          value={run ? run.impliedFailureRate : UNKNOWN}
          sub={run ? run.confidenceInterval : UNKNOWN}
          valueClassName={run ? "text-01" : "text-03"}
        />
      </div>

      {/* Row. */}
      <div className="flex w-full flex-col gap-4 tablet:flex-row">
        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Failures by rule</PanelTitle>
              <PanelDescription>
                {run ? `rules overlap; ${count("FAIL")} distinct cases` : "rules overlap"}
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3.5 p-5">
            {run ? (
              <BarList data={run.failuresByRule} tone="danger" />
            ) : (
              <EmptyState
                className="max-w-none"
                icon={<FlaskConical width={22} height={22} />}
                title="No rule breakdown"
                description="A rule breakdown needs a corpus run. Nothing has produced one."
              />
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Failures by input shape</PanelTitle>
              <PanelDescription>
                the awkward queries are the ones that fail in production
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3.5 p-5">
            {run ? (
              <BarList data={run.failuresByInputShape} tone="warning" />
            ) : (
              <EmptyState
                className="max-w-none"
                icon={<FlaskConical width={22} height={22} />}
                title="No input-shape breakdown"
                description="Grouping inputs needs a recorded corpus. Nothing has produced one."
              />
            )}
          </PanelBody>
        </Panel>
      </div>

      {/* Worst cases first. */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Worst cases first</PanelTitle>
            <PanelDescription>
              open any of them in the tester with the same policy pinned
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          {run ? (
            <div className="w-full overflow-x-auto">
              <WorstCasesTable rows={run.worstCases} />
            </div>
          ) : (
            <EmptyState
              className="m-2.5 max-w-none"
              icon={<FlaskConical width={22} height={22} />}
              title="No cases to rank"
              description="The worst cases of a backtest run are listed here. Backtests are not available yet."
            />
          )}
        </PanelBody>
      </Panel>

      {/* Note. Copy verbatim. */}
      <div
        role="note"
        className="flex w-full items-start gap-2.5 rounded-lg border border-primary-20 bg-primary-10 p-[15px]"
      >
        <FlaskConical
          width={15}
          height={15}
          aria-hidden="true"
          className="mt-[3px] shrink-0 text-primary-600"
        />
        <p className="min-w-0 flex-1 text-body-13 leading-[1.6] text-primary-700">
          A provider who can backtest will list with a defensible SLA; one who cannot will guess,
          and a guess is what produces the first unnecessary dispute.
        </p>
      </div>
    </>
  );
}
