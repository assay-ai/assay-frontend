import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

import { AgentsView } from "./agents-view";

const AGENT = "11111111-1111-1111-1111-111111111111";
const ACCOUNT = "eip155:46630:0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1";

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

function render(seed: (client: QueryClient) => void = () => undefined): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["agents"], { items: [{ agentId: AGENT, label: "My agent", agentAccount: ACCOUNT }] });
  client.setQueryData(["escrow-delegates", "live"], { delegates: [] });
  client.setQueryData(["escrow", null], { exists: false, readable: true, account: ACCOUNT });
  client.setQueryData(["escrow", "debts"], { account: ACCOUNT, debts: [] });
  client.setQueryData(["spend-policy"], null);
  client.setQueryData(["chains"], { chains: [] });
  seed(client);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AgentsView />
    </QueryClientProvider>,
  );
}

describe("the agent card while its keys load", () => {
  it("is a skeleton, never 'No key'", () => {
    const html = render();
    const out = text(html);
    expect(html).toContain('data-testid="agent-card-loading"');
    expect(out).not.toMatch(/no key/i);
    expect(out).not.toContain("Create a key first");
    expect(out).toContain("My agent");
  });

  it("says No key only once the keys are read and there are none, with Rename in place", () => {
    const html = render((client) => client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [] }));
    const out = text(html);
    expect(html).toContain('data-testid="agent-card"');
    expect(out).toContain("No key");
    expect(html).toContain('data-testid="rename-agent"');
  });

  it("on a failed keys read, says so with Retry, never No key or Create a key first (review m1)", async () => {
    // No refetch on mount: the render shows the failed read as it stands.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, refetchOnMount: false } } });
    client.setQueryData(["agents"], { items: [{ agentId: AGENT, label: "My agent", agentAccount: ACCOUNT }] });
    client.setQueryData(["escrow-delegates", "live"], { delegates: [] });
    client.setQueryData(["escrow", null], { exists: false, readable: true, account: ACCOUNT });
    client.setQueryData(["escrow", "debts"], { account: ACCOUNT, debts: [] });
    client.setQueryData(["spend-policy"], null);
    client.setQueryData(["chains"], { chains: [] });
    // A keys read that failed: the query's cache entry is in error.
    await client.prefetchQuery({ queryKey: ["agent-keys", [AGENT]], queryFn: () => Promise.reject(new Error("down")), retry: false });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <AgentsView />
      </QueryClientProvider>,
    );
    const out = text(html);
    expect(html).toContain('data-testid="keys-unreadable"');
    expect(out).toContain("Retry");
    expect(out).not.toMatch(/no live key|no key|create a key first/i);
    expect(out).not.toContain("Payment key");
  });

  it("states paid calls as by invitation when the agent has a key but no payment key (D14)", () => {
    const key = { id: "k1", agentId: AGENT, name: "Key 1", issuedVia: "API_KEY", oauthClient: null, prefix: "assay_sk_live_ab12", scopes: [], lastUsedAt: null, expiresAt: null, revokedAt: null, delegateAccount: null, createdAt: "2026-10-17T00:00:00Z" };
    const out = text(render((client) => client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [key] })));
    expect(out).toContain("Paid calls are by invitation during testnet");
    expect(out).not.toContain("Needs authorisation");
  });

  it("labels an OAuth grant (null prefix) by its app, never 'null…'", () => {
    const base = { agentId: AGENT, scopes: [], lastUsedAt: null, expiresAt: null, revokedAt: null, delegateAccount: null, createdAt: "2026-10-17T00:00:00Z" };
    const named = { ...base, id: "g1", name: "Claude Code · 2026-10-17", issuedVia: "OAUTH", prefix: null, oauthClient: THIRD_PARTY };
    const out = text(render((client) => client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [named] })));
    expect(out).toContain("Signed in from Claude Code (claude.ai) · free tools only");
    expect(out).not.toContain("null");
  });
});

const DELEGATE_A = "eip155:46630:0x76B98fD03eE16e2673532769891f1400b447d10C";
const DELEGATE_B = "eip155:46630:0x5555555555555555555555555555555555551234";
const ASSET = "eip155:46630/erc20:0xDbbC";
const usdg = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });
const BUILTIN = {
  clientId: "https://mcp.example.test/oauth/clients/assay-mcp",
  name: "Assay app",
  registrableDomain: null,
  verified: false,
  paymentClient: true,
};
const THIRD_PARTY = {
  clientId: "https://claude.ai/oauth/mcp-client.json",
  name: "Claude Code",
  registrableDomain: "claude.ai",
  verified: true,
  paymentClient: false,
};
function grantRow(id: string, name: string, delegateAccount: string | null, patch: Record<string, unknown> = {}) {
  return {
    id,
    agentId: AGENT,
    name,
    issuedVia: "OAUTH",
    oauthClient: BUILTIN,
    prefix: null,
    scopes: [],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    delegateAccount,
    delegateBoundAt: delegateAccount ? "2026-10-17T00:00:00Z" : null,
    createdAt: "2026-10-17T00:00:00Z",
    ...patch,
  };
}
function onChain(delegate: string) {
  return {
    delegate,
    maxVoucherAmount: usdg("500000"),
    maxPerWindow: usdg("5000000"),
    spentInWindow: usdg("0"),
    validUntil: "2099-11-18T12:00:00.000Z",
    status: "ACTIVE",
    unsettled: { count: 0, amount: usdg("0"), largest: usdg("0"), windowNeeds: usdg("0"), redeemableUntil: null },
  };
}

describe("Agents & keys rows (spec §9.2, F3 step 5)", () => {
  it("revoked row with active key shows Stop it", () => {
    const revoked = grantRow("g-old", "Assay app on the old laptop", DELEGATE_A, { revokedAt: "2026-10-18T00:00:00Z" });
    const html = render((client) => {
      client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [revoked] });
      client.setQueryData(["escrow-delegates", "live"], { account: ACCOUNT, delegates: [onChain(DELEGATE_A)], tightenDelaySeconds: 3600 });
    });
    const out = text(html);
    // Never folded away under "Show revoked": a key is never stranded (IM-11).
    expect(out).toContain("Assay app on the old laptop");
    expect(out).toContain("Payment key still active on chain");
    expect(html).toContain('data-testid="stop-payment-key"');
    expect(out).toMatch(/Stop it\b/);
  });

  it("a revoked row whose key is not active on chain offers no Stop it", () => {
    const revoked = grantRow("g-old", "Assay app on the old laptop", DELEGATE_A, { revokedAt: "2026-10-18T00:00:00Z" });
    const html = render((client) => {
      client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [revoked] });
      client.setQueryData(["escrow-delegates", "live"], { account: ACCOUNT, delegates: [], tightenDelaySeconds: 3600 });
    });
    expect(html).not.toContain('data-testid="stop-payment-key"');
    expect(text(html)).not.toContain("still active on chain");
  });

  it("two machine profiles → two rows each with own Revoke", () => {
    const a = grantRow("g-a", "Assay app on laptop-a", DELEGATE_A);
    const b = grantRow("g-b", "Assay app on laptop-b", DELEGATE_B);
    const html = render((client) => {
      client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [a, b] });
      client.setQueryData(["escrow-delegates", "live"], {
        account: ACCOUNT,
        delegates: [onChain(DELEGATE_A), onChain(DELEGATE_B)],
        tightenDelaySeconds: 3600,
      });
    });
    const out = text(html);
    expect(html.match(/data-testid="credential-row"/g)).toHaveLength(2);
    expect(html.match(/data-testid="revoke-credential"/g)).toHaveLength(2);
    expect(html.match(/data-testid="edit-access"/g)).toHaveLength(2);
    expect(html.match(/data-testid="payment-limits"/g)).toHaveLength(2);
    expect(out).toContain("Assay app on laptop-a");
    expect(out).toContain("Assay app on laptop-b");
    // Each with its own payment key.
    expect(out).toContain("Payment key B447 D10C · on · $0.50 a call · $5 per 24 h");
    expect(out).toContain("Payment key 5555 1234 · on · $0.50 a call · $5 per 24 h");
    expect(out.match(/Signed in from Assay app \(assay-mcp\)/g)).toHaveLength(2);
  });

  it("a third-party grant gets no Payment limits button", () => {
    const row = grantRow("g-c", "Claude Code · Oct 19", null, { oauthClient: THIRD_PARTY });
    const html = render((client) => client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [row] }));
    expect(html).toContain('data-testid="revoke-credential"');
    expect(html).toContain('data-testid="edit-access"');
    expect(html).not.toContain('data-testid="payment-limits"');
  });

  it("a revoked row with a bound key while the chain read is pending: in view, may still be active, never stopped", () => {
    const revoked = grantRow("g-old", "Assay app on the old laptop", DELEGATE_A, { revokedAt: "2026-10-18T00:00:00Z" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, refetchOnMount: false } } });
    client.setQueryData(["agents"], { items: [{ agentId: AGENT, label: "My agent", agentAccount: ACCOUNT }] });
    client.setQueryData(["escrow", null], { exists: false, readable: true, account: ACCOUNT });
    client.setQueryData(["escrow", "debts"], { account: ACCOUNT, debts: [] });
    client.setQueryData(["spend-policy"], null);
    client.setQueryData(["chains"], { chains: [] });
    client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [revoked] });
    // No ["escrow-delegates", "live"]: the chain read has not answered.
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <AgentsView />
      </QueryClientProvider>,
    );
    const out = text(html);
    expect(html).toContain('data-testid="stranded-credential-row"');
    expect(out).toContain("Assay app on the old laptop");
    expect(out).toContain("Payment key: may still be active on chain (couldn't check)");
    expect(out).not.toMatch(/Show \d+ revoked/);
    expect(out).not.toContain("free tools only");
  });

  it("a revoked row with a bound key when the chain read failed: in view, may still be active, Check again", async () => {
    const revoked = grantRow("g-old", "Assay app on the old laptop", DELEGATE_A, { revokedAt: "2026-10-18T00:00:00Z" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, refetchOnMount: false } } });
    client.setQueryData(["agents"], { items: [{ agentId: AGENT, label: "My agent", agentAccount: ACCOUNT }] });
    client.setQueryData(["escrow", null], { exists: false, readable: true, account: ACCOUNT });
    client.setQueryData(["escrow", "debts"], { account: ACCOUNT, debts: [] });
    client.setQueryData(["spend-policy"], null);
    client.setQueryData(["chains"], { chains: [] });
    client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [revoked] });
    await client.prefetchQuery({ queryKey: ["escrow-delegates", "live"], queryFn: () => Promise.reject(new Error("rpc down")), retry: false });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <AgentsView />
      </QueryClientProvider>,
    );
    const out = text(html);
    expect(html).toContain('data-testid="stranded-credential-row"');
    expect(out).toContain("Payment key: may still be active on chain (couldn't check)");
    expect(html).toContain('data-testid="check-chain-again"');
    expect(out).not.toMatch(/Show \d+ revoked/);
  });

  it("two machine profiles, key A expired and key B active: the agent can pay, and each key has its own section", () => {
    const a = grantRow("g-a", "Assay app on laptop-a", DELEGATE_A);
    const b = grantRow("g-b", "Assay app on laptop-b", DELEGATE_B);
    const html = render((client) => {
      client.setQueryData(["escrow", null], {
        exists: true,
        readable: true,
        account: ACCOUNT,
        maxVoucherAmount: usdg("1000000"),
        maxPerWindow: usdg("10000000"),
        withdrawRequested: usdg("0"),
        balance: usdg("20000000"),
      });
      client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [a, b] });
      client.setQueryData(["escrow-delegates", "live"], {
        account: ACCOUNT,
        delegates: [
          { ...onChain(DELEGATE_A), status: "EXPIRED", validUntil: "2026-10-01T00:00:00.000Z" },
          { ...onChain(DELEGATE_B), spentInWindow: usdg("1250000") },
        ],
        tightenDelaySeconds: 3600,
      });
    });
    const out = text(html);
    // The agent pays through B: nothing says paid calls are refused for the agent.
    expect(out).not.toContain("Its permission to pay has expired");
    expect(out).not.toContain("so paid calls are refused");
    expect(out).toMatch(/Ready to pay|Working: it is calling tools/);
    // One block per key, each with its own fingerprint.
    expect(html.match(/data-testid="spending-block"/g)).toHaveLength(2);
    expect(out).toContain("Key “Assay app on laptop-a” · B447 D10C");
    expect(out).toContain("Key “Assay app on laptop-b” · 5555 1234");
    expect(out).toContain("This key's permission to pay expired, so it cannot pay.");
    // B's own spend and its own Stop it paying.
    expect(out).toContain("Spent by this key in the last 24 hours");
    expect(out).toContain("$1.25");
    expect(out.match(/Stop it paying/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("an expired grant is never the agent's paying key", () => {
    const a = grantRow("g-a", "Assay app on laptop-a", DELEGATE_A, { expiresAt: "2026-10-01T00:00:00Z" });
    const b = grantRow("g-b", "Assay app on laptop-b", DELEGATE_B);
    const html = render((client) => {
      client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [a, b] });
      client.setQueryData(["escrow-delegates", "live"], {
        account: ACCOUNT,
        delegates: [onChain(DELEGATE_A), onChain(DELEGATE_B)],
        tightenDelaySeconds: 3600,
      });
    });
    const out = text(html);
    // A is signed out: its key, still active on chain, is offered Stop it; B's section is the only one.
    expect(html).toContain('data-testid="stop-payment-key"');
    expect(html.match(/data-testid="spending-block"/g)).toHaveLength(1);
    expect(out).toContain("on key “Assay app on laptop-b”");
  });
});
