import { describe, expect, it } from "vitest";

import { evmChainsFrom, evmRpcUrl, setEvmRpcUrls } from "./chains";
import { encodeApprove, encodeDepositFor } from "./deposit-transaction";

/*
  Selectors pinned as literals, computed independently of viem
  (`cast sig 'depositFor(address,uint64)'` → 0xe9efa60a,
  `cast sig 'approve(address,uint256)'` → 0x095ea7b3). A wrong selector is a
  transaction the buyer pays gas for and that credits nobody.
*/
const BUYER = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const ESCROW = "0x67fb3aE2a27A6Cef356437DfC488be8D1ED3c9Ee";

describe("deposit calldata", () => {
  it("encodes depositFor(buyer, amount) with the uint64 amount in the second word", () => {
    const data = encodeDepositFor(BUYER, 25_000_000n);
    expect(data.slice(0, 10)).toBe("0xe9efa60a");
    expect(data.slice(10, 74)).toBe(
      BUYER.slice(2).toLowerCase().padStart(64, "0"),
    );
    expect(BigInt(`0x${data.slice(74)}`)).toBe(25_000_000n);
  });

  it("encodes approve(spender, amount) for exactly the amount — never unlimited", () => {
    const data = encodeApprove(ESCROW, 25_000_000n);
    expect(data.slice(0, 10)).toBe("0x095ea7b3");
    expect(BigInt(`0x${data.slice(74)}`)).toBe(25_000_000n);
  });

  it("refuses an amount a uint64 cannot hold, rather than truncating it", () => {
    expect(() => encodeDepositFor(BUYER, 2n ** 64n)).toThrow();
  });
});

describe("the chain registry the API fills", () => {
  const ROBINHOOD = {
    chainId: "eip155:46630",
    namespace: "eip155",
    displayName: "Robinhood Chain testnet",
    explorerBaseUrl: "https://explorer.testnet.chain.robinhood.com",
    settlementAsset:
      "eip155:46630/erc20:0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec",
    settlementAssetSymbol: "USDG",
    decimals: 6,
    publicRpcUrl: "https://rpc.testnet.chain.robinhood.com",
  };
  const SOLANA = { ...ROBINHOOD, chainId: "solana:dev", namespace: "solana" };

  it("keeps the eip155 endpoint the API served, and ignores the other namespace", () => {
    setEvmRpcUrls([ROBINHOOD, SOLANA]);

    expect(evmRpcUrl("eip155:46630")).toBe(
      "https://rpc.testnet.chain.robinhood.com",
    );
    expect(evmRpcUrl("solana:dev")).toBeNull();
  });

  it("is null for a chain the deployment named no public endpoint for", () => {
    // The field is optional on purpose: absent means "cannot be signed for in
    // this browser", and the screens refuse by name instead of dialling "".
    setEvmRpcUrls([{ ...ROBINHOOD, publicRpcUrl: undefined }]);

    expect(evmRpcUrl("eip155:46630")).toBeNull();
    expect(evmChainsFrom([{ ...ROBINHOOD, publicRpcUrl: undefined }])).toEqual(
      [],
    );
  });

  it("builds Privy's chain from the id, the served name and the served rpc", () => {
    const [chain] = evmChainsFrom([ROBINHOOD, SOLANA]);

    expect(chain.id).toBe(46630);
    expect(chain.name).toBe("Robinhood Chain testnet");
    expect(chain.rpcUrls.default.http).toEqual([
      "https://rpc.testnet.chain.robinhood.com",
    ]);
  });
});
