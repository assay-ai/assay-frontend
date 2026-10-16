import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FullBalance } from "@/features/g30/balance";
import type { Chain } from "@/interfaces/chain";
import { freeCallsOnlyText, railNotOfferedText, servesPaidCalls } from "@/libs/chains/paid-rails";

/*
  Equivalents of main's Solana free-only tests (balance-cards.dom.test.tsx and
  settlement-asset.test.ts), which went with the retired balance cards: the
  same facts, on the screens that say them now.
*/
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

import { AccountBalances } from "./funding-view";

const SOLANA: Chain = {
  chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  namespace: "solana",
  displayName: "Solana devnet",
  explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
  settlementAsset: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMM",
  settlementSymbol: "USDC",
} as Chain;
const EVM: Chain = {
  chainId: "eip155:46630",
  namespace: "eip155",
  displayName: "Robinhood Chain testnet",
  explorerBaseUrl: "https://explorer.testnet.chain.robinhood.com",
  settlementAsset: "eip155:46630/erc20:0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec",
  settlementSymbol: "USDG",
} as Chain;

const row = (chain: Chain, account: string): FullBalance =>
  ({
    chainId: chain.chainId,
    accountId: `${chain.chainId}:${account}`,
    asset: chain.settlementAsset,
    available: { amount: "5000000", asset: chain.settlementAsset, decimals: 6 },
    held: { amount: "0", asset: chain.settlementAsset, decimals: 6 },
  }) as unknown as FullBalance;

describe("Solana serves free calls only", () => {
  it("is told apart from a paid chain by namespace", () => {
    expect(servesPaidCalls(SOLANA.chainId)).toBe(false);
    expect(servesPaidCalls("solana:anything")).toBe(false);
    expect(servesPaidCalls(EVM.chainId)).toBe(true);
  });

  it("says so in one sentence, naming the chain", () => {
    expect(freeCallsOnlyText("Solana devnet")).toBe(
      "Solana devnet currently serves free calls only. Paid calls are not offered on it, so money in escrow there is not spent on calls.",
    );
    expect(railNotOfferedText(null)).toMatch(/^This chain currently serves free calls only/);
  });

  it("marks a Solana balance as not spent on calls, and an EVM one not", () => {
    const html = renderToStaticMarkup(
      <AccountBalances
        balances={[row(SOLANA, "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"), row(EVM, "0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1")]}
        chains={[SOLANA, EVM]}
      />,
    );
    const items = html.split("<li").slice(1);
    const solana = items.find((item) => item.includes("Solana devnet"))!;
    const evm = items.find((item) => item.includes("Robinhood Chain testnet"))!;
    expect(solana).toContain("free calls only here, so it is not spent on calls");
    expect(evm).not.toContain("free calls only");
  });
});
