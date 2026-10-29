// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./use-protocol-analytics", () => ({
  useProtocolAnalytics: () => ({
    data: undefined,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

import { ProtocolAnalytics } from "./protocol-analytics";

afterEach(cleanup);

function expectEmptyDashboard(container: HTMLElement) {
  const figures = screen.getByRole("region", { name: "Headline figures" });
  expect(within(figures).getAllByText("—")).toHaveLength(6);
  expect(container.textContent).not.toMatch(
    /\$[\d,.]+|\d+(\.\d+)?%|0x[a-f0-9]+|Assay earned|sample|fictional|fixture|preview|undefined|NaN|Infinity|vs previous|Oct 27/i,
  );
  expect(container.querySelector("svg rect, svg path")).toBeNull();
}

describe("protocol analytics empty state", () => {
  it("keeps all sections and shows absent values without placeholder activity or notices", () => {
    const { container } = render(<ProtocolAnalytics />);
    expect(
      screen.getByRole("heading", {
        name: "Assay protocol analytics",
        level: 1,
      }),
    ).toBeDefined();
    for (const title of [
      "Revenue and volume",
      "Adoption",
      "Right now",
      "Top tools",
      "Latest payments",
      "How each number is counted",
    ]) {
      expect(
        screen.getByRole("heading", { name: title, level: 2 }),
      ).toBeDefined();
    }
    expectEmptyDashboard(container);
    expect(screen.getAllByRole("img")).toHaveLength(5);
    expect(
      screen
        .getAllByRole("img")
        .every((chart) =>
          chart.getAttribute("aria-label")?.includes("no data available"),
        ),
    ).toBe(true);
  });

  it("shows empty tables instead of fabricated tools and payments", () => {
    render(<ProtocolAnalytics />);
    for (const title of ["Top tools", "Latest payments"]) {
      const table = screen.getByRole("table", { name: title });
      expect(within(table).getByText("No data available.")).toBeDefined();
      expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
      expect(table.querySelectorAll("tbody tr td")).toHaveLength(1);
    }
    expect(screen.queryByText("web_search")).toBeNull();
    expect(screen.queryByText("Settled")).toBeNull();
    expect(screen.queryByText("Verifying")).toBeNull();
  });

  it("preserves missing values across every time range and metric", () => {
    const { container } = render(<ProtocolAnalytics />);
    for (const [range, description] of [
      ["7D", "Last 7 days"],
      ["30D", "Last 30 days"],
      ["90D", "Last 90 days"],
      ["All", "Since launch"],
    ]) {
      fireEvent.click(screen.getByRole("radio", { name: range }));
      expect(
        screen.getByRole("radio", { name: range }).getAttribute("aria-checked"),
      ).toBe("true");
      expect(
        screen.getByText(
          `${description} · UTC${range === "All" ? " · Charts: latest 90 days" : ""}`,
        ),
      ).toBeDefined();
      for (const metric of ["Revenue", "Volume", "Paid calls"]) {
        fireEvent.click(screen.getByRole("radio", { name: metric }));
        expect(
          screen.getByRole("img", {
            name: `${metric} per day: no data available`,
          }),
        ).toBeDefined();
        expectEmptyDashboard(container);
      }
    }
  });

  it("supports time-range selection with the keyboard", () => {
    render(<ProtocolAnalytics />);
    const selected = screen.getByRole("radio", { name: "30D" });
    selected.focus();
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    expect(
      screen.getByRole("radio", { name: "90D" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText("Last 90 days · UTC")).toBeDefined();
  });
});
