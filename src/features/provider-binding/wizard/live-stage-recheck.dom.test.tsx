// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogueSettlementAsset, CatalogueTool, ToolBindingDetail } from "@/interfaces";
import { WithChains } from "@/test/chain-fixture";

const fresh = { publishable: true, mappingVersion: 2, requirements: [{ requirement: "TESTER_PASSED", met: true, code: null, detail: null }] };
const gate = vi.hoisted(() => ({ release: () => undefined as void }));
vi.mock("@/services/provider-tool-bindings.service", () => ({
  getPublishCheck: vi.fn(() => new Promise((resolve) => (gate.release = () => resolve(fresh)))),
}));
vi.mock("@/features/provider-stake/use-stake-status", () => ({
  useStakeStatus: () => ({ isLoading: false, isError: false, stake: null, staked: null, refetch: vi.fn() }),
}));
vi.mock("@/features/provider-stake/stake-sheet", () => ({ StakeSheet: () => null }));
vi.mock("../tool-name", () => ({ useProviderToolNames: () => ({ tool: () => null }) }));

import { LiveStage } from "./live-stage";

const ASSET = { assetId: "eip155:46630/erc20:0x915E", decimals: 6 } as unknown as CatalogueSettlementAsset;
const TOOL = { id: "t1", name: "quote", description: "d", versions: [] } as unknown as CatalogueTool;
const draft = {
  id: "b1",
  toolId: "t1",
  status: "DRAFT",
  pricingMode: "FREE",
  price: { amount: "0", asset: ASSET.assetId, decimals: 6 },
  freeQuotaPerAgent: null,
  freeDailyBudget: null,
  slaFailureRate: 0.02,
  timeoutMs: 10_000,
} as unknown as ToolBindingDetail;

afterEach(cleanup);

/* Onboarding wave 2 item 6: no flash of "needs a passing test" while a stale check refetches. */
describe("Go live while the publish check refetches", () => {
  it("says Checking… instead of the stale unmet test, then enables Publish", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // What the cache held from before the test passed: the tester row unmet.
    client.setQueryData(["provider", "tool-binding", "b1", "publish-check"], {
      publishable: false,
      mappingVersion: 1,
      requirements: [{ requirement: "TESTER_PASSED", met: false, code: "TESTER_NOT_PASSED", detail: null }],
    });
    await client.invalidateQueries({ queryKey: ["provider", "tool-binding", "b1", "publish-check"], refetchType: "none" });
    render(
      <QueryClientProvider client={client}>
        <WithChains>
          <LiveStage tool={TOOL} binding={draft} asset={ASSET} terms={null} priceHint={null} readOnly={false} onSave={async () => draft} onPublish={async () => undefined} onBackToTest={() => undefined} />
        </WithChains>
      </QueryClientProvider>,
    );
    expect(screen.queryByText(/passing test/)).toBeNull();
    expect(screen.getByText("Checking your listing…")).toBeTruthy();
    const publishButton = screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
    await act(async () => gate.release());
    await waitFor(() => expect((screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(/passing test/)).toBeNull();
  });
});
