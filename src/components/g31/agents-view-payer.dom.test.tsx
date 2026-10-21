// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@privy-io/react-auth/solana", () => ({
  useWallets: () => ({ ready: true, wallets: [] }),
  useSignMessage: () => ({ signMessage: async () => ({ signature: new Uint8Array() }) }),
  useSignTransaction: () => ({ signTransaction: async () => ({ signedTransaction: new Uint8Array() }) }),
  useSignAndSendTransaction: () => ({ signAndSendTransaction: async () => ({ signature: new Uint8Array() }) }),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true }),
  useWallets: () => ({ ready: true, wallets: [] }),
  useSignMessage: () => ({ signMessage: async () => ({ signature: "0x" }) }),
  useSignTypedData: () => ({ signTypedData: async () => ({ signature: "0x" }) }),
  useSignTransaction: () => ({ signTransaction: async () => ({ signature: "0x" }) }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => "/agents",
  useSearchParams: () => new URLSearchParams(),
}));

// Who is asked to sign: the payer account each stop path is wired to.
const stops = vi.hoisted(() => ({ calls: [] as { account: string | undefined; delegate: string }[] }));
vi.mock("./agent-payment-delegation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-payment-delegation")>()),
  explainStopFailure: () => "failed",
  PayerDelegationsPanel: () => null,
  useStopPaymentKey: (account: string | undefined) => async (delegate: string) => {
    stops.calls.push({ account, delegate });
  },
  StopPaymentKeySheet: ({ account, target }: { account: string | undefined; target: { delegateAccount: string } | null }) =>
    target ? <div data-testid="stop-sheet" data-account={account ?? ""} data-delegate={target.delegateAccount} /> : null,
}));
vi.mock("./revoke-credential-dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./revoke-credential-dialog")>()),
  RevokeCredentialDialog: ({ open, onStopOnChain }: { open: boolean; onStopOnChain: () => Promise<void> }) =>
    open ? (
      <button type="button" onClick={() => void onStopOnChain()}>
        Also stop on chain
      </button>
    ) : null,
}));
vi.mock("@/components/buyer-money/let-agent-pay-sheet", () => ({
  LetAgentPaySheet: ({ open, renew, purpose }: { open: boolean; renew: unknown; purpose?: string }) =>
    open ? <div data-testid="pay-sheet" data-renew={renew ? "yes" : "no"} data-purpose={purpose ?? ""} /> : null,
}));

import { AgentsView } from "./agents-view";
import { AGENTS_WITH_KEYS_KEY } from "@/components/buyer-money/use-agents";
import { demoAgentsWithKeys, withDemoKeys } from "@/libs/demo/demo-agent-health";

const FIRST = "11111111-1111-1111-1111-111111111111";
const OWNER = "22222222-2222-2222-2222-222222222222";
const FIRST_ACCOUNT = "eip155:46630:0x000000000000000000000000000000000E2e0002";
const OWNER_ACCOUNT = "eip155:46630:0x18103e1D79257c695B2FBbd4b346CD2Ba7927296";
const LIVE_KEY = "eip155:46630:0x76B98fD03eE16e2673532769891f1400b447d10C";
const OLD_KEY = "eip155:46630:0x5555555555555555555555555555555555551234";
const ASSET = "eip155:46630/erc20:0xDbbC";
const usdg = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });
const BUILTIN = { clientId: "https://mcp.example.test/oauth/clients/assay-mcp", name: "Assay app", registrableDomain: null, verified: false, paymentClient: true };

function grantRow(id: string, name: string, delegateAccount: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    agentId: OWNER,
    name,
    issuedVia: "OAUTH",
    oauthClient: BUILTIN,
    prefix: null,
    scopes: [],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    delegateAccount,
    delegateBoundAt: "2026-10-17T00:00:00Z",
    createdAt: "2026-10-17T00:00:00Z",
    ...patch,
  };
}
function onChain(delegate: string, validUntil = "2099-11-18T12:00:00.000Z") {
  return {
    delegate,
    maxVoucherAmount: usdg("500000"),
    maxPerWindow: usdg("5000000"),
    spentInWindow: usdg("0"),
    validUntil,
    status: "ACTIVE",
    unsettled: { count: 0, amount: usdg("0"), largest: usdg("0"), windowNeeds: usdg("0"), redeemableUntil: null },
  };
}

function renderView(liveValidUntil?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  // The other agent is listed first: its account must never sign for this agent's keys.
  client.setQueryData(AGENTS_WITH_KEYS_KEY, demoAgentsWithKeys({
    items: [
      { agentId: FIRST, label: "E2E-M2 agent", agentAccount: FIRST_ACCOUNT },
      { agentId: OWNER, label: "My agent", agentAccount: OWNER_ACCOUNT },
    ],
  }));
  client.setQueryData(AGENTS_WITH_KEYS_KEY, withDemoKeys({
    [FIRST]: [],
    [OWNER]: [
      grantRow("g-live", "Assay app on laptop", LIVE_KEY),
      grantRow("g-old", "Assay app on the old laptop", OLD_KEY, { revokedAt: "2026-10-18T00:00:00Z" }),
    ],
  }));
  client.setQueryData(["escrow-delegates"], {
    account: OWNER_ACCOUNT,
    delegates: [onChain(LIVE_KEY, liveValidUntil), onChain(OLD_KEY)],
    tightenDelaySeconds: 3600,
  });
  client.setQueryData(["escrow", null], {
    exists: true,
    readable: true,
    account: OWNER_ACCOUNT,
    maxVoucherAmount: usdg("1000000"),
    maxPerWindow: usdg("10000000"),
    withdrawRequested: usdg("0"),
    balance: usdg("20000000"),
  });
  client.setQueryData(["me", "status"], { blockStatus: null, unreadCount: null, debts: { account: OWNER_ACCOUNT, debts: [] } });
  client.setQueryData(["spend-policy"], null);
  client.setQueryData(["chains"], { chains: [] });
  return render(
    <QueryClientProvider client={client}>
      <AgentsView />
    </QueryClientProvider>,
  );
}

function ownerCard(): HTMLElement {
  return screen.getAllByTestId("agent-card").find((card) => card.textContent?.includes("Assay app on laptop"))!;
}

afterEach(() => {
  cleanup();
  stops.calls = [];
});

describe("stopping a payment key signs with the account of the agent that owns it (BUG-M3-01)", () => {
  it("Revoke → Also stop its payment key on chain: the owner's account, not the first agent's", async () => {
    renderView();
    fireEvent.click(within(ownerCard()).getByTestId("revoke-credential"));
    fireEvent.click(screen.getByRole("button", { name: "Also stop on chain" }));
    await waitFor(() => expect(stops.calls).toHaveLength(1));
    expect(stops.calls[0]).toEqual({ account: OWNER_ACCOUNT, delegate: LIVE_KEY });
  });

  it("Stop it on a revoked row: the sheet signs with the owner's account", () => {
    renderView();
    fireEvent.click(within(ownerCard()).getByTestId("stop-payment-key"));
    const sheet = screen.getByTestId("stop-sheet");
    expect(sheet.getAttribute("data-account")).toBe(OWNER_ACCOUNT);
    expect(sheet.getAttribute("data-delegate")).toBe(OLD_KEY);
  });
});

describe("Payment limits opens a sheet that matches the key's state (BUG-M3-03)", () => {
  it("on a fresh, active permission: its limits, never Renew", () => {
    renderView();
    fireEvent.click(within(ownerCard()).getByTestId("payment-limits"));
    const sheet = screen.getByTestId("pay-sheet");
    expect(sheet.getAttribute("data-renew")).toBe("yes");
    expect(sheet.getAttribute("data-purpose")).toBe("limits");
  });

  it("on a permission that ends within the warning period: Renew", () => {
    renderView(new Date(Date.now() + 2 * 86_400_000).toISOString());
    fireEvent.click(within(ownerCard()).getByTestId("payment-limits"));
    expect(screen.getByTestId("pay-sheet").getAttribute("data-purpose")).toBe("renew");
  });
});
