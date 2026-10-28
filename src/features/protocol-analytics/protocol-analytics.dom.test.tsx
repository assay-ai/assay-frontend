// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ProtocolAnalytics } from "./protocol-analytics";

afterEach(cleanup);

describe("protocol analytics sample", () => {
  it("identifies fictional figures and renders the supplied sample payments", () => {
    render(<ProtocolAnalytics />);
    expect(screen.getByText("Sample data.")).toBeDefined();
    expect(
      screen.getByText(/These are not Assay’s real figures/),
    ).toBeDefined();
    const figures = screen.getByRole("region", { name: "Headline figures" });
    expect(within(figures).getByText("$2,498")).toBeDefined();
    expect(within(figures).getByText("8,223")).toBeDefined();
    expect(
      screen
        .getByRole("table", { name: /Top tools/ })
        .querySelectorAll("tbody tr"),
    ).toHaveLength(12);
    expect(
      screen
        .getByRole("table", { name: /Latest payments/ })
        .querySelectorAll("tbody tr"),
    ).toHaveLength(12);
  });

  it("updates the range and metric and handles All without a previous period", () => {
    const { container } = render(<ProtocolAnalytics />);
    fireEvent.click(screen.getByRole("radio", { name: "7D" }));
    expect(
      screen.getByRole("radio", { name: "7D" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByText("Last 7 days · to Oct 27, 2026 · UTC · Sample"),
    ).toBeDefined();
    expect(
      within(
        screen.getByRole("region", { name: "Headline figures" }),
      ).getByText("$658.00"),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("radio", { name: "Volume" }));
    expect(
      screen.getByRole("img", { name: "Volume per day (sample data)" }),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(
      screen.getByText("Since launch · to Oct 27, 2026 · UTC · Sample"),
    ).toBeDefined();
    expect(container.textContent).not.toMatch(/undefined|vs previous/);
  });

  it("sorts the sample tools and reports the sorting direction", () => {
    render(<ProtocolAnalytics />);
    const table = screen.getByRole("table", { name: /Top tools/ });
    const firstTool = () => table.querySelector("tbody tr td")!.textContent;
    expect(firstTool()).toBe("web_search");
    fireEvent.click(within(table).getByRole("button", { name: /^Tool$/ }));
    expect(firstTool()).toBe("code_review");
    expect(
      within(table)
        .getByRole("columnheader", { name: /Tool/ })
        .getAttribute("aria-sort"),
    ).toBe("ascending");
    fireEvent.click(within(table).getByRole("button", { name: "Tool ▲" }));
    expect(firstTool()).toBe("web_search");
  });

  it("supports selecting the time range with the keyboard", () => {
    render(<ProtocolAnalytics />);
    const selected = screen.getByRole("radio", { name: "30D" });
    selected.focus();
    fireEvent.keyDown(selected, { key: "ArrowRight" });
    expect(
      screen.getByRole("radio", { name: "90D" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen.getByText("Last 90 days · to Oct 27, 2026 · UTC · Sample"),
    ).toBeDefined();
  });
});
