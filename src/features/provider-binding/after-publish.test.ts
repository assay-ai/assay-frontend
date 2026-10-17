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

import { applyPublished, demoPublished, isAlreadyLive, isPublishedState, JUST_PUBLISHED_MS, withJustPublished } from "./after-publish";

const ID = "b-1";

const detail = (overrides: Partial<ToolBindingDetail> = {}): ToolBindingDetail => ({
  id: ID,
  toolId: "t-1",
  endpoint: "https://api.example.com/search",
  authMode: "SIGNATURE",
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

describe("withJustPublished", () => {
  const draft = detail({ status: "DRAFT", version: 2, publishedVersion: null, hasUnpublishedChanges: true });
  const live = detail({ status: "ACTIVE", version: 2, publishedVersion: 2, hasUnpublishedChanges: false });

  it("keeps a just-published listing live over an older read", () => {
    const shown = withJustPublished(draft, { binding: live, at: 1000 }, 2000);
    expect(shown.status).toBe("ACTIVE");
    expect(isPublishedState(shown)).toBe(true);
  });

  it("lets the read win once it caught up, after a newer edit, or after the record expires", () => {
    expect(withJustPublished(live, { binding: live, at: 1000 }, 2000)).toBe(live);
    const edited = detail({ status: "ACTIVE", version: 3, publishedVersion: 1 });
    expect(withJustPublished(edited, { binding: live, at: 1000 }, 2000)).toBe(edited);
    expect(withJustPublished(draft, { binding: live, at: 0 }, JUST_PUBLISHED_MS + 1)).toBe(draft);
  });
});

describe("withJustPublished — the seed is not a read", () => {
  it("keeps the record when shown the very object it remembered, so a later stale read is still overlaid", () => {
    const live = detail({ status: "ACTIVE", publishedVersion: 1, hasUnpublishedChanges: false });
    const record = { binding: live, at: 1000 };
    expect(withJustPublished(live, record, 2000)).toBe(live);
    expect(withJustPublished(detail(), record, 2000).status).toBe("ACTIVE");
  });
});

describe("demoPublished", () => {
  it("keeps the terms the wizard saved and takes only the publish state from the answer", () => {
    const saved = detail({ pricingMode: "PAID", price: { amount: "300000", asset: "x", decimals: 6 } });
    const answer: PublishedToolBinding = {
      ...detail({ pricingMode: "FREE", price: { amount: "0", asset: "x", decimals: 6 }, status: "ACTIVE", publishedVersion: 1 }),
      publishedAt: "2026-10-16T00:00:00.000Z",
    };
    const shown = demoPublished(answer, saved);
    expect(shown.pricingMode).toBe("PAID");
    expect(shown.price.amount).toBe("300000");
    expect(isPublishedState(shown)).toBe(true);
  });
});
