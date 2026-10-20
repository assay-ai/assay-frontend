import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/" }));

const AGENT = "11111111-1111-1111-1111-111111111111";
const ACCOUNT = "eip155:46630:0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1";
const usd = (amount: string) => ({ amount, decimals: 6, asset: "eip155:46630/erc20:0x915E" });

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const KEY = {
  id: "k1",
  agentId: AGENT,
  name: "Key 1",
  prefix: "assay_sk_live_ab12",
  scopes: [],
  lastUsedAt: "2026-10-18T00:00:00Z",
  expiresAt: null,
  revokedAt: null,
  delegateAccount: null,
  createdAt: "2026-10-17T00:00:00Z",
};

async function renderGetStarted(
  seed: (client: QueryClient) => void = () => undefined,
  placement: "overview" | "page" = "page",
) {
  const { GetStarted } = await import("./get-started");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["agents"], { items: [{ agentId: AGENT, label: "My agent", agentAccount: ACCOUNT }] });
  client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [KEY] });
  client.setQueryData(["escrow-delegates", "live"], { delegates: [] });
  client.setQueryData(["escrow", null], {
    exists: true,
    readable: true,
    account: ACCOUNT,
    maxVoucherAmount: usd("0"),
    maxPerWindow: usd("0"),
    withdrawRequested: usd("0"),
    balance: usd("5000000"),
    spendable: usd("5000000"),
  });
  client.setQueryData(["me", "status"], { blockStatus: null, unreadCount: null, debts: { account: ACCOUNT, debts: [] } });
  client.setQueryData(["spend-policy"], null);
  client.setQueryData(["chains"], { chains: [] });
  client.setQueryData(["catalogue", "providers"], { providers: [] });
  client.setQueryData(["catalogue", "tools"], { tools: [] });
  client.setQueryData(["tool-calls", "catalogue"], { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  seed(client);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <GetStarted placement={placement} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// The first test imports the whole Get started tree: give it time under a full run.
describe("Get started, step 4 by invitation (D14)", { timeout: 30_000 }, () => {
  it("reads All set for free calls after the key and the first call, with no deposit (review M1)", async () => {
    const out = text(
      await renderGetStarted((client) =>
        client.setQueryData(["escrow", null], { exists: false, readable: true, account: ACCOUNT, maxVoucherAmount: null, maxPerWindow: null, withdrawRequested: null }),
      ),
    );
    expect(out).toContain("All set: your agent can make free calls");
    expect(out).not.toMatch(/\d of \d/);
  });

  it("names funds and paying as optional while the first call is still awaited", async () => {
    const out = text(
      await renderGetStarted((client) => {
        client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [{ ...KEY, lastUsedAt: null }] });
        client.setQueryData(["escrow", null], { exists: false, readable: true, account: ACCOUNT, maxVoucherAmount: null, maxPerWindow: null, withdrawRequested: null });
      }),
    );
    expect(out).toContain("1 of 2");
    expect(out).toContain("Paid calls: by invitation during testnet");
    expect(out).toContain("Only needed for paid calls, which are by invitation during testnet.");
    expect(out.match(/Optional/g)?.length).toBe(2);
    expect(out).toContain("Free calls work after step 2. Paid calls are by invitation during testnet.");
  });

  it("offers Ask for access when this deployment has a support URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_URL", "mailto:help@example.com");
    vi.resetModules();
    const { PaidByInvitation } = await import("./get-started");
    const html = renderToStaticMarkup(<PaidByInvitation agentName="My agent" />);
    expect(html).toContain('href="mailto:help@example.com"');
    expect(text(html)).toContain("Ask for access");
    expect(text(html)).toContain("Invited already?");
  });

  it("never shows Ask for access with nowhere to go", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_URL", "");
    vi.resetModules();
    const { PaidByInvitation } = await import("./get-started");
    expect(text(renderToStaticMarkup(<PaidByInvitation agentName="My agent" />))).not.toContain("Ask for access");
  });
});

// V1-1: an agent that already pays must not flash "Let your agent pay" on Overview.
describe("Get started on Overview, an agent that already pays", { timeout: 30_000 }, () => {
  const DELEGATE = "eip155:46630:0x00000000000000000000000000000000000000d1";
  const bound = (client: QueryClient) => {
    client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [{ ...KEY, delegateAccount: DELEGATE }] });
    client.setQueryData(["escrow", null], {
      exists: true,
      readable: true,
      account: ACCOUNT,
      maxVoucherAmount: usd("1000000"),
      maxPerWindow: usd("5000000"),
      withdrawRequested: usd("0"),
      balance: usd("5000000"),
      spendable: usd("5000000"),
    });
  };
  const grant = {
    delegate: DELEGATE,
    maxVoucherAmount: usd("1000000"),
    maxPerWindow: usd("5000000"),
    spentInWindow: usd("0"),
    validUntil: "2099-01-01T00:00:00Z",
    status: "ACTIVE",
  };

  it("renders nothing while the pay permission is still being read", async () => {
    const html = await renderGetStarted((client) => {
      bound(client);
      client.removeQueries({ queryKey: ["escrow-delegates", "live"] });
    }, "overview");
    expect(html).toBe("");
  });

  it("renders nothing once the permission is read and every step is done", async () => {
    const html = await renderGetStarted((client) => {
      bound(client);
      client.setQueryData(["escrow-delegates", "live"], { delegates: [grant] });
    }, "overview");
    expect(html).toBe("");
  });

  it("still asks to let the agent pay when the read permission is not active", async () => {
    const out = text(
      await renderGetStarted((client) => {
        bound(client);
        client.setQueryData(["escrow-delegates", "live"], { delegates: [] });
      }, "overview"),
    );
    expect(out).toContain("Let your agent pay");
  });
});
