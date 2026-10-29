// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      const bars = container.querySelectorAll('rect:not([fill="transparent"])');

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
    const bars = container.querySelectorAll('rect:not([fill="transparent"])');

    expect(Number(bars[0].getAttribute("height"))).toBeCloseTo(170);
    expect(Number(bars[1].getAttribute("height"))).toBeCloseTo(85);
  });

  it("keeps all-zero charts finite and skips missing values", () => {
    const { container } = renderValues([0, null, "0"]);
    const bars = container.querySelectorAll('rect:not([fill="transparent"])');

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


describe("analytics chart details", () => {
  it("shows zero-value days from a full-height pointer target", () => {
    const { container } = renderValues(["0.005", 0]);
    const targets = container.querySelectorAll('rect[fill="transparent"]');
    expect(targets).toHaveLength(2);
    expect(targets[1].getAttribute("height")).toBe("170");
    fireEvent.pointerEnter(targets[1]);
    expect(screen.getByRole("tooltip").textContent).toContain("2026-10-28 · UTC");
    expect(screen.getByRole("tooltip").textContent).toContain("Revenue per day: 0");
    fireEvent.pointerLeave(targets[1]);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("supports keyboard focus, Escape and touch selection with exact units", () => {
    const { container } = render(
      <AnalyticsChart label="Revenue per day" unit="USDG" values={[
        { day: "2026-10-29", value: "0.000001" },
        { day: "2026-10-30", value: null },
      ]} />,
    );
    const day = screen.getByRole("button", { name: "2026-10-29: 0.000001 USDG" });
    fireEvent.focus(day);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("0.000001 USDG");
    expect(day.getAttribute("aria-describedby")).toBe(tooltip.id);
    day.focus();
    fireEvent.keyDown(day, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toBe("2026-10-30: No data available");
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(day);
    fireEvent.keyDown(day, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerDown(container.querySelector('rect[fill="transparent"]')!);
    expect(screen.getByRole("tooltip").textContent).toContain("0.000001 USDG");
    fireEvent.focus(screen.getByRole("button", { name: "2026-10-30: No data available" }));
    expect(screen.getByRole("tooltip").textContent).toContain("No data available");
    fireEvent.blur(day);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("drops stale details when the selected day leaves the data set", () => {
    const { rerender } = renderValues([1]);
    fireEvent.focus(screen.getByRole("button", { name: "2026-10-27: 1" }));
    rerender(<AnalyticsChart label="Revenue per day" values={[{ day: "2026-11-01", value: 2 }]} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
