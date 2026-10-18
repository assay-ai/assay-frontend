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

  it("states paid calls as by invitation when the agent has a key but no payment key (D14)", () => {
    const key = { id: "k1", agentId: AGENT, name: "Key 1", prefix: "assay_sk_live_ab12", scopes: [], lastUsedAt: null, expiresAt: null, revokedAt: null, delegateAccount: null, createdAt: "2026-10-17T00:00:00Z" };
    const out = text(render((client) => client.setQueryData(["agent-keys", [AGENT]], { [AGENT]: [key] })));
    expect(out).toContain("Paid calls are by invitation during testnet");
    expect(out).not.toContain("Needs authorisation");
  });
});
