import { describe, expect, it } from "vitest";

import type { FullBalance } from "@/features/g30/balance";

import { absentBalanceTile, overviewBalance, singleBalanceSub } from "./overview-balance";

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM = "eip155:46630";

const solanaRow = {
  chainId: SOLANA,
  accountId: `${SOLANA}:Agent1`,
  asset: `${SOLANA}/token:4zMM`,
  decimals: 6,
  available: { amount: "12500000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
  held: { amount: "300000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
} as FullBalance;

const evmRow = {
  chainId: EVM,
  accountId: `${EVM}:0x83ab`,
  asset: `${EVM}/erc20:0xa0b8`,
  decimals: 6,
  available: { amount: "4000000", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
  held: { amount: "0", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
} as FullBalance;

describe("overviewBalance — one tile, N chains", () => {
  it("shows the one chain's figure when there is exactly one", () => {
    expect(overviewBalance([solanaRow])).toEqual({
      kind: "single",
      balance: solanaRow,
    });
  });

  it("refuses to pick a chain when there are two, and says how many there are", () => {
    // The Overview tile has ONE slot. Filling it with balances[0] is what this
    // whole task is undoing: it answers "how much money do I have" with one
    // chain's figure and no sign the other exists. There is no honest single
    // number here — a sum is forbidden, and "the biggest" is an FX rate
    // silently assumed to be 1 — so the tile stops being a figure and becomes
    // a link.
    expect(overviewBalance([solanaRow, evmRow])).toEqual({ kind: "multiple", chainCount: 2 });
  });

  it("carries NO chain's money in the multiple case, not even hidden", () => {
    // Assert the loser. `{ kind: "multiple", chainCount: 2, balance: rows[0] }`
    // satisfies the assertion above under `toMatchObject`, and the tile would
    // then have a figure sitting right there for the next edit to render. The
    // shape has to make the wrong answer unavailable, not merely unused.
    const state = overviewBalance([solanaRow, evmRow]);
    expect(Object.keys(state).sort()).toEqual(["chainCount", "kind"]);
    expect(JSON.stringify(state)).not.toContain("12500000");
    expect(JSON.stringify(state)).not.toContain("4000000");
    // And it never learned to add them: 12.50 + 4.00 = 16.50 of nothing.
    expect(JSON.stringify(state)).not.toContain("16500000");
  });

  it("counts every chain, not just the first two", () => {
    // `chainCount: 2` hardcoded passes the test above. Three rows is what
    // distinguishes a count from a constant.
    expect(overviewBalance([solanaRow, evmRow, { ...evmRow, accountId: `${EVM}:0xdead` }])).toEqual({
      kind: "multiple",
      chainCount: 3,
    });
  });

  it("is absent for an empty list — never a zero", () => {
    // A zero balance and a balance that could not be read are different facts
    // and only one of them stops a call. The tile already makes this
    // distinction ("— not available"); the list must not undo it.
    expect(overviewBalance([])).toEqual({ kind: "absent" });
  });
});

describe("singleBalanceSub — money on its way in is named, not hidden", () => {
  const asset = `${EVM}/erc20:0xa0b8`;
  const money = (amount: string) => ({ amount, asset, decimals: 6 });

  it("says only 'available now' when nothing is confirming", () => {
    expect(singleBalanceSub({ ...evmRow, pending: money("0"), pendingDeposits: money("0") })).toBe(
      "available now",
    );
    expect(singleBalanceSub(evmRow)).toBe("available now");
  });

  it("names a deposit waiting for finality beside a $0.00 available", () => {
    // Measured on eip155:46630: 20 USDG in escrow, ledger `pending` 20000000,
    // `available` 0 for the ~17 minutes finality takes. The tile read
    // "$0.00 available now" with nothing saying the 20 existed.
    const row = {
      ...evmRow,
      available: money("0"),
      pending: money("20000000"),
      pendingDeposits: money("0"),
    } as FullBalance;
    expect(singleBalanceSub(row)).toBe("available now · $20.00 confirming on chain");
  });

  it("adds both inbound buckets, as the Funding card does", () => {
    const row = { ...evmRow, pending: money("1500000"), pendingDeposits: money("500000") } as FullBalance;
    expect(singleBalanceSub(row)).toBe("available now · $2.00 confirming on chain");
  });
});

describe("absentBalanceTile — a new account", () => {
  it("reads $0.00 with the next step once loaded, never 'not available'", () => {
    expect(absentBalanceTile(true, { freeOnly: false, chainName: null })).toEqual({
      value: "$0.00",
      sub: "add funds to make paid calls",
    });
  });
  it("names the free-calls-only chain instead of asking for funds", () => {
    expect(absentBalanceTile(true, { freeOnly: true, chainName: "Solana devnet" }).sub).toBe("free calls only on Solana devnet");
  });
  it("keeps the em-dash while nothing could be read", () => {
    expect(absentBalanceTile(false, { freeOnly: false, chainName: null })).toEqual({ value: "—", sub: "not available" });
  });
});
