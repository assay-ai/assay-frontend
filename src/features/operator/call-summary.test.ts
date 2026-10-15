import { describe, expect, it } from "vitest";

import { callAction, callSummary, chainDisplayName, isTestnetChain } from "./call-summary";

const B2 = `0x${"b2".repeat(32)}`;
const C3 = `0x${"c3".repeat(32)}`;

describe("callAction: the decoded call in plain words", () => {
  it("names the wallet a block freezes, and a lift", () => {
    expect(callAction("setBlocked", ["0x9F3c1111111111111111111111111111111F36c", true])).toBe("Block wallet 0x9F3c…F36c on chain");
    expect(callAction("setBlocked", ["0x9F3c1111111111111111111111111111111F36c", false])).toBe(
      "Lift the on-chain block of wallet 0x9F3c…F36c",
    );
  });

  it("counts and lists the records a ruling covers", () => {
    expect(callAction("upholdSlashBatch", [[B2, C3]])).toBe("Uphold 2 disputed penalties: 0xb2b2…b2b2, 0xc3c3…c3c3");
    expect(callAction("cancelSlashBatch", [[B2]])).toBe("Cancel 1 penalty on chain: 0xb2b2…b2b2");
    expect(callAction("cancelSlashBatch", [[B2, C3, B2, C3]])).toMatch(/and 1 more$/);
    expect(callAction("cancelSlash", [B2])).toBe("Cancel the penalty record 0xb2b2…b2b2 on chain");
  });
});

describe("callSummary", () => {
  it("says the contract, the chain by name, the signer and that no funds move", () => {
    const lines = callSummary({
      functionName: "setBlocked",
      args: ["0x9F3c1111111111111111111111111111111F36c", true],
      contract: "config",
      to: "0xCf6592A3a053d9714D16d176A86fA039Fe7B6a43",
      chainId: "eip155:46630",
      signer: "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4",
    });
    expect(Object.fromEntries(lines.map((l) => [l.label, l.value]))).toEqual({
      Action: "Block wallet 0x9F3c…F36c on chain",
      Contract: "Config contract 0xCf65…6a43",
      Chain: "Robinhood Chain testnet",
      "Signed by": "Arbiter key 0x5B38…ddC4",
      Funds: "None sent. The signer's wallet pays the network fee.",
    });
  });

  it("never prints a raw CAIP id as the chain", () => {
    expect(chainDisplayName("eip155:46630")).toBe("Robinhood Chain testnet");
    expect(chainDisplayName("eip155:999")).toBe("Chain 999");
    expect(isTestnetChain("eip155:46630")).toBe(true);
    expect(isTestnetChain("eip155:999")).toBe(false);
  });
});
