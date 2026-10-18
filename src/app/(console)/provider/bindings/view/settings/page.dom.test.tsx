// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ToolBindingDetail } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";

const binding = {
  id: "b1",
  toolId: "t1",
  endpoint: "https://p.test/v1",
  publishedEndpoint: "https://p.test/v1",
  status: "ACTIVE",
  version: 1,
  authMode: "SIGNATURE",
  pricingMode: "FREE",
  price: { amount: "0", asset: "USDC", decimals: 6 },
  freeQuotaPerAgent: null,
  freeDailyBudget: null,
  slaFailureRate: 0.05,
  timeoutMs: 10000,
  maxRps: null,
  maxDailyCalls: null,
  hasUnpublishedChanges: false,
} as unknown as ToolBindingDetail;

const service = vi.hoisted(() => ({ updateToolBinding: vi.fn() }));
vi.mock("@/services/provider-tool-bindings.service", () => service);
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("binding=b1") }));
vi.mock("@/features/account-block/use-account-block", () => ({ useAccountReadOnly: () => false }));
vi.mock("@/features/provider-stake/use-stake-status", () => ({ useStakeStatus: () => ({ stake: null, staked: null, refetch: vi.fn() }) }));
vi.mock("@/features/provider-stake/stake-sheet", () => ({ StakeSheet: () => null }));
vi.mock("@/features/provider-binding/tool-name", () => ({
  useProviderCatalogue: () => ({ data: { settlementAsset: { assetId: "a", symbol: "USDC", decimals: 6 } } }),
}));
vi.mock("@/features/provider-binding/binding-header", () => ({
  bindingQueryKey: (id: string) => ["provider", "tool-binding", id],
  useBinding: () => ({ data: binding, isError: false }),
  BindingHeader: () => null,
}));
// The real panel is covered elsewhere; here it only switches the mode.
vi.mock("@/features/provider-binding/authentication/authentication-panel", () => ({
  AuthenticationPanel: ({ onModeChange }: { onModeChange: (mode: string) => void }) => (
    <button type="button" onClick={() => onModeChange("API_KEY")}>
      Pick API key
    </button>
  ),
}));

import BindingSettingsPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Settings save", () => {
  it("explains a save refused because no API key headers are stored", async () => {
    service.updateToolBinding.mockRejectedValue(new ApiError("PROVIDER_CREDENTIALS_REQUIRED_FOR_AUTH_MODE", "x", 409));
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <BindingSettingsPage />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Pick API key" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(service.updateToolBinding).toHaveBeenCalledWith("b1", { authMode: "API_KEY" }));
    expect(await screen.findByText("Add your API key headers for the live address first, then switch to API key.")).toBeTruthy();
  });
});
