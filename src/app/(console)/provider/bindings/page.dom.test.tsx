// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

/*
  B9: Listings — live first, never an address, and a never-published draft
  can be discarded behind a confirm that runs the DELETE once.
*/
const usd = (amount: string) => ({ amount, asset: "usdg", decimals: 6 });
const ROWS = [
  { id: "d1", toolId: "t-draft", endpoint: "http://[2001:db8::1]:4010/v1", pricingMode: "PAID", price: usd("100000"), status: "DRAFT" },
  { id: "a1", toolId: "t-live", endpoint: "https://api.acme.example/v1", pricingMode: "FREE", price: usd("0"), status: "ACTIVE" },
];

const service = vi.hoisted(() => ({
  listToolBindings: vi.fn(),
  discardToolBinding: vi.fn(),
}));
vi.mock("@/services/provider-tool-bindings.service", () => service);
const removed = vi.hoisted(() => ({ on: false }));
vi.mock("@/features/provider-binding/tool-name", () => ({
  REMOVED_TOOL_DRAFT: "Removed tool (draft)",
  useProviderToolNames: () => ({
    toolName: (id: string) => (id === "t-draft" ? (removed.on ? null : "get_token_market") : "get_weather"),
    bindingLabel: (b: { toolId: string }) =>
      b.toolId === "t-draft" ? (removed.on ? "Removed tool (draft)" : "get_token_market") : "get_weather",
  }),
}));

import ProviderToolsPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  removed.on = false;
});

function mount() {
  service.listToolBindings.mockResolvedValue({ items: ROWS, pageInfo: { hasMore: false, nextCursor: null } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProviderToolsPage />
    </QueryClientProvider>,
  );
}

describe("Listings", () => {
  it("lists live first and never shows an address", async () => {
    const { container } = mount();
    await screen.findByText("get_weather");
    const text = container.textContent ?? "";
    expect(text.indexOf("get_weather")).toBeLessThan(text.indexOf("get_token_market"));
    expect(text).not.toMatch(/acme\.example|2001:db8|4010/);
  });

  it("discards a draft once, after the confirm", async () => {
    service.discardToolBinding.mockResolvedValue(undefined);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Discard draft" }));
    expect(service.discardToolBinding).not.toHaveBeenCalled();
    const confirm = await screen.findAllByRole("button", { name: "Discard draft" });
    fireEvent.click(confirm[confirm.length - 1]!);
    await waitFor(() => expect(service.discardToolBinding).toHaveBeenCalledTimes(1));
    expect(service.discardToolBinding).toHaveBeenCalledWith("d1");
  });

  it("explains a 409: the listing went past the draft meanwhile", async () => {
    service.discardToolBinding.mockRejectedValue(
      new ApiError("PROVIDER_BINDING_NOT_DISCARDABLE", "no", 409, "/providers/me/tool-bindings/d1"),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Discard draft" }));
    const confirm = await screen.findAllByRole("button", { name: "Discard draft" });
    fireEvent.click(confirm[confirm.length - 1]!);
    expect(await screen.findByText(/can no longer be discarded/)).toBeTruthy();
  });

  it("names a draft whose tool was removed, and still discards it (V1-9)", async () => {
    removed.on = true;
    service.discardToolBinding.mockResolvedValue(undefined);
    const { container } = mount();
    await screen.findByText("Removed tool (draft)");
    expect(container.textContent).toContain("Its tool was removed");
    expect(container.textContent).not.toContain("Unknown tool");
    fireEvent.click(await screen.findByRole("button", { name: "Discard draft" }));
    expect(await screen.findByText("Discard this draft for a removed tool?")).toBeTruthy();
    const confirm = await screen.findAllByRole("button", { name: "Discard draft" });
    fireEvent.click(confirm[confirm.length - 1]!);
    await waitFor(() => expect(service.discardToolBinding).toHaveBeenCalledWith("d1"));
  });
});
