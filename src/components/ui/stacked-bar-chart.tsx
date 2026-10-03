import * as React from "react";

import { cn } from "@/utils";

/**
 * Stacked Bar Chart.
 *
 * Spend per day, split by tool. Built from elements rather than SVG because the
 * design's bars are exactly that: a bottom-aligned stack with a 2px gap and a
 * 3px radius on the top segment only, which reflows correctly at every width
 * without a viewBox to recompute.
 *
 * The design's breakpoint rules are explicit about the mobile rule: the
 * 7-day bars stay, the legend wraps underneath, and the series are capped at
 * three plus "other". `maxSeries` implements the cap; the rest is layout.
 */

export interface ChartSeries {
  key: string;
  label: string;
  /** 1-6, matching the design's chart tokens. 6 is reserved for "other". */
  tone: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface ChartBar {
  /** X-axis label, e.g. "Aug 4". */
  label: string;
  /** Value per series key. Missing keys count as zero. */
  values: Record<string, number>;
}

export interface StackedBarChartProps extends React.HTMLAttributes<HTMLDivElement> {
  series: ChartSeries[];
  bars: ChartBar[];
  /** Y-axis tick labels, top value first. */
  ticks: string[];
  /** Highest value the Y axis represents — the scale the bars are drawn against. */
  scaleMax: number;
  /** Plot height in px, excluding the x-axis labels. Design draws 187. */
  plotHeight?: number;
  /** Accessible description of what the chart shows. */
  caption: string;
}

const toneClass: Record<ChartSeries["tone"], string> = {
  1: "bg-chart-1",
  2: "bg-chart-2",
  3: "bg-chart-3",
  4: "bg-chart-4",
  5: "bg-chart-5",
  6: "bg-chart-6",
};

export function StackedBarChart({
  series,
  bars,
  ticks,
  scaleMax,
  plotHeight = 187,
  caption,
  className,
  ...props
}: StackedBarChartProps) {
  const safeMax = scaleMax > 0 ? scaleMax : 1;

  return (
    <figure className={cn("flex w-full flex-col gap-[14px]", className)} {...props}>
      <figcaption className="sr-only">{caption}</figcaption>

      <div className="flex w-full gap-[14px]">
        <div
          className="flex w-9 shrink-0 flex-col justify-between text-right"
          style={{ height: plotHeight + 23 }}
          aria-hidden="true"
        >
          {ticks.map((t) => (
            <span key={t} className="font-mono text-mono-xs text-03">
              {t}
            </span>
          ))}
        </div>

        <div className="flex min-w-0 flex-1 items-end justify-between gap-2">
          {bars.map((bar) => {
            const stack = series
              .map((s) => ({ s, v: bar.values[s.key] ?? 0 }))
              .filter((e) => e.v > 0);

            return (
              <div key={bar.label} className="flex min-w-0 flex-1 flex-col gap-2">
                <div
                  className="flex w-full flex-col justify-end gap-[2px]"
                  style={{ height: plotHeight }}
                >
                  {stack.map((e, i) => (
                    <span
                      key={e.s.key}
                      title={`${e.s.label}: ${e.v}`}
                      className={cn(
                        "w-full",
                        toneClass[e.s.tone],
                        i === 0 && "rounded-t-[3px]",
                      )}
                      style={{ height: `${(e.v / safeMax) * plotHeight}px` }}
                    />
                  ))}
                </div>
                <span className="truncate text-center font-mono text-mono-xs text-03">
                  {bar.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-[7px]">
            <span
              aria-hidden="true"
              className={cn("h-[10px] w-[10px] shrink-0 rounded-[2px]", toneClass[s.tone])}
            />
            <span className="font-mono text-mono-xs text-02">{s.label}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * Collapses a series list to the design's mobile cap: the top `keep` by total
 * value, plus everything else folded into a single "other (n)" series on
 * chart-6. Returns new series and bars — it does not mutate the inputs.
 */
export function capSeries(
  series: ChartSeries[],
  bars: ChartBar[],
  keep = 3,
): { series: ChartSeries[]; bars: ChartBar[] } {
  if (series.length <= keep + 1) return { series, bars };

  const totals = new Map(
    series.map((s) => [s.key, bars.reduce((sum, b) => sum + (b.values[s.key] ?? 0), 0)]),
  );
  const ranked = [...series].sort((a, b) => (totals.get(b.key) ?? 0) - (totals.get(a.key) ?? 0));
  const kept = ranked.slice(0, keep);
  const folded = ranked.slice(keep);

  return {
    series: [...kept, { key: "__other", label: `other (${folded.length})`, tone: 6 }],
    bars: bars.map((b) => ({
      label: b.label,
      values: {
        ...Object.fromEntries(kept.map((s) => [s.key, b.values[s.key] ?? 0])),
        __other: folded.reduce((sum, s) => sum + (b.values[s.key] ?? 0), 0),
      },
    })),
  };
}
