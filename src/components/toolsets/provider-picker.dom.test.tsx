// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderRow } from "@/components/g31/use-catalogue";
import { defaultEntry } from "@/features/toolsets/entry-rules";

const catalogue = vi.hoisted(() => ({ getCatalogueProvider: vi.fn() }));
vi.mock("@/services/catalogue.service", () => catalogue);
vi.mock("@/components/contracts/use-tool-versions", () => ({
  useToolVersions: () => ({ data: { versions: [] }, isPending: false, isError: false, isSuccess: true, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useChainName", () => ({
  useChainName: () => (id: string) => ({ "eip155:46630": "Robinhood Chain testnet", "solana:devnet": "Solana devnet" })[id] ?? id,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import { RuleEditor } from "./toolset-editor";

const USD = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0xusdg", decimals: 6 });

function provider(over: Partial<ProviderRow>): ProviderRow {
  return {
    providerId: "p",
    name: "P",
    verified: false,
    verifiedAt: null,
    tier: "ESTABLISHED",
    toolIds: ["weather"],
    activeBindings: 1,
    fromPrice: null,
    stake: [],
    quality: 0.95,
    measuredCalls: 200,
    failedCalls: 10,
    yourCalls: 0,
    ...over,
  };
}

// The seed shape behind review F-P1: an EVM buyer; Open-Meteo settles only on Solana devnet.
const E2E = provider({ providerId: "e2e", name: "E2E Weather Ltd", tier: "NEW", measuredCalls: 95, failedCalls: 10 });
const METEO = provider({ providerId: "meteo", name: "Open-Meteo Demo BV" });

function detail(providerId: string, price: string, chains: string[], servesYou: boolean) {
  return { providerId, tools: [{ toolId: "weather", name: "get_weather", pricingMode: "PAID", price: USD(price), chains, servesYou }] };
}

function renderEditor(onApply = vi.fn()) {
  catalogue.getCatalogueProvider.mockImplementation(async (id: string) =>
    id === "meteo" ? detail("meteo", "250000", ["solana:devnet"], false) : detail("e2e", "100000", ["eip155:46630"], true),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RuleEditor
        row={{ ...defaultEntry("weather"), toolName: "get_weather" }}
        decimals={6}
        asset="eip155:46630/erc20:0xusdg"
        providers={[E2E, METEO]}
        versions={[]}
        onApply={onApply}
        onCancel={vi.fn()}
        saving={false}
      />
    </QueryClientProvider>,
  );
  return onApply;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the provider picker", () => {
  it("shows each provider's price, chain, failure rate and whether it serves you", async () => {
    renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Only these" }));

    await waitFor(() => expect(screen.getAllByTestId("serving-chip")).toHaveLength(2));
    const [e2e, meteo] = screen.getAllByTestId("provider-option");
    expect(within(e2e).getByTestId("provider-facts").textContent).toMatch(/^\$0\.10 · Robinhood Chain testnet · 11% failed$/);
    expect(e2e.textContent).toContain("Serves you");
    expect(within(meteo).getByTestId("provider-facts").textContent).toContain("Solana devnet · 5.0% failed");
    expect(meteo.textContent).toContain("Doesn't take payment on your chain");
  });

  it("warns before Apply when only Open-Meteo is chosen, and saves only on Apply anyway", async () => {
    const onApply = renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Only these" }));
    await waitFor(() => expect(screen.getAllByTestId("serving-chip")).toHaveLength(2));
    fireEvent.click(within(screen.getAllByTestId("provider-option")[1]).getByRole("checkbox"));

    const warning = await screen.findByTestId("nothing-runs-warning");
    expect(warning.textContent).toContain("Open-Meteo Demo BV doesn't take payment on your chain");
    expect(warning.textContent).toContain("Every get_weather call from your agents would be refused");

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId("nothing-runs-warning").textContent).toContain("Apply anyway?");

    fireEvent.click(screen.getByRole("button", { name: "Apply anyway" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0]).toMatchObject({ providerMode: "ONLY", providerIds: ["meteo"] });
  });

  it("does not warn when a provider that serves you is left", async () => {
    const onApply = renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Only these" }));
    await waitFor(() => expect(screen.getAllByTestId("serving-chip")).toHaveLength(2));
    fireEvent.click(within(screen.getAllByTestId("provider-option")[0]).getByRole("checkbox"));

    expect(screen.queryByTestId("nothing-runs-warning")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
