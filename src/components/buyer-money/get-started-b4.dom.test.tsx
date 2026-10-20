import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENTS_WITH_KEYS_KEY } from "@/components/buyer-money/use-agents";
import { demoAgentsWithKeys, withDemoKeys } from "@/libs/demo/demo-agent-health";

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
  client.setQueryData(AGENTS_WITH_KEYS_KEY, demoAgentsWithKeys({ items: [{ agentId: AGENT, label: "My agent", agentAccount: ACCOUNT }] }));
  client.setQueryData(AGENTS_WITH_KEYS_KEY, withDemoKeys({ [AGENT]: [KEY] }));
  client.setQueryData(["escrow-delegates"], { delegates: [] });
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

  it("reads the key and the first call from the keys' health: a key past its expiry but not revoked still counts", async () => {
    const out = text(
      await renderGetStarted((client) => {
        client.setQueryData(AGENTS_WITH_KEYS_KEY, withDemoKeys({ [AGENT]: [{ ...KEY, expiresAt: "2026-10-18T01:00:00Z" }] }));
        client.setQueryData(["escrow", null], { exists: false, readable: true, account: ACCOUNT, maxVoucherAmount: null, maxPerWindow: null, withdrawRequested: null });
      }),
    );
    expect(out).toContain("All set: your agent can make free calls");
  });

  it("is not done while every key is revoked, whatever they did before", async () => {
    const out = text(
      await renderGetStarted((client) => {
        client.setQueryData(AGENTS_WITH_KEYS_KEY, withDemoKeys({ [AGENT]: [{ ...KEY, revokedAt: "2026-10-19T00:00:00Z" }] }));
        client.setQueryData(["escrow", null], { exists: false, readable: true, account: ACCOUNT, maxVoucherAmount: null, maxPerWindow: null, withdrawRequested: null });
      }),
    );
    expect(out).not.toContain("All set");
    expect(out).toContain("0 of 2");
  });

  it("names funds and paying as optional while the first call is still awaited", async () => {
    const out = text(
      await renderGetStarted((client) => {
        client.setQueryData(AGENTS_WITH_KEYS_KEY, withDemoKeys({ [AGENT]: [{ ...KEY, lastUsedAt: null }] }));
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
    client.setQueryData(AGENTS_WITH_KEYS_KEY, withDemoKeys({ [AGENT]: [{ ...KEY, delegateAccount: DELEGATE }] }));
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
      client.removeQueries({ queryKey: ["escrow-delegates"] });
    }, "overview");
    expect(html).toBe("");
  });

  it("renders nothing once the permission is read and every step is done", async () => {
    const html = await renderGetStarted((client) => {
      bound(client);
      client.setQueryData(["escrow-delegates"], { delegates: [grant] });
    }, "overview");
    expect(html).toBe("");
  });

  it("is about the agent that pays, not a first agent whose keys are all revoked", async () => {
    const OTHER = "22222222-2222-2222-2222-222222222222";
    const html = await renderGetStarted((client) => {
      bound(client);
      client.setQueryData(
        AGENTS_WITH_KEYS_KEY,
        demoAgentsWithKeys(
          {
            items: [
              { agentId: OTHER, label: "E2E-M2 agent", agentAccount: ACCOUNT },
              { agentId: AGENT, label: "My agent", agentAccount: ACCOUNT },
            ],
          },
          {
            [OTHER]: [{ ...KEY, id: "k0", agentId: OTHER, revokedAt: "2026-10-18T00:00:00Z" }],
            [AGENT]: [{ ...KEY, delegateAccount: DELEGATE }],
          },
        ),
      );
      client.setQueryData(["escrow-delegates"], { delegates: [grant] });
    }, "page");
    // Read off the first agent it said "free calls" only, as if nothing could pay.
    expect(text(html)).toContain("All set: your agent can call tools and pay for them");
  });

  it("still asks to let the agent pay when the read permission is not active", async () => {
    const out = text(
      await renderGetStarted((client) => {
        bound(client);
        client.setQueryData(["escrow-delegates"], { delegates: [] });
      }, "overview"),
    );
    expect(out).toContain("Let your agent pay");
  });
});
