// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

/* `/explorer/call/<id>`: one call on the public explorer, by status, and only its own fields. */
const ID = "6f1c2a7e-0000-4000-8000-000000000001";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined, prefetch: () => undefined }),
  usePathname: () => `/explorer/call/${ID}`,
  useSearchParams: () => new URLSearchParams(),
}));
const get = vi.fn();
vi.mock("@/services/public-api", () => ({
  publicApi: { get: (...args: unknown[]) => get(...args) },
}));

import PublicReceiptPage from "./page";

const money = (amount: string) => ({ amount, asset: "eip155:4663/erc20:0x1", decimals: 6 });

function wire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "CHARGED",
    tool: { id: "tool-1", name: "weather.now" },
    provider: { id: "prov-1", name: "Acme Data" },
    listedPrice: money("20000"),
    chargedPrice: money("20000"),
    notCharged: null,
    stages: [
      { stage: "SCHEMA", status: "PASSED", label: "passed" },
      { stage: "DETERMINISTIC_RULES", status: "PASSED", label: "passed" },
      { stage: "CROSS_CHECK", status: "NOT_APPLICABLE", label: "not applicable" },
      { stage: "SEMANTIC", status: "SKIPPED", label: "not sampled" },
    ],
    sampling: "1 in 125 calls at this price",
    createdAt: "2026-10-29T10:15:00.000Z",
    settledAt: "2026-10-29T10:16:00.000Z",
    ...over,
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PublicReceiptPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  get.mockReset();
});

describe("public receipt page", () => {
  it.each([
    ["IN_PROGRESS", "Being checked"],
    ["CHARGED", "Charged"],
    ["NOT_CHARGED", "Not charged"],
    ["CLOSED", "Closed"],
  ])("%s → its own headline", async (status, headline) => {
    get.mockResolvedValue(wire({ status }));
    mount();
    expect((await screen.findByRole("heading", { level: 2, name: headline })).textContent).toBe(headline);
    expect(get).toHaveBeenCalledWith(`/public/explorer/calls/${ID}`);
    expect(screen.getAllByTestId("public-stage")).toHaveLength(4);
  });

  it("names the tool and provider, and links their public pages", async () => {
    get.mockResolvedValue(wire());
    mount();
    const tool = await screen.findByRole("link", { name: "weather.now" });
    expect(tool.getAttribute("href")).toBe("/catalogue/view?tool=tool-1");
    expect(tool.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "Acme Data" }).getAttribute("href")).toBe("/catalogue/provider?id=prov-1");
    expect(screen.getByTestId("public-sampling").textContent).toContain("1 in 125 calls at this price");
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("says 'a tool' and links nothing when the provider is not listed", async () => {
    get.mockResolvedValue(
      wire({
        status: "NOT_CHARGED",
        tool: null,
        provider: null,
        chargedPrice: money("0"),
        notCharged: { reason: "FAILED_CHECKS", text: "The result failed a check, so nothing was charged." },
      }),
    );
    mount();
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("A call to a tool");
    expect(screen.getByText("The result failed a check, so nothing was charged.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /weather|Acme/ })).toBeNull();
    expect(document.body.textContent).not.toContain("Served by");
  });

  it("one neutral state for a 404", async () => {
    get.mockRejectedValue(new ApiError("NOT_FOUND", "Not found", 404));
    mount();
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("This receipt is not available");
    expect(document.body.textContent?.toLowerCase()).not.toContain("hidden");
  });

  it("never renders a key the page does not know", async () => {
    get.mockResolvedValue(
      wire({
        walletAddress: "CANARY_WALLET_0x1234",
        tool: { id: "tool-1", name: "weather.now", note: "CANARY_TOOL_NOTE" },
        stages: [
          { stage: "SCHEMA", status: "FAILED", label: "failed", detail: "CANARY_STAGE_DETAIL" },
          { stage: "DETERMINISTIC_RULES", status: "NOT_REACHED", label: "not reached" },
          { stage: "CROSS_CHECK", status: "NOT_REACHED", label: "not reached" },
          { stage: "SEMANTIC", status: "NOT_REACHED", label: "not reached" },
        ],
      }),
    );
    const { container } = mount();
    await screen.findByRole("heading", { level: 2, name: "Charged" });
    expect(container.innerHTML).not.toMatch(/CANARY/);
  });
});
