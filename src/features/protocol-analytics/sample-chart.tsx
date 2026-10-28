import {
  formatCount,
  formatMoney,
  formatPercent,
  formatSampleDate,
} from "./sample-analytics";

type Point = { day: string; value: number };

/** Self-contained SVG: no CDN, dynamic imports, or global DOM mutation. */
export function SampleChart({
  label,
  points,
  kind = "line",
  format = "count",
  compact = false,
}: {
  label: string;
  points: Point[];
  kind?: "line" | "bars";
  format?: "count" | "money" | "percent";
  compact?: boolean;
}) {
  const width = compact ? 320 : 640;
  const height = 220;
  const left = 60;
  const top = 16;
  const plotWidth = width - left - 12;
  const plotHeight = height - top - 34;
  const max =
    format === "percent"
      ? 1
      : Math.max(...points.map((point) => point.value), 1) * 1.12;
  const min =
    format === "percent"
      ? Math.max(0, Math.min(...points.map((point) => point.value)) - 0.025)
      : 0;
  const formatValue =
    format === "money"
      ? formatMoney
      : format === "percent"
        ? formatPercent
        : formatCount;
  const x = (index: number) =>
    left + ((index + 0.5) * plotWidth) / points.length;
  const y = (value: number) =>
    top + plotHeight * (1 - (value - min) / (max - min));
  const path = points
    .map((point, index) => `${index ? "L" : "M"}${x(index)},${y(point.value)}`)
    .join(" ");
  const tickIndices = [
    0,
    Math.floor((points.length - 1) / 2),
    points.length - 1,
  ];

  return (
    <div className="min-w-0">
      <svg
        role="img"
        aria-label={`${label} (sample data)`}
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full overflow-visible text-body-xs"
      >
        <title>{label} — fictional sample data</title>
        {[0, 1, 2, 3, 4].map((tick) => {
          const value = min + ((max - min) * tick) / 4;
          return (
            <g key={tick}>
              <line
                x1={left}
                x2={width - 12}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--border-01)"
              />
              <text
                x={left - 8}
                y={y(value) + 4}
                textAnchor="end"
                fill="var(--text-03)"
              >
                {formatValue(value)}
              </text>
            </g>
          );
        })}
        {kind === "bars" ? (
          points.map((point, index) => (
            <rect
              key={point.day}
              x={x(index) - (plotWidth / points.length) * 0.35}
              y={y(point.value)}
              width={(plotWidth / points.length) * 0.7}
              height={top + plotHeight - y(point.value)}
              rx={2}
              fill="var(--chart-1)"
            >
              <title>
                {formatSampleDate(point.day)}: {formatValue(point.value)}{" "}
                (sample)
              </title>
            </rect>
          ))
        ) : (
          <path
            d={path}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        )}
        {tickIndices.map((index) => (
          <text
            key={index}
            x={x(index)}
            y={height - 6}
            textAnchor="middle"
            fill="var(--text-03)"
          >
            {new Intl.DateTimeFormat("en-US", {
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            }).format(new Date(`${points[index].day}T00:00:00Z`))}
          </text>
        ))}
      </svg>
    </div>
  );
}
