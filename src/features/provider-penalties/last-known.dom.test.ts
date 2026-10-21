// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { PENALTY_DEPLOYMENT, readLastKnown, writeLastKnown } from "./use-penalties";

const WALLET = "0xAbCd000000000000000000000000000000000001";
const V1 = `assay.provider.penalties.v1:${WALLET.toLowerCase()}`;
const V2 = `assay.provider.penalties.v2:${PENALTY_DEPLOYMENT.chainId}:${PENALTY_DEPLOYMENT.stakeContract.toLowerCase()}:${WALLET.toLowerCase()}`;
const row = { id: "r1", chainKey: "executed", executableAt: "2026-10-15T00:00:00.000Z" };

afterEach(() => window.localStorage.clear());

describe("last-known penalties cache", () => {
  it("never reads the old wallet-only key", () => {
    window.localStorage.setItem(V1, JSON.stringify([row]));
    expect(readLastKnown(WALLET, 0)).toBeNull();
  });

  it("is keyed by chain, contract and wallet", () => {
    writeLastKnown(WALLET, [row as never]);
    expect(window.localStorage.getItem(V2)).not.toBeNull();
    expect(readLastKnown(WALLET, 0)).toHaveLength(1);
  });

  it("an empty authoritative read overwrites the rows and drops the old key", () => {
    window.localStorage.setItem(V1, JSON.stringify([row]));
    writeLastKnown(WALLET, [row as never]);
    writeLastKnown(WALLET, []);
    expect(readLastKnown(WALLET, 0)).toEqual([]);
    expect(window.localStorage.getItem(V1)).toBeNull();
  });
});
