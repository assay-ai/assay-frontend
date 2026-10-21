// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogueSettlementAsset, CatalogueTool, ToolBindingDetail } from "@/interfaces";

vi.mock("@/services/provider-tool-bindings.service", () => ({
  getPublishCheck: vi.fn(async () => ({ requirements: [] })),
}));
vi.mock("@/features/provider-stake/use-stake-status", () => ({
  useStakeStatus: () => ({ isLoading: false, isError: false, stake: null, staked: null, refetch: vi.fn() }),
}));
vi.mock("@/features/provider-stake/stake-sheet", () => ({ StakeSheet: () => null }));
vi.mock("../tool-name", () => ({ useProviderToolNames: () => ({ tool: () => null }) }));

import { freeBudgetPatch, LiveStage } from "./live-stage";

const ASSET = { assetId: "eip155:46630/erc20:0x915E", decimals: 6 } as unknown as CatalogueSettlementAsset;
const TOOL = { id: "t1", name: "quote", description: "d", versions: [] } as unknown as CatalogueTool;

function binding(over: Partial<ToolBindingDetail> = {}): ToolBindingDetail {
  return {
    id: "b1",
    toolId: "t1",
    status: "DRAFT",
    pricingMode: "FREE",
    price: { amount: "0", asset: ASSET.assetId, decimals: 6 },
    freeQuotaPerAgent: null,
    freeDailyBudget: null,
    slaFailureRate: 0.02,
    timeoutMs: 10_000,
    ...over,
  } as unknown as ToolBindingDetail;
}

function mount(onSave = vi.fn(async (body: unknown) => ({ ...binding(), ...(body as object) }) as ToolBindingDetail), over = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LiveStage
        tool={TOOL}
        binding={binding(over)}
        asset={ASSET}
        terms={null}
        priceHint={null}
        readOnly={false}
        onSave={onSave}
        onPublish={async () => undefined}
        onBackToTest={() => undefined}
      />
    </QueryClientProvider>,
  );
  return onSave;
}

const field = () => screen.queryByRole("textbox", { name: /Free calls per day, all agents \(optional\)/ }) as HTMLInputElement | null;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Go live: free daily budget on a Free listing (BUG-P0-01)", () => {
  it("offers the optional all-agents field on Free, empty = platform default", () => {
    mount();
    expect(field()).not.toBeNull();
    expect(field()!.value).toBe("");
    expect(field()!.placeholder).toBe("Platform default");
    expect(screen.getByText(/up to the platform's default daily limit of free calls/)).toBeTruthy();
  });

  it("is not on Free + paid, which keeps its per-agent box as before", () => {
    mount(undefined, { status: "DRAFT", pricingMode: "FREEMIUM", price: { amount: "100000", asset: ASSET.assetId, decimals: 6 } });
    expect(field()).toBeNull();
    expect(screen.getByRole("textbox", { name: /Free calls per agent per day/ })).toBeTruthy();
  });

  it("autosaves the call count as freeDailyBudget, the Settings page's DTO field", async () => {
    vi.useFakeTimers();
    const onSave = mount();
    fireEvent.change(field()!, { target: { value: "500" } });
    expect(screen.getByText(/up to 500 free calls a day in total/)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1300);
    });
    expect(onSave).toHaveBeenCalledWith({ freeDailyBudget: 500 });
  });

  it("refuses a value that is not a whole number of calls, and saves nothing", async () => {
    vi.useFakeTimers();
    const onSave = mount();
    fireEvent.change(field()!, { target: { value: "1.5" } });
    expect(screen.getByText("A whole number of calls, like 100.")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1300);
    });
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("freeBudgetPatch", () => {
  it("sends only a change; emptying sends null (platform default)", () => {
    expect(freeBudgetPatch("FREE", "", { freeDailyBudget: null }).patch).toEqual({});
    expect(freeBudgetPatch("FREE", "200", { freeDailyBudget: null }).patch).toEqual({ freeDailyBudget: 200 });
    expect(freeBudgetPatch("FREE", "200", { freeDailyBudget: 200 }).patch).toEqual({});
    expect(freeBudgetPatch("FREE", "", { freeDailyBudget: 200 }).patch).toEqual({ freeDailyBudget: null });
  });

  it("does nothing outside Free", () => {
    expect(freeBudgetPatch("FREEMIUM", "abc", { freeDailyBudget: null })).toEqual({ error: null, value: null, patch: {} });
    expect(freeBudgetPatch("PAID", "5", { freeDailyBudget: 7 }).patch).toEqual({});
  });
});
