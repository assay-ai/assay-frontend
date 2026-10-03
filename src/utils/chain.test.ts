import { describe, expect, it } from "vitest";

import { addressOfAccount, chainIdOfAccount, chainIdOfAsset } from "./chain";

const EVM = "eip155:46630:0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1";
const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

describe("addressOfAccount", () => {
  it("takes the address off a CAIP-10 account on either namespace", () => {
    expect(addressOfAccount(EVM)).toBe("0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1");
    expect(addressOfAccount(SOLANA)).toBe("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
  });

  it("preserves EIP-55 case exactly — the case IS the checksum", () => {
    /*
      Lowercasing here would hand `useSigner` an address no connected wallet
      matches, since Privy reports EVM addresses checksummed. The comparison
      that may be case-insensitive is the one against the signed message, and it
      lives where that comparison is made.
    */
    expect(addressOfAccount(EVM)).not.toBe(addressOfAccount(EVM).toLowerCase());
  });

  it("answers the empty string for nothing, never undefined", () => {
    /*
      `undefined` passed to `useSigner({ address })` means "sign as me" and
      Privy picks the embedded wallet; `""` is a defined address nothing matches,
      so the hook reports `address-not-connected` and the screen can say which
      wallet is needed. The two are opposite outcomes at a wallet prompt.
    */
    expect(addressOfAccount(null)).toBe("");
    expect(addressOfAccount(undefined)).toBe("");
    expect(addressOfAccount("")).toBe("");
  });

  it("hands back a non-CAIP-10 string whole rather than a fragment of it", () => {
    expect(addressOfAccount("0xabc")).toBe("0xabc");
    expect(addressOfAccount("eip155:46630")).toBe("eip155:46630");
  });

  it("agrees with chainIdOfAccount about where the account ends", () => {
    expect(`${chainIdOfAccount(EVM)}:${addressOfAccount(EVM)}`).toBe(EVM);
    expect(`${chainIdOfAccount(SOLANA)}:${addressOfAccount(SOLANA)}`).toBe(SOLANA);
  });
});

describe("chainIdOfAsset", () => {
  it("keeps the CAIP-2 chain in front of a CAIP-19 asset id", () => {
    expect(chainIdOfAsset("eip155:46630/erc20:0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec")).toBe(
      "eip155:46630",
    );
    expect(
      chainIdOfAsset(
        "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:AiUqZiWkX3FBjULeRwPi73kC9raWdSnYmn5uQhk6SVP7",
      ),
    ).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  });

  it("answers null for anything that is not CAIP-19, rather than a guessed chain", () => {
    expect(chainIdOfAsset("eip155:46630")).toBeNull();
    expect(chainIdOfAsset("")).toBeNull();
    expect(chainIdOfAsset(undefined)).toBeNull();
  });
});
