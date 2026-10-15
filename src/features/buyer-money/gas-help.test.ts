import { describe, expect, it } from "vitest";

import { parseFreshStage } from "@/libs/demo/fresh-account";

import { gasHelp } from "./gas-help";

describe("gasHelp", () => {
  it("helps only on EVM test networks, linking a faucet only when the chain names one", () => {
    expect(gasHelp({ chainId: "eip155:46630", displayName: "Robinhood Chain testnet" })?.faucetUrl).toBeNull();
    expect(gasHelp({ chainId: "eip155:46630", displayName: "Robinhood Chain testnet" })?.text).toContain("Robinhood Chain testnet faucet");
    expect(gasHelp({ chainId: "eip155:46630", displayName: "Robinhood Chain testnet", faucetUrl: "https://faucet.example" })?.faucetUrl).toBe(
      "https://faucet.example",
    );
    expect(gasHelp({ chainId: "eip155:1", displayName: "Ethereum" })).toBeNull();
    expect(gasHelp({ chainId: "solana:EtWT", displayName: "Solana devnet" })).toBeNull();
  });
});

describe("demo fresh-account stages", () => {
  it("reads ?fresh=", () => {
    expect(parseFreshStage("1")).toBe("new");
    expect(parseFreshStage("pay")).toBe("pay");
    expect(parseFreshStage("0")).toBe("clear");
    expect(parseFreshStage("nope")).toBeNull();
    expect(parseFreshStage(null)).toBeNull();
  });
});
