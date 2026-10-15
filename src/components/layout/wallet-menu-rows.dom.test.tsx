import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FullBalance } from "@/features/g30/balance";
import type { Chain } from "@/interfaces/chain";

/*
  This suite exists because of a measured miss on a sibling file.

  Batch B changed `rows.length === 0` to `!rows` in `close-account-view.tsx` —
  an array is always truthy — and it deleted the "Withdrawable balance" blocker
  row from the rendered page while 213 tests, `tsc --noEmit` and a 56/56 build
  all stayed green. Only a browser showed it. `BalanceRows` below carries the
  identical guard, and `WalletChainRows` is new rendering with no browser
  route: the menu opens only behind an authenticated Privy session.

  The Privy modules are replaced with recorders so the REAL `useSigner` runs —
  the same shape `useSigner.test.ts` uses. Rendering a presentational shim
  instead would test a component the menu does not have.
*/
const privySolana = vi.hoisted(() => ({
  wallets: [] as Array<{ address: string; standardWallet: unknown }>,
}));
const privyEvm = vi.hoisted(() => ({
  wallets: [] as Array<{ address: string; walletClientType: string }>,
}));

vi.mock("@privy-io/react-auth/solana", () => ({
  useWallets: () => ({ ready: true, wallets: privySolana.wallets }),
  useSignMessage: () => ({ signMessage: async () => ({ signature: new Uint8Array() }) }),
  useSignTransaction: () => ({
    signTransaction: async () => ({ signedTransaction: new Uint8Array() }),
  }),
  useSignAndSendTransaction: () => ({
    signAndSendTransaction: async () => ({ signature: new Uint8Array() }),
  }),
}));

vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ ready: true, wallets: privyEvm.wallets }),
  useSignMessage: () => ({ signMessage: async () => ({ signature: "0x" }) }),
  useSignTypedData: () => ({ signTypedData: async () => ({ signature: "0x" }) }),
  useSignTransaction: () => ({ signTransaction: async () => ({ signature: "0x" }) }),
}));

import { BalanceRows, WalletChainRows, balanceRowLabel } from "./wallet-menu-rows";

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM = "eip155:46630";

const SOLANA_ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const EVM_ADDRESS = "0x83ab1234567890abcdef1234567890abcdef2913";

const CHAINS: Chain[] = [
  {
    chainId: SOLANA,
    namespace: "solana",
    displayName: "Solana devnet",
    explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
    settlementAsset: `${SOLANA}/token:4zMM`,
    settlementAssetSymbol: "USDC",
    decimals: 6,
  },
  {
    chainId: EVM,
    namespace: "eip155",
    displayName: "Robinhood Chain testnet",
    explorerBaseUrl: "https://testnet-explorer.example",
    settlementAsset: `${EVM}/erc20:0xa0b8`,
    settlementAssetSymbol: "USDG",
    decimals: 6,
  },
];

const SOLANA_ROW: FullBalance = {
  chainId: SOLANA,
  accountId: `${SOLANA}:AgentAccount1111111111111111111111111111111`,
  asset: `${SOLANA}/token:4zMM`,
  decimals: 6,
  available: { amount: "12500000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
  held: { amount: "300000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
  /* A readable chain. Stated, never defaulted — see `FullBalance.chainReadable`. */
  chainReadable: true,
};

const EVM_ROW: FullBalance = {
  chainId: EVM,
  accountId: `${EVM}:${EVM_ADDRESS}`,
  asset: `${EVM}/erc20:0xa0b8`,
  decimals: 6,
  available: { amount: "4000000", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
  held: { amount: "0", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
  /* A readable chain. Stated, never defaulted — see `FullBalance.chainReadable`. */
  chainReadable: true,
};

describe("WalletChainRows", () => {
  beforeEach(() => {
    privySolana.wallets = [];
    privyEvm.wallets = [];
  });

  it("renders a row per chain with its own explorer link, and never one 'your wallet'", () => {
    privySolana.wallets = [{ address: SOLANA_ADDRESS, standardWallet: { isPrivyWallet: true } }];
    privyEvm.wallets = [{ address: EVM_ADDRESS, walletClientType: "privy" }];

    const html = renderToStaticMarkup(<WalletChainRows chains={CHAINS} />);

    expect(html.match(/data-testid="wallet-row"/g)).toHaveLength(2);
    // Chain-aware shortening: four hex characters after 0x, not two.
    expect(html).toContain("0x83ab…2913");
    expect(html).toContain("7xKX…gAsU");
    // Each link goes to ITS OWN explorer, and the Solana one keeps its cluster.
    expect(html).toContain(
      "https://explorer.solana.com/address/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU?cluster=devnet",
    );
    expect(html).toContain(
      "https://testnet-explorer.example/address/0x83ab1234567890abcdef1234567890abcdef2913",
    );
    // Assert the loser: no single collapsed label.
    expect(html.toLowerCase()).not.toContain("your wallet");
    // …and neither address is rendered inside the other chain's row.
    const [, solanaRow, evmRow] = html.split('data-testid="wallet-row"');
    expect(solanaRow).toContain("7xKX…gAsU");
    expect(solanaRow).not.toContain("0x83ab…2913");
    expect(evmRow).toContain("0x83ab…2913");
    expect(evmRow).not.toContain("7xKX…gAsU");
  });

  it("shows a per-chain absent state without hiding the chain", () => {
    privySolana.wallets = [{ address: SOLANA_ADDRESS, standardWallet: { isPrivyWallet: true } }];
    privyEvm.wallets = [];

    const html = renderToStaticMarkup(<WalletChainRows chains={CHAINS} />);

    expect(html.match(/data-testid="wallet-row"/g)).toHaveLength(2);
    expect(html).toContain("Robinhood Chain testnet");
    expect(html).toContain("No wallet connected on this chain.");
    // Assert the loser: the connected chain does NOT get the absent sentence,
    // and the empty chain does not borrow the other one's address.
    expect(html.match(/No wallet connected on this chain\./g)).toHaveLength(1);
    const [, , evmRow] = html.split('data-testid="wallet-row"');
    expect(evmRow).not.toContain(SOLANA_ADDRESS);
  });

  it("renders nothing at all when the chain list is empty, rather than one default row", () => {
    // The build-time fallback this guards against: a menu that falls back to
    // "Solana" when `GET /chains` says nothing is a menu that names a chain the
    // deployment may not offer.
    privySolana.wallets = [{ address: SOLANA_ADDRESS, standardWallet: { isPrivyWallet: true } }];
    const html = renderToStaticMarkup(<WalletChainRows chains={[]} />);
    expect(html).not.toContain("wallet-row");
    expect(html).not.toContain("7xKX");
  });
});

describe("BalanceRows — one pair per chain, and never a total", () => {
  it("renders the ABSENT state for an empty list, not a zero pair", () => {
    // The `!rows` mutation's target. `rows ? … : "—"` renders $0.00 for an
    // account whose balance could not be read, which is a different fact.
    const html = renderToStaticMarkup(<BalanceRows balances={[]} chains={CHAINS} />);
    expect(html).toContain("No balance to read for this account.");
    expect(html).not.toContain("$0.00");
    expect(html).toContain("—");
  });

  it("renders the ABSENT state when the balance query has not answered", () => {
    const html = renderToStaticMarkup(<BalanceRows balances={undefined} chains={CHAINS} />);
    expect(html).toContain("No balance to read for this account.");
    expect(html).not.toContain("$0.00");
  });

  it("shows one pair per chain, both figures, no sum, and names each chain", () => {
    const html = renderToStaticMarkup(
      <BalanceRows balances={[SOLANA_ROW, EVM_ROW]} chains={CHAINS} />,
    );
    expect(html.match(/Available/g)).toHaveLength(2);
    expect(html).toContain("$12.50");
    expect(html).toContain("$4.00");
    // 12.50 + 4.00 = $16.50 of nothing.
    expect(html).not.toContain("$16.50");
    // The API's own display names, never one assembled here.
    expect(html).toContain("Solana devnet");
    expect(html).toContain("Robinhood Chain testnet");
  });

  it("names no chain at all when there is only one — a single-chain account reads as it always did", () => {
    const html = renderToStaticMarkup(<BalanceRows balances={[SOLANA_ROW]} chains={CHAINS} />);
    expect(html.match(/Available/g)).toHaveLength(1);
    expect(html).toContain("$12.50");
    expect(html).not.toContain("Solana devnet");
  });

  it("still labels a chain GET /chains has not named, with its bare CAIP-2 id", () => {
    // A balance is never hidden because the chain directory disagrees with the
    // ledger, and it is never labelled with another chain's name.
    const html = renderToStaticMarkup(<BalanceRows balances={[SOLANA_ROW, EVM_ROW]} chains={[CHAINS[0]]} />);
    expect(html).toContain("Solana devnet");
    expect(html).toContain(EVM);
    expect(html).toContain("$4.00");
  });
});

describe("balanceRowLabel", () => {
  it("adds the asset and the account only when they tell rows on one chain apart", () => {
    const second: FullBalance = { ...EVM_ROW, accountId: `${EVM}:0x1810000000000000000000000000000000007296` };
    expect(balanceRowLabel(EVM_ROW, [SOLANA_ROW, EVM_ROW], CHAINS)).toBe("Robinhood Chain testnet");
    const label = balanceRowLabel(second, [EVM_ROW, second], CHAINS);
    expect(label).toMatch(/^Robinhood Chain testnet · USDG · 0x18/);
    expect(label).not.toBe(balanceRowLabel(EVM_ROW, [EVM_ROW, second], CHAINS));
  });
});
