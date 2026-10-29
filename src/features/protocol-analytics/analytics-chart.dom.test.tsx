// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AnalyticsChart } from "./analytics-chart";

afterEach(cleanup);

function renderValues(values: (string | number | null)[], compact = false) {
  return render(
    <AnalyticsChart
      label="Revenue per day"
      compact={compact}
      values={values.map((value, index) => ({
        day: `2026-10-${27 + index}`,
        value,
      }))}
    />,
  );
}

describe("analytics chart scale", () => {
  it.each([false, true])(
    "makes sub-unit revenue visible with proportional bars (compact: %s)",
    (compact) => {
      const { container } = renderValues(["0.005", "0.002", "0"], compact);
      const bars = container.querySelectorAll("rect");

      expect(Number(bars[0].getAttribute("height"))).toBeCloseTo(170);
      expect(Number(bars[1].getAttribute("height"))).toBeCloseTo(68);
      expect(Number(bars[2].getAttribute("height"))).toBe(0);
      expect(bars[0].querySelector("title")?.textContent).toBe(
        "2026-10-27: 0.005",
      );
    },
  );

  it.each([
    ["0.000000000000000002", "0.000000000000000001"],
    ["18014398509481986", "9007199254740993"],
    [8, 4],
  ])("preserves relative heights for %s and %s", (maximum, half) => {
    const { container } = renderValues([maximum, half]);
    const bars = container.querySelectorAll("rect");

    expect(Number(bars[0].getAttribute("height"))).toBeCloseTo(170);
    expect(Number(bars[1].getAttribute("height"))).toBeCloseTo(85);
  });

  it("keeps all-zero charts finite and skips missing values", () => {
    const { container } = renderValues([0, null, "0"]);
    const bars = container.querySelectorAll("rect");

    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(Number(bar.getAttribute("y"))).toBe(182);
      expect(Number(bar.getAttribute("height"))).toBe(0);
    }
  });

  it.each([{ values: [] }, { values: [null, null] }])(
    "retains the no-data state for $values",
    ({ values }) => {
      const { container } = renderValues(values);

      expect(
        screen.getByRole("img", { name: "Revenue per day: no data available" }),
      ).toBeDefined();
      expect(container.querySelector("svg")).toBeNull();
    },
  );
});
