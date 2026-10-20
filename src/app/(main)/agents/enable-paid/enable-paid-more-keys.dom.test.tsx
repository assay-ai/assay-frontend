// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY_A = "0x" + "1".repeat(32) + "1A2b9F3c";
const EVM = "eip155:46630";

const bound = vi.hoisted(() => ({ key: "" }));

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true }) }));
vi.mock("@/hooks/useSearchParam", () => ({ useSearchParam: () => "cred-1" }));
vi.mock("@/features/oauth/strict-pages", () => ({ loadPage: () => undefined, useFullLoadLinks: () => undefined }));
vi.mock("@/features/account-block/use-account-block", () => ({ useAccountReadOnly: () => false }));
vi.mock("@/components/buyer-money/deposit-sheet", () => ({ DepositSheet: () => null }));
vi.mock("@/components/buyer-money/let-agent-pay-sheet", () => ({ enablePaidSteps: () => [] }));
vi.mock("@/components/buyer-money/use-buyer-money", () => ({
  useBuyerMoney: () => ({
    escrow: { exists: true, escrowPda: `${EVM}:0x${"3".repeat(40)}` },
    escrowQuery: { isSuccess: true, error: null, dataUpdatedAt: Date.now(), refetch: () => undefined },
    balancesQuery: { data: undefined },
    decimals: 6,
    chainId: EVM,
    chainName: "Testnet",
    signerState: { status: "ready" },
    ownerShort: "0x1234",
  }),
  useWalletBlocker: () => null,
}));
const reads = vi.hoisted(() => [] as unknown[]);
const credential = (id: string) => ({
  id,
  agentId: "agt-1",
  name: id === "cred-1" ? "Assay app on laptop" : `Key ${id}`,
  issuedVia: id === "cred-1" ? "OAUTH" : "API_KEY",
  oauthClient: id === "cred-1" ? { name: "Assay app", paymentClient: true } : null,
  expiresAt: null,
  revokedAt: null,
  delegateAccount: id === "cred-1" ? `${EVM}:${bound.key}` : null,
});
vi.mock("@/services/account.service", () => ({
  // 51 keys: the agents answer carries the first 50 (newest first), not the one this link names.
  listAgents: async (query: unknown) => {
    reads.push(["agents", query]);
    return {
      items: [
        {
          agentId: "agt-1",
          label: "research-bot",
          credentials: { items: Array.from({ length: 50 }, (_, i) => credential(`new-${i}`)), hasMore: true },
        },
      ],
      pageInfo: { nextCursor: null, hasMore: false },
    };
  },
  listCredentials: async (agentId: string, query: { cursor?: string }) => {
    reads.push(["credentials", agentId, query]);
    return query.cursor
      ? { items: [credential("cred-1")], pageInfo: { nextCursor: null, hasMore: false } }
      : { items: Array.from({ length: 50 }, (_, i) => credential(`new-${i}`)), pageInfo: { nextCursor: "c-2", hasMore: true } };
  },
}));
vi.mock("@/services/delegation.service", () => ({ listDelegates: async () => ({ delegates: [] }) }));
// The view as the page hands it over: what it was given, and whether it kept a tick from before.
vi.mock("@/components/delegation/enable-paid-view", () => ({
  EnablePaidView: ({ state }: { state: { kind: string; delegateAccount: string } }) => {
    const [ticked, setTicked] = React.useState(false);
    return (
      <div>
        <span data-testid="view-key">{state.delegateAccount}</span>
        <span data-testid="view-ticked">{ticked ? "ticked" : "not ticked"}</span>
        <button type="button" onClick={() => setTicked(true)}>
          Tick
        </button>
      </div>
    );
  },
}));

import EnablePaidPage from "./page";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EnablePaidPage />
    </QueryClientProvider>,
  );
}

function setHash(key: string) {
  window.history.replaceState(null, "", `/agents/enable-paid?credential=cred-1#key=${key}`);
}

beforeEach(() => {
  window.sessionStorage.clear();
  bound.key = KEY_A;
  setHash(KEY_A);
});
afterEach(cleanup);

describe("/agents/enable-paid for an agent with more than 50 keys", () => {
  it("reads the agent's whole key list, so the key this link names is found", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("view-key").textContent).toBe(`${EVM}:${KEY_A}`));
    expect(reads).toEqual([
      ["agents", { limit: 50, cursor: undefined, include: "credentials" }],
      ["credentials", "agt-1", { limit: 50, cursor: undefined }],
      ["credentials", "agt-1", { limit: 50, cursor: "c-2" }],
    ]);
  });
});
