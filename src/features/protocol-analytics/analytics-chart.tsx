import { AnalyticsDecimal as Decimal } from "./analytics-format";

/** Money is normalised with Decimal; Number is used only for SVG coordinates. */
export function AnalyticsChart({
  label,
  values,
  compact = false,
}: {
  label: string;
  values: { day: string; value: string | number | null }[];
  compact?: boolean;
}) {
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
    1,
    ...values.map((row) => new Decimal(row.value ?? 0)),
  );
  const x = (index: number) =>
    left + ((index + 0.5) * plotWidth) / values.length;
  const y = (value: string | number) =>
    12 + plotHeight * (1 - new Decimal(value).div(max).toNumber());
  return (
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
  );
}
