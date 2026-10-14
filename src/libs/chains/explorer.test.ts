import { describe, expect, it } from "vitest";

import type { Chain } from "@/interfaces/chain";

import { explorerAddressUrl, explorerTxUrl } from "./explorer";

/**
 * Exactly what `GET /chains` serves — the examples on
 * assay-backend `src/modules/chains/dto/get-chains.dto.ts`, not invented shapes.
 * The Solana explorer base carries a QUERY STRING, and that is the whole
 * reason this module exists instead of a template literal.
 */
const SOLANA: Chain = {
  chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  namespace: "solana",
  displayName: "Solana devnet",
  explorerBaseUrl: "https://explorer.solana.com/?cluster=devnet",
  settlementAsset:
    "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  settlementAssetSymbol: "USDC",
  decimals: 6,
};

const EVM: Chain = {
  chainId: "eip155:46630",
  namespace: "eip155",
  displayName: "Robinhood Chain testnet",
  explorerBaseUrl: "https://testnet-explorer.example/",
  settlementAsset: "eip155:46630/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  settlementAssetSymbol: "USDG",
  decimals: 6,
};

describe("explorerTxUrl", () => {
  it("keeps the Solana explorer's cluster query alongside the tx path", () => {
    // Written as a literal. `${base}/tx/${ref}` — the obvious implementation —
    // produces ".../?cluster=devnet/tx/5Yx…", a URL that resolves to the
    // explorer's home page and looks like a link that "just did not work".
    expect(explorerTxUrl(SOLANA, "5YxSigNature")).toBe(
      "https://explorer.solana.com/tx/5YxSigNature?cluster=devnet",
    );
  });

  it("builds an EVM tx url with no query invented", () => {
    expect(explorerTxUrl(EVM, "0xabc123")).toBe("https://testnet-explorer.example/tx/0xabc123");
  });

  it("percent-encodes a reference rather than pasting it in raw", () => {
    expect(explorerTxUrl(EVM, "a/b?c")).toBe("https://testnet-explorer.example/tx/a%2Fb%3Fc");
  });
});

describe("explorerAddressUrl", () => {
  it("uses the address path on both namespaces and keeps the query", () => {
    expect(explorerAddressUrl(SOLANA, "7xKX")).toBe(
      "https://explorer.solana.com/address/7xKX?cluster=devnet",
    );
    expect(explorerAddressUrl(EVM, "0x83ab")).toBe(
      "https://testnet-explorer.example/address/0x83ab",
    );
  });
});

/* Frontend review 2026-10-15, F5: the base is the API's, so only http(s) becomes a link. */
describe("a base that is not http(s)", () => {
  it.each(["javascript:alert(1)//", "data:text/html,x", "not a url"])("gives no link for %s", (base) => {
    const chain = { ...EVM, explorerBaseUrl: base };
    expect(explorerTxUrl(chain, "0xabc")).toBeUndefined();
    expect(explorerAddressUrl(chain, "0xabc")).toBeUndefined();
  });
});
