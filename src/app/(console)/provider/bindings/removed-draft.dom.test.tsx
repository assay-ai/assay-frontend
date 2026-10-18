// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
  Review I2: with the real tool-name hook, a draft is "Removed tool (draft)"
  only when the catalogue LOADED without its tool. A failed catalogue read
  keeps "Unknown tool" and "Continue setup": it proves nothing was removed.
*/
const usd = (amount: string) => ({ amount, asset: "usdg", decimals: 6 });
const DRAFT = { id: "d1", toolId: "t-gone", endpoint: "https://api.example/v1", pricingMode: "PAID", price: usd("100000"), status: "DRAFT" };

const service = vi.hoisted(() => ({
  listToolBindings: vi.fn(),
  discardToolBinding: vi.fn(),
  listToolCatalogue: vi.fn(),
}));
vi.mock("@/services/provider-tool-bindings.service", () => service);

import ProviderToolsPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount() {
  service.listToolBindings.mockResolvedValue({ items: [DRAFT], pageInfo: { hasMore: false, nextCursor: null } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProviderToolsPage />
    </QueryClientProvider>,
  );
}

describe("a draft whose tool is not in the catalogue", () => {
  it("reads Removed tool (draft) once the catalogue loaded without it", async () => {
    service.listToolCatalogue.mockResolvedValue({ tools: [{ id: "t-other", name: "get_weather" }], settlementAsset: null });
    const { container } = mount();
    await screen.findByText("Removed tool (draft)");
    expect(container.textContent).toContain("Its tool was removed");
    expect(container.textContent).not.toContain("Continue setup");
  });

  it("never says removed when the catalogue failed to load", async () => {
    service.listToolCatalogue.mockRejectedValue(new Error("down"));
    const { container } = mount();
    await screen.findByText("Unknown tool");
    expect(container.textContent).toContain("Continue setup");
    expect(container.textContent).not.toMatch(/removed/i);
  });
});
