import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { depositChoice } from "@/features/funding/deposit-chain";
import type { Chain } from "@/interfaces/chain";

import { DepositChainChoice } from "./deposit-chain-choice";

const SOLANA: Chain = {
  chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  namespace: "solana",
  displayName: "Solana devnet",
  explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
  settlementAsset: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMM",
  settlementAssetSymbol: "USDC",
  decimals: 6,
};

const EVM: Chain = {
  chainId: "eip155:46630",
  namespace: "eip155",
  displayName: "Robinhood Chain testnet",
  explorerBaseUrl: "https://testnet-explorer.example/",
  settlementAsset: "eip155:46630/erc20:0xa0b8",
  settlementAssetSymbol: "USDG",
  decimals: 6,
};

function markup(chains: Chain[], picked: string | null = null): string {
  return renderToStaticMarkup(
    <DepositChainChoice
      choice={depositChoice(chains)}
      picked={picked}
      onPick={() => undefined}
    />,
  );
}

/** `checked` on the rendered input for one chain id, read out of the markup. */
function radioFor(html: string, chainId: string): string {
  const match = html.match(new RegExp(`<input[^>]*data-chain-id="${chainId}"[^>]*>`));
  if (match === null) throw new Error(`no radio rendered for ${chainId}`);
  return match[0];
}

describe("DepositChainChoice — the DOM, not the class string", () => {
  it("states the one chain as a fact: checked, disabled, and named", () => {
    const html = markup([SOLANA]);
    const radio = radioFor(html, SOLANA.chainId);
    expect(radio).toContain('checked=""');
    expect(radio).toContain('disabled=""');
    expect(html).toContain("Solana devnet");
    expect(html).toContain("the chain this account deposits on");
    // The claim it replaced was about the DEPLOYMENT, and this picker no longer
    // shows the deployment's list — it shows the buyer's.
    expect(html).not.toContain("the only chain this deployment settles on");
    /* One option means one radio — never a second, empty one. */
    expect(html.match(/<input/g)).toHaveLength(1);
  });

  it("offers two chains with NOTHING checked", () => {
    const html = markup([SOLANA, EVM]);
    expect(html.match(/<input/g)).toHaveLength(2);
    /*
      The assertion that matters, and it asserts the LOSER too: neither radio
      is checked. `checked` on either one is a pre-selected chain for an
      irreversible, unbridgeable transfer.
    */
    expect(radioFor(html, SOLANA.chainId)).not.toContain("checked");
    expect(radioFor(html, EVM.chainId)).not.toContain("checked");
    expect(html).toContain("Solana devnet");
    expect(html).toContain("Robinhood Chain testnet");
    expect(html).toContain("a deposit cannot be moved between chains");
    /* And neither is disabled — an unpicked choice is not an unavailable one. */
    expect(radioFor(html, EVM.chainId)).not.toContain("disabled");
  });

  it("checks exactly the chain that was picked, and only that one", () => {
    const html = markup([SOLANA, EVM], EVM.chainId);
    expect(radioFor(html, EVM.chainId)).toContain('checked=""');
    expect(radioFor(html, SOLANA.chainId)).not.toContain("checked");
  });

  it("renders nothing at all when no chain is offered", () => {
    /*
      Length, not truthiness, and absence rather than a zero: an empty picker
      drawn above a live amount field is a screen inviting a deposit to
      nowhere. The page renders its own blocking note instead.
    */
    expect(markup([])).toBe("");
  });
});
