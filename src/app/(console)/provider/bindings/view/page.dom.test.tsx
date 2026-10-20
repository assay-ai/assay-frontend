// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/* B9: a draft has no Overview; its link lands in the wizard where it was left. */
const state = vi.hoisted(() => ({ status: "DRAFT" }));
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams("binding=b1"),
}));
vi.mock("@/features/provider-binding/binding-header", () => ({
  bindingQueryKey: (id: string) => ["provider", "tool-binding", id],
  useBinding: () => ({
    data: {
      id: "b1",
      toolId: "t1",
      status: state.status,
      pricingMode: "FREE",
      price: { amount: "0", asset: "usdg", decimals: 6 },
      slaFailureRate: 0.02,
      timeoutMs: 8000,
      publishedVersion: state.status === "DRAFT" ? null : 1,
      freeQuotaPerAgent: null,
    },
    isError: false,
  }),
  BindingHeader: () => null,
}));
vi.mock("@/features/provider-binding/tool-name", () => ({
  useProviderToolNames: () => ({ bindingLabel: () => "get_weather", tool: () => null }),
}));
vi.mock("@/services/provider-tool-bindings.service", () => ({
  getPublishCheck: vi.fn(async () => ({ requirements: [] })),
  pauseToolBinding: vi.fn(),
  resumeToolBinding: vi.fn(),
}));
vi.mock("@/services/provider-reports.service", () => ({ getProviderEarnings: vi.fn(async () => ({ groups: [] })) }));
vi.mock("@/services/provider-sla-windows.service", () => ({ listSlaWindows: vi.fn(async () => ({ items: [] })) }));
vi.mock("@/services/provider-stake.service", () => ({ getProviderStake: vi.fn(async () => null) }));
vi.mock("@/hooks/useChains", () => ({ useChains: () => ({ chains: [] }) }));

import BindingOverviewPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BindingOverviewPage />
    </QueryClientProvider>,
  );
}

describe("a listing's Overview", () => {
  it("sends a draft to the wizard", async () => {
    state.status = "DRAFT";
    mount();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/provider/bindings/new?binding=b1"));
  });

  it("stays put for a published listing", async () => {
    state.status = "PAUSED";
    mount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(router.replace).not.toHaveBeenCalled();
  });
});
