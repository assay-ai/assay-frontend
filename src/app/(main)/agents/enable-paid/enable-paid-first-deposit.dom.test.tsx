// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY_A = "0x" + "1".repeat(32) + "1A2b9F3c";
const EVM = "eip155:46630";

const bound = vi.hoisted(() => ({ key: "" }));
const money = vi.hoisted(() => ({ chainId: "eip155:46630" }));

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: true }) }));
vi.mock("@/hooks/useSearchParam", () => ({ useSearchParam: () => "cred-1" }));
vi.mock("@/features/oauth/strict-pages", () => ({ loadPage: () => undefined, useFullLoadLinks: () => undefined }));
vi.mock("@/features/account-block/use-account-block", () => ({ useAccountReadOnly: () => false }));
vi.mock("@/components/buyer-money/deposit-sheet", () => ({ DepositSheet: () => null }));
vi.mock("@/components/buyer-money/let-agent-pay-sheet", () => ({ enablePaidSteps: () => [] }));
vi.mock("@/components/buyer-money/use-buyer-money", () => ({
  useBuyerMoney: () => ({
    // A buyer who never deposited: GET /escrow reads no escrow.
    escrow: { exists: false },
    escrowQuery: { isSuccess: true, error: null, dataUpdatedAt: Date.now(), refetch: () => undefined },
    balancesQuery: { data: undefined },
    decimals: 6,
    chainId: money.chainId,
    chainName: "Testnet",
    signerState: { status: "ready" },
    ownerShort: "0x1234",
  }),
  useWalletBlocker: () => null,
}));
vi.mock("@/services/account.service", () => ({
  // `include=credentials` nests each agent's keys: no per-agent read is needed.
  listAgents: async () => ({
    items: [
      {
        agentId: "agt-1",
        label: "research-bot",
        credentials: {
          items: [
            {
              id: "cred-1",
              agentId: "agt-1",
              name: "Assay app on laptop",
              issuedVia: "OAUTH",
              oauthClient: { name: "Assay app", paymentClient: true },
              expiresAt: null,
              revokedAt: null,
              delegateAccount: `${EVM}:${bound.key}`,
            },
          ],
          hasMore: false,
        },
      },
    ],
    pageInfo: { nextCursor: null, hasMore: false },
  }),
  listCredentials: async () => {
    throw new Error("not read: the agents answer carried every key");
  },
}));
vi.mock("@/services/delegation.service", () => ({ listDelegates: async () => ({ delegates: [] }) }));
// The view as the page hands it over: the balance line and what blocks Approve.
vi.mock("@/components/delegation/enable-paid-view", () => ({
  EnablePaidView: ({ balance, walletBlocker }: { balance: string | null; walletBlocker: React.ReactNode }) => (
    <div>
      <span data-testid="balance">{balance ?? "unknown"}</span>
      <span data-testid="blocker">{walletBlocker ?? "none"}</span>
    </div>
  ),
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

beforeEach(() => {
  window.sessionStorage.clear();
  bound.key = KEY_A;
  money.chainId = EVM;
  window.history.replaceState(null, "", `/agents/enable-paid?credential=cred-1#key=${KEY_A}`);
});
afterEach(cleanup);

/* BUG-A-05 follow-up: a never-funded buyer turns paid calls on first and adds funds on the same page. */
describe("/agents/enable-paid for a buyer who never deposited", () => {
  it("eip155: Approve is not blocked, and the balance reads $0.00", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("balance").textContent).toBe("$0.00"));
    expect(screen.getByTestId("blocker").textContent).toBe("none");
  });
});
