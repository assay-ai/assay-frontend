import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Chain } from "@/interfaces/chain";

vi.mock("@/hooks/useSigner", () => ({
  useSigner: () => ({ status: "hydrating" }),
  isUserRejection: () => false,
}));

import { AgentPaymentDelegation, PayerDelegationsPanel } from "./agent-payment-delegation";

const EVM = "eip155:46630";
const ASSET = `${EVM}/erc20:0xDbbC`;
const PAYER = `${EVM}:0x18103e1D79257c695B2FBbd4b346CD2Ba7927296`;
const DELEGATE = `${EVM}:0x76B98fD03eE16e2673532769891f1400b447d10C`;
const usdg = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });

const CHAINS: Chain[] = [
  {
    chainId: EVM,
    namespace: "eip155",
    displayName: "Robinhood Chain testnet",
    explorerBaseUrl: "https://explorer.testnet.chain.robinhood.com",
    settlementAsset: ASSET,
    settlementAssetSymbol: "USDG",
    decimals: 6,
  },
];

/** The grant the e2e run left: 0.5 a payment / 2 a window; escrow limits as given. */
function client(escrowMaxVoucher: string): QueryClient {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  c.setQueryData(["chains"], { chains: CHAINS });
  c.setQueryData(["escrow", EVM], {
    escrowPda: `${EVM}:0x1D2625efD87c2fc10b8563f3F0890072845Fcf41`,
    serverTime: "2026-10-12T12:00:00.000Z",
    maxVoucherAmount: usdg(escrowMaxVoucher),
    maxPerWindow: usdg("10000000"),
  });
  c.setQueryData(["escrow-delegates", 0], {
    account: PAYER,
    delegates: [
      {
        delegate: DELEGATE,
        maxVoucherAmount: usdg("500000"),
        maxPerWindow: usdg("2000000"),
        spentInWindow: usdg("1436032"),
        validUntil: "2026-11-11T12:33:36.000Z",
        status: "ACTIVE",
        unsettled: {
          count: 1,
          amount: usdg("100000"),
          largest: usdg("100000"),
          windowNeeds: usdg("1536032"),
          redeemableUntil: "2026-10-12T12:34:00.000Z",
        },
      },
    ],
  });
  return c;
}

function render(node: React.ReactElement, escrowMaxVoucher = "1000000"): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={client(escrowMaxVoucher)}>{node}</QueryClientProvider>,
  );
}

const credential = {
  id: "1c8f3441-54cf-4562-a7f3-e8fbcd5b2050",
  name: "e2e-agent",
  revokedAt: null,
  delegateAccount: DELEGATE,
  delegateBoundAt: "2026-10-12T08:16:00.000Z",
};

describe("PayerDelegationsPanel", () => {
  // BUG-D1-04: an authorised key showed only "Revoke"; changing its caps took a
  // revoke and a new grant (two signatures, no authority in between).
  it("offers Change spending limits beside Stop it paying on a standing grant", () => {
    const html = render(
      <PayerDelegationsPanel account={PAYER} bindings={[]} version={0} onChanged={() => {}} />,
    );
    expect(html).toContain('data-testid="edit-delegate"');
    expect(html).toContain("Change spending limits");
    expect(html).toContain('data-testid="revoke-delegate"');
  });

  // BUG-D1-03: with the escrow lowered to 0.05 a payment, the grant still read
  // "up to 0.500000 USDG a payment" and nothing said payments above 0.05 fail.
  it("warns when the escrow's own limit is now below the grant's cap", () => {
    const lowered = render(
      <PayerDelegationsPanel account={PAYER} bindings={[]} version={0} onChanged={() => {}} />,
      "50000",
    );
    expect(lowered).toContain('data-testid="delegate-above-escrow-limits"');
    expect(lowered).toContain("$0.05 a payment");

    const fine = render(
      <PayerDelegationsPanel account={PAYER} bindings={[]} version={0} onChanged={() => {}} />,
    );
    expect(fine).not.toContain("delegate-above-escrow-limits");
  });
});

describe("PayerDelegationsPanel — payments still being settled (BUG-D1-07)", () => {
  it("lists them on the grant they will be redeemed under", () => {
    const html = render(
      <PayerDelegationsPanel account={PAYER} bindings={[]} version={0} onChanged={() => {}} />,
    );
    expect(html).toContain('data-testid="delegate-unsettled"');
    expect(html).toContain("1 payment ($0.10) still being settled");
  });
});

describe("AgentPaymentDelegation", () => {
  it("offers Change spending limits on a key that can pay", () => {
    const html = render(
      <AgentPaymentDelegation
        agentAccount={PAYER}
        credentials={[credential]}
        version={0}
        onChanged={() => {}}
      />,
    );
    expect(html).toContain("CAN PAY");
    expect(html).toContain('data-testid="edit-agent-delegate"');
  });
});

// Paid rails A and B are off on Solana: nothing to authorise, and the agent is told why.
describe("AgentPaymentDelegation — a Solana agent (free calls only)", () => {
  it("says the chain serves free calls only and offers nothing to sign", () => {
    const html = render(
      <AgentPaymentDelegation
        agentAccount="solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:AgentAccount1111111111111111111111111111111"
        credentials={[]}
        version={0}
        onChanged={() => {}}
      />,
    );
    expect(html).toContain('data-testid="agent-payment-free-only"');
    expect(html).toContain("currently serves free calls only");
    expect(html).not.toContain("Authorize agent to pay");
  });
});
