import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AGENTS_WITH_KEYS_KEY } from "@/components/buyer-money/use-agents";
import { toolsetKeys } from "@/components/toolsets/use-toolsets";
import { demoAgentsWithKeys } from "@/libs/demo/demo-agent-health";

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true }),
  useWallets: () => ({ ready: true, wallets: [] }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/connect" }));

import { ConnectView } from "./connect-view";

const AGENT = "11111111-1111-1111-1111-111111111111";
const KEY = {
  id: "k1",
  agentId: AGENT,
  name: "Key 1",
  issuedVia: "API_KEY",
  oauthClient: null,
  hint: "assay_sk_live_…ab12",
  scopes: ["tools:call", "payments", "activity:read"],
  lastUsedAt: null as string | null,
  expiresAt: null as string | null,
  revokedAt: null as string | null,
  delegateAccount: null,
  createdAt: "2026-10-17T00:00:00Z",
};

const OTHER = "22222222-2222-2222-2222-222222222222";

function render(keys: unknown[], otherKeys?: unknown[]): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const agents = [{ agentId: AGENT, label: "My agent" }, ...(otherKeys ? [{ agentId: OTHER, label: "Other agent" }] : [])];
  client.setQueryData(AGENTS_WITH_KEYS_KEY, demoAgentsWithKeys({ items: agents }, { [AGENT]: keys, ...(otherKeys ? { [OTHER]: otherKeys } : {}) }));
  client.setQueryData(toolsetKeys.servers(AGENT), { servers: [] });
  client.setQueryData(toolsetKeys.all, { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(["spend-policy"], null);
  client.setQueryData(["catalogue", "providers"], { providers: [] });
  client.setQueryData(["catalogue", "tools"], { tools: [] });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ConnectView />
    </QueryClientProvider>,
  );
}

describe("Connect's 'Is it working?', from the agents' key health", { timeout: 30_000 }, () => {
  it("waits while no key that is not revoked has been used", () => {
    const html = render([KEY, { ...KEY, id: "k0", lastUsedAt: "2026-10-18T00:00:00Z", revokedAt: "2026-10-18T01:00:00Z" }]);
    expect(html).toContain('data-testid="connect-waiting"');
    expect(html).not.toContain('data-testid="connect-working"');
  });

  it("says connected once a key that is not revoked was used, expired or not", () => {
    const html = render([{ ...KEY, lastUsedAt: "2026-10-18T00:00:00Z", expiresAt: "2026-10-18T02:00:00Z" }]);
    expect(html).toContain('data-testid="connect-working"');
    expect(html).toContain("Key 1");
  });

  it("is about the first agent only: another agent's used key does not say connected", () => {
    const html = render([KEY], [{ ...KEY, id: "k9", agentId: OTHER, name: "Other key", hint: "assay_sk_live_…zz99", lastUsedAt: "2026-10-18T00:00:00Z" }]);
    expect(html).toContain('data-testid="connect-waiting"');
    expect(html).not.toContain("Other key");
    expect(html).not.toContain("assay_sk_live_zz99");
  });
});
