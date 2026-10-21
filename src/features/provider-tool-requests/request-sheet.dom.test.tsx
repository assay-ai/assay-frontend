// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolRequestSheet } from "./request-sheet";

vi.mock("@/services/provider-tool-requests.service", () => ({ createToolRequest: vi.fn() }));

afterEach(cleanup);

function open() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ToolRequestSheet open onOpenChange={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("Request a tool sheet (BUG-NF-07)", () => {
  it("names each empty field, ties the message to the input and focuses the first", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));

    const name = document.getElementById("tool-request-name") as HTMLInputElement;
    const returns = document.getElementById("tool-request-returns") as HTMLInputElement;
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(returns.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(name.getAttribute("aria-describedby")!)?.textContent).toBe("Give the tool a name.");
    expect(document.getElementById(returns.getAttribute("aria-describedby")!)?.textContent).toBe("Say what it returns.");
    expect(document.activeElement).toBe(name);
  });

  it("clears a field's error as soon as it is edited", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    const name = document.getElementById("tool-request-name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Weather now" } });
    expect(name.getAttribute("aria-invalid")).toBeNull();
    expect((document.getElementById("tool-request-returns") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
  });
});
