import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Chain } from "@/interfaces/chain";

// The demo's `?rails=free-only` switch, flipped per test.
const demoRails = vi.hoisted(() => ({ freeOnly: false }));
vi.mock("@/libs/demo/demo-switches", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/libs/demo/demo-switches")>()),
  demoFreeOnlyChain: () => demoRails.freeOnly,
}));

vi.mock("@/hooks/useSigner", () => ({
  useSigner: () => ({ status: "hydrating" }),
  isUserRejection: () => false,
}));

import { LimitsView } from "./limits-view";
import { AGENTS_WITH_KEYS_KEY } from "@/components/buyer-money/use-agents";
import { demoAgentsWithKeys, withDemoKeys } from "@/libs/demo/demo-agent-health";

const EVM = "eip155:46630";

const CHAINS: Chain[] = [
  {
    chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    namespace: "solana",
    displayName: "Solana devnet",
    explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
    settlementAsset: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMM",
    settlementAssetSymbol: "USDC",
    decimals: 6,
  },
  {
    chainId: EVM,
    namespace: "eip155",
    displayName: "Robinhood Chain testnet",
    explorerBaseUrl: "https://explorer.testnet.chain.robinhood.com",
    settlementAsset: `${EVM}/erc20:0xDbbC`,
    settlementAssetSymbol: "USDG",
    decimals: 6,
  },
];

const ACCOUNT = `${EVM}:0x1810aa`;
const DELEGATE = `${EVM}:0xd31e9a7e00000000000000000000000000000001`;
const usd = (major: string) => ({ amount: String(Math.round(Number(major) * 1_000_000)), asset: `${EVM}/erc20:0xDbbC`, decimals: 6 });

function markup(policy: Record<string, unknown> | null, { granted = true }: { granted?: boolean } = {}): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["spend-policy"], policy);
  client.setQueryData(["spend-policy-history"], { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(AGENTS_WITH_KEYS_KEY, demoAgentsWithKeys({
    items: [{ agentId: "f64b7b6e", label: "prod", agentAccount: ACCOUNT, chainId: EVM }],
    pageInfo: { nextCursor: null, hasMore: false },
  }));
  client.setQueryData(AGENTS_WITH_KEYS_KEY, withDemoKeys({
    f64b7b6e: [
      {
        id: "k1",
        agentId: "f64b7b6e",
        name: "orchestrator",
        prefix: "assay_sk_live_31ac",
        scopes: ["tools:call", "payments", "activity:read"],
        lastUsedAt: new Date().toISOString(),
        expiresAt: null,
        revokedAt: null,
        delegateAccount: DELEGATE,
        delegateBoundAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      },
    ],
  }));
  client.setQueryData(["escrow", null], {
    exists: true,
    chainReadable: true,
    account: ACCOUNT,
    escrowPda: null,
    escrowTokenAccount: null,
    balance: usd("500"),
    openHolds: usd("17.85"),
    spendable: usd("482.15"),
    withdrawRequested: usd("0"),
    withdrawAvailableAt: null,
    serverTime: new Date().toISOString(),
    maxVoucherAmount: usd("10"),
    maxPerWindow: usd("120"),
    spentInWindow: usd("15.75"),
    windowStartedAt: new Date().toISOString(),
    windowSeconds: 86400,
    observedAt: new Date().toISOString(),
  });
  client.setQueryData(["escrow-delegates"], {
    account: ACCOUNT,
    delegates: !granted ? [] : [
      {
        delegate: DELEGATE,
        maxVoucherAmount: usd("2"),
        maxPerWindow: usd("40"),
        spentInWindow: usd("15.75"),
        validUntil: new Date(Date.now() + 86_400_000 * 20).toISOString(),
        status: "ACTIVE",
      },
    ],
  });
  client.setQueryData(["chains"], { chains: CHAINS });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <LimitsView />
    </QueryClientProvider>,
  );
}

const POLICY = {
  id: "sp",
  scope: "AGENT",
  agentId: "f64b7b6e",
  policyVersion: 1,
  asset: `${EVM}/erc20:0xDbbC`,
  decimals: 6,
  perCallMax: null,
  dailyCap: null,
  monthlyCap: usd("900"),
  maxCallsPerHour: null,
  maxCallsPerMinute: null,
  maxSpendPerHour: null,
  requireApprovalAbove: null,
  paused: false,
  changedBy: null,
  changeReason: null,
  createdAt: new Date().toISOString(),
};

describe("LimitsView (Spending limits) — two layers, one effective limit per agent", () => {
  it("names what binds, offers one Change spending limits, and shows the account ceiling apart", () => {
    const html = markup(POLICY);
    expect(html).toContain("Spending limits");
    expect(html).toContain("Effective limit");
    expect(html).toContain("$2.00 a call</span> — set by this agent&#x27;s spending limit");
    expect(html).toContain("$900.00 a month");
    expect(html).toContain("Change spending limits");
    expect(html).toContain("Account ceiling");
    expect(html).toContain("Change account ceiling");
    expect(html).not.toContain("Change caps");
    expect(html).not.toContain("older rule");
  });

  it("keeps the space after each bold lead-in (retest 2026-10-16b read \"On chain:your account\")", () => {
    const html = markup(POLICY);
    expect(html).toContain("On chain:</span> your account ceiling");
    expect(html).toContain("Checked by Assay:</span> the monthly limit");
    expect(html).toContain("Every limit stops calls.</span> A call over");
    expect(html).not.toMatch(/:<\/span>[A-Za-z]/);
  });

  it("shows the older refuse-above rule only while it is set, with a way to remove it", () => {
    const html = markup({ ...POLICY, requireApprovalAbove: usd("25") });
    expect(html).toContain("Older rules still checked");
    expect(html).toContain("For every agent: any single call above $25.00 is refused.");
    expect(html).toContain("Remove it");
  });

  // review 2026-10-17: free-only /limits still listed "Older rules" with $ per-call caps.
  it("hides the older paid-call rules on a free-calls-only chain, like the ceiling and the agent's limits", () => {
    demoRails.freeOnly = true;
    try {
      const html = markup({ ...POLICY, requireApprovalAbove: usd("25"), perCallMax: usd("10"), dailyCap: usd("75") });
      expect(html).toContain('data-testid="ceiling-free-only"');
      expect(html).not.toContain("old-rule-line");
      expect(html).not.toContain("Older rules still checked");
      expect(html).not.toContain("$25.00");
      // The explanation says limits and Pause all do not apply, not how they stop a paid call.
      expect(html).toContain("Spending limits and Pause all stop paid calls, so they do");
      expect(html).not.toContain("Checked by Assay:");
      // Nothing to let an agent pay for there (Chrome test 2026-10-17).
      expect(markup(POLICY, { granted: false })).not.toContain("Let it pay");
      // Nor any limits to change: they count no call there (Chrome test 2026-10-17, final2).
      expect(html).not.toContain("Change spending limits");
      expect(markup(POLICY, { granted: false })).not.toContain("Change spending limits");
    } finally {
      demoRails.freeOnly = false;
    }
  });

  it("offers Let it pay to an agent with no grant on a chain that serves paid calls", () => {
    expect(markup(POLICY, { granted: false })).toContain("Let it pay");
  });

  // BUG-J-BUY-01: a first policy must be creatable from the UI.
  it("still lets an account with no Assay policy yet open its agent's spending limits", () => {
    const html = markup(null);
    expect(html).toContain("Change spending limits");
    expect(html).not.toContain("policy-bootstrap-note");
  });
});
