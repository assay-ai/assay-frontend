import { describe, expect, it } from "vitest";

import { pickDisplayAsset } from "./display-asset";

const SOL = "solana:EtWT/token:4zMM";
const EVM = "eip155:46630/erc20:0xDbbC";

describe("pickDisplayAsset", () => {
  it("names no asset for a buyer who holds one — the API infers it", () => {
    expect(pickDisplayAsset([SOL, SOL], null)).toBeUndefined();
    expect(pickDisplayAsset([], EVM)).toBeUndefined();
  });

  it("picks the first asset held when the buyer holds several", () => {
    expect(pickDisplayAsset([SOL, EVM, SOL], null)).toBe(SOL);
  });

  it("keeps the buyer's own choice while they still hold it", () => {
    expect(pickDisplayAsset([SOL, EVM], EVM)).toBe(EVM);
    expect(pickDisplayAsset([SOL, EVM], "eip155:1/erc20:0xgone")).toBe(SOL);
  });
});
