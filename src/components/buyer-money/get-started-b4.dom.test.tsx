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

async function renderGetStarted(seed: (client: QueryClient) => void = () => undefined) {
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
  client.setQueryData(["escrow", "debts"], { account: ACCOUNT, debts: [] });
  client.setQueryData(["spend-policy"], null);
  client.setQueryData(["chains"], { chains: [] });
  client.setQueryData(["catalogue", "providers"], { providers: [] });
  client.setQueryData(["catalogue", "tools"], { tools: [] });
  client.setQueryData(["tool-calls", "catalogue"], { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  seed(client);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <GetStarted placement="page" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

// The first test imports the whole Get started tree: give it time under a full run.
describe("Get started, step 4 by invitation (D14)", { timeout: 30_000 }, () => {
  it("does not hold the checklist open: key, call and funds done reads All set for free calls", async () => {
    const out = text(await renderGetStarted());
    expect(out).toContain("All set: your agent can make free calls");
    expect(out).not.toContain("3 of 4");
  });

  it("names the paid path plainly as step 4, optional, while other steps are open", async () => {
    const out = text(
      await renderGetStarted((client) =>
        client.setQueryData(["escrow", null], { exists: false, readable: true, account: ACCOUNT, maxVoucherAmount: null, maxPerWindow: null, withdrawRequested: null }),
      ),
    );
    expect(out).toContain("Paid calls: by invitation during testnet");
    expect(out).toContain("Optional");
    expect(out).toContain("2 of 3");
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
