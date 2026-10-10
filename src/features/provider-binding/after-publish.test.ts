import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CursorPage,
  ProviderStake,
  PublishedToolBinding,
  ToolBindingDetail,
  ToolBindingSummary,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";

const revalidated = vi.hoisted(() => ({ stake: { stake: [], marker: "fresh" } as unknown }));

vi.mock("@/services/provider-stake.service", () => ({
  revalidateProviderStake: vi.fn(async () => revalidated.stake),
}));

import { revalidateProviderStake } from "@/services/provider-stake.service";

import { applyPublished, isAlreadyLive, isPublishedState } from "./after-publish";

const ID = "b-1";

const detail = (overrides: Partial<ToolBindingDetail> = {}): ToolBindingDetail => ({
  id: ID,
  toolId: "t-1",
  endpoint: "https://api.example.com/search",
  pricingMode: "PAID",
  price: { amount: "250000", asset: "eip155:46630/erc20:0xa0b8", decimals: 6 },
  status: "DRAFT",
  version: 1,
  requestMapping: {},
  responseMapping: {},
  freeQuotaPerAgent: null,
  freeDailyBudget: null,
  slaFailureRate: 0.05,
  timeoutMs: 5000,
  maxRps: null,
  maxDailyCalls: null,
  publishedVersion: null,
  hasUnpublishedChanges: true,
  ...overrides,
});

const published: PublishedToolBinding = {
  ...detail({ status: "ACTIVE", publishedVersion: 1, hasUnpublishedChanges: false }),
  publishedAt: "2026-10-11T16:00:00.000Z",
};

describe("applyPublished — BUG-J-PROV-02", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(revalidateProviderStake).mockClear();
  });

  it("seeds the binding detail with the publish response", async () => {
    queryClient.setQueryData(["provider", "tool-binding", ID], detail());
    await applyPublished(queryClient, published);
    expect(queryClient.getQueryData<ToolBindingDetail>(["provider", "tool-binding", ID])?.status).toBe(
      "ACTIVE",
    );
  });

  it("marks the binding live in the sidebar list without a refetch", async () => {
    const other: ToolBindingSummary = { ...detail(), id: "b-2" };
    queryClient.setQueryData<CursorPage<ToolBindingSummary>>(["provider", "tool-bindings", "sidebar"], {
      items: [detail(), other],
      pageInfo: { hasMore: false, nextCursor: null },
    });
    await applyPublished(queryClient, published);
    const items = queryClient.getQueryData<CursorPage<ToolBindingSummary>>([
      "provider",
      "tool-bindings",
      "sidebar",
    ])?.items;
    expect(items?.map((item) => item.status)).toEqual(["ACTIVE", "DRAFT"]);
  });

  it("re-reads the stake past the HTTP cache, so Home's headroom is not the pre-publish one", async () => {
    queryClient.setQueryData<ProviderStake>(["provider", "stake"], {
      stake: [],
    } as unknown as ProviderStake);
    await applyPublished(queryClient, published);
    expect(revalidateProviderStake).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["provider", "stake"])).toEqual(revalidated.stake);
  });

  it("marks the publish check stale", async () => {
    queryClient.setQueryData(["provider", "tool-binding", ID, "publish-check"], { publishable: true });
    await applyPublished(queryClient, published);
    expect(
      queryClient.getQueryState(["provider", "tool-binding", ID, "publish-check"])?.isInvalidated,
    ).toBe(true);
  });
});

describe("isAlreadyLive", () => {
  it("is the ALREADY_PUBLISHED code and nothing else", () => {
    expect(
      isAlreadyLive(new ApiError("PROVIDER_BINDING_ALREADY_PUBLISHED", "Revision 1 is already live.", 409)),
    ).toBe(true);
    expect(isAlreadyLive(new ApiError("PROVIDER_PUBLISH_CHECKS_FAILED", "no", 409))).toBe(false);
    expect(isAlreadyLive(new Error("PROVIDER_BINDING_ALREADY_PUBLISHED"))).toBe(false);
  });
});

describe("isPublishedState", () => {
  it("is true only for an ACTIVE binding with nothing unpublished", () => {
    expect(isPublishedState(published)).toBe(true);
    expect(isPublishedState(detail())).toBe(false);
    expect(isPublishedState({ ...published, hasUnpublishedChanges: true })).toBe(false);
    expect(isPublishedState(undefined)).toBe(false);
  });
});
