"use client";

import { useId, useState } from "react";

import { AnalyticsDecimal as Decimal } from "./analytics-format";

/** Money is normalised with Decimal; Number is used only for SVG coordinates. */
export function AnalyticsChart({
  label,
  values,
  compact = false,
  unit,
}: {
  label: string;
  values: { day: string; value: string | number | null }[];
  compact?: boolean;
  unit?: string;
}) {
  const tooltipId = useId();
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const focusIndex = Math.max(0, values.findIndex((row) => row.day === activeDay));
  const active = values.find((row) => row.day === activeDay);
  const describe = (value: string | number | null) =>
    value === null ? "No data available" : `${value}${unit ? ` ${unit}` : ""}`;
  if (!values.length || values.every((row) => row.value === null))
    return (
      <div
        role="img"
        aria-label={`${label}: no data available`}
        className="flex min-h-48 items-center justify-center rounded-md border border-01 bg-02 font-mono text-03"
      >
        —
      </div>
    );
  const width = compact ? 320 : 640;
  const height = 220;
  const left = 12;
  const plotWidth = width - 24;
  const plotHeight = 170;
  const max = Decimal.max(
    0,
    ...values.map((row) => new Decimal(row.value ?? 0)),
  );
  const scaleMax = max.isZero() ? new Decimal(1) : max;
  const x = (index: number) =>
    left + ((index + 0.5) * plotWidth) / values.length;
  const y = (value: string | number) =>
    12 + plotHeight * (1 - new Decimal(value).div(scaleMax).toNumber());
  return (
    <div className="relative min-w-0" role="group" aria-label={`${label} details`}>
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full text-body-xs"
      >
        <title>{label}</title>
        {[0, 1, 2, 3].map((line) => (
          <line
            key={line}
            x1={left}
            x2={width - left}
            y1={12 + (line * plotHeight) / 3}
            y2={12 + (line * plotHeight) / 3}
            stroke="var(--border-01)"
          />
        ))}
        {values.map((row, index) =>
          row.value === null ? null : (
            <rect
              key={row.day}
              x={x(index) - (plotWidth / values.length) * 0.35}
              y={y(row.value)}
              width={(plotWidth / values.length) * 0.7}
              height={Math.max(0, 182 - y(row.value))}
              rx={2}
              fill="var(--chart-1)"
            >
              <title>
                {row.day}: {row.value}
              </title>
            </rect>
          ),
        )}
        <g aria-hidden="true">
          {values.map((row, index) => (
            <rect
              key={row.day}
              x={left + (index * plotWidth) / values.length}
              y={12}
              width={plotWidth / values.length}
              height={plotHeight}
              fill="transparent"
              stroke={activeDay === row.day ? "var(--chart-1)" : "none"}
              strokeDasharray="3 3"
              onPointerEnter={() => setActiveDay(row.day)}
              onPointerLeave={(event) => {
                if (event.pointerType !== "touch") setActiveDay(null);
              }}
              onPointerDown={() => setActiveDay(row.day)}
            />
          ))}
        </g>
        {[
          ...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1]),
        ].map((index) => (
          <text
            key={index}
            x={x(index)}
            y={210}
            textAnchor="middle"
            fill="var(--text-03)"
          >
            {values[index].day.slice(5)}
          </text>
        ))}
      </svg>
      <div>
        {values.map((row, index) => (
          <button
            key={row.day}
            type="button"
            tabIndex={index === focusIndex ? 0 : -1}
            aria-label={`${row.day}: ${describe(row.value)}`}
            aria-describedby={activeDay === row.day ? tooltipId : undefined}
            className="sr-only focus:not-sr-only focus:absolute focus:bottom-0 focus:left-0 focus:rounded-md focus:border focus:border-01 focus:bg-02 focus:px-2 focus:py-1 focus:text-body-xs focus:text-01"
            onFocus={() => setActiveDay(row.day)}
            onBlur={() => setActiveDay(null)}
            onClick={() => setActiveDay(row.day)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setActiveDay(null);
              const offset = event.key === "ArrowRight" ? 1
                : event.key === "ArrowLeft" ? -1 : 0;
              if (offset || event.key === "Home" || event.key === "End") {
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End"
                  ? values.length - 1 : (index + offset + values.length) % values.length;
                event.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus();
              }
            }}
          >
            {row.day}: {describe(row.value)}
          </button>
        ))}
      </div>
      {active ? (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute right-3 top-3 rounded-md border border-01 bg-02 px-3 py-2 text-body-xs text-01 shadow-sm"
        >
          <p>{active.day} · UTC</p>
          <p>{label}: {describe(active.value)}</p>
        </div>
      ) : null}
    </div>
  );
}
