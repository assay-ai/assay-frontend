// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY_A = "0x" + "1".repeat(32) + "1A2b9F3c";
const KEY_B = "0x" + "2".repeat(32) + "5E6f7A8b";
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
vi.mock("@/services/account.service", () => ({
  listAgents: async () => ({ items: [{ agentId: "agt-1", label: "research-bot" }], pageInfo: { nextCursor: null, hasMore: false } }),
  listCredentials: async () => ({
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
    pageInfo: { nextCursor: null, hasMore: false },
  }),
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

describe("/agents/enable-paid on a fragment-only change (BUG-M3-02)", () => {
  it("re-checks a new #key that does not match the bound key: refused, never the old key's approvable page", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("view-key").textContent).toBe(`${EVM}:${KEY_A}`));
    act(() => {
      setHash(KEY_B);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/doesn.t match/i));
    expect(screen.queryByTestId("view-key")).toBeNull();
  });

  it("a new #key that is bound now is checked afresh: read again, its own page, the old tick dropped", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("view-key").textContent).toBe(`${EVM}:${KEY_A}`));
    fireEvent.click(screen.getByRole("button", { name: "Tick" }));
    expect(screen.getByTestId("view-ticked").textContent).toBe("ticked");
    // The app bound a new key and showed a new link, pasted into this tab.
    bound.key = KEY_B;
    act(() => {
      setHash(KEY_B);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(screen.getByTestId("view-key").textContent).toBe(`${EVM}:${KEY_B}`));
    expect(screen.getByTestId("view-ticked").textContent).toBe("not ticked");
  });

  it("back to the first key after a mismatch shows its page again", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("view-key")).toBeTruthy());
    act(() => {
      setHash(KEY_B);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(screen.queryByTestId("view-key")).toBeNull());
    act(() => {
      setHash(KEY_A);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await waitFor(() => expect(screen.getByTestId("view-key").textContent).toBe(`${EVM}:${KEY_A}`));
  });
});
