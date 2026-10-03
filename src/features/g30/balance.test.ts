import { describe, expect, it } from "vitest";

import { chainBalances, hasMultipleChains, soleChainBalance, type FullBalance } from "./balance";

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM = "eip155:46630";

/**
 * TWO chains with DIFFERENT amounts, and neither of them round.
 *
 * The difference is load-bearing three ways: a function that returns the first
 * row, one that returns the last, and one that adds them all produce three
 * distinguishable answers, so no single assertion below can be satisfied by
 * two of the three implementations at once. A fixture with one chain proves
 * nothing at all, and a fixture whose two chains carry equal amounts cannot
 * tell "first" from "second".
 *
 * 12.50 USDC + 4.00 USDG = $16.50 of nothing. If any number in this
 * suite ever equals 16500000, something has learned to add them.
 */
const SOLANA_ROW: FullBalance = {
  chainId: SOLANA,
  accountId: `${SOLANA}:AgentAccount1111111111111111111111111111111`,
  asset: `${SOLANA}/token:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`,
  decimals: 6,
  available: { amount: "12500000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
  held: { amount: "300000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
  /* A readable chain. Stated, never defaulted — see `FullBalance.chainReadable`. */
  chainReadable: true,
};

const EVM_ROW: FullBalance = {
  chainId: EVM,
  accountId: `${EVM}:0x83ab1234567890abcdef1234567890abcdef2913`,
  asset: `${EVM}/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`,
  decimals: 6,
  available: { amount: "4000000", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
  held: { amount: "0", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
  /* A readable chain. Stated, never defaulted — see `FullBalance.chainReadable`. */
  chainReadable: true,
};

describe("chainBalances — a list and never a sum", () => {
  it("returns BOTH rows, in the order the API served them", () => {
    const rows = chainBalances([SOLANA_ROW, EVM_ROW]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.chainId)).toEqual([SOLANA, EVM]);
    expect(rows.map((r) => r.available.amount)).toEqual(["12500000", "4000000"]);
  });

  it("does not drop the second chain — the defect this replaces", () => {
    // `primaryBalance` returned `balances[0]`. A two-chain buyer saw 12.50 and
    // nothing said the 4.00 existed. This is the assertion that kills that
    // implementation, and it is the reason the fixture has two chains.
    const amounts = chainBalances([SOLANA_ROW, EVM_ROW]).map((r) => r.available.amount);
    expect(amounts).toContain("4000000");
  });

  it("does not add the two chains together, in any field", () => {
    // 12.50 USDC and 4.00 USDG are different CAIP-19 assets. The one number a
    // buyer would read off a total is the one number that is never true: they
    // cannot spend $16.50 on one call.
    const rows = chainBalances([SOLANA_ROW, EVM_ROW]);
    const everyAmount = rows.flatMap((r) => [r.available.amount, r.held.amount]);
    expect(everyAmount).not.toContain("16500000");
    expect(everyAmount).not.toContain("16800000");
    // And there is no field that could hold one.
    expect(rows).not.toHaveProperty("total");
  });

  it("an empty response is an empty list — the ABSENT state, never a zero row", () => {
    // The `stake ? … : "—"` crash: an array is always truthy, so a caller that
    // branches on the list rather than its length renders a zero for an
    // account whose balance could not be read. Returning [] and forcing the
    // caller to check `.length` is what makes that branch reachable.
    expect(chainBalances([])).toEqual([]);
    expect(chainBalances(undefined)).toEqual([]);
  });

  it("keeps a single chain a single row, unchanged", () => {
    // The common case today, and it must read exactly as it always has.
    const rows = chainBalances([SOLANA_ROW]);
    expect(rows).toHaveLength(1);
    expect(rows[0].available.amount).toBe("12500000");
  });
});

describe("hasMultipleChains", () => {
  it("is false for zero and one, true for two", () => {
    expect(hasMultipleChains([])).toBe(false);
    expect(hasMultipleChains([SOLANA_ROW])).toBe(false);
    expect(hasMultipleChains([SOLANA_ROW, EVM_ROW])).toBe(true);
  });

  it("still says two when it reads what chainBalances actually returned", () => {
    // Every caller composes the two — `hasMultipleChains(chainBalances(rows))`
    // — and the assertion above passes its own fixture straight in, so it
    // cannot see a `chainBalances` that truncates. This one can: it is the
    // explainer's switch, and a truncating list would silently turn it off for
    // exactly the buyer it was written for.
    expect(hasMultipleChains(chainBalances([SOLANA_ROW, EVM_ROW]))).toBe(true);
  });
});

describe("soleChainBalance — a screen with one slot and no selector", () => {
  it("returns the row when the buyer has exactly one chain", () => {
    expect(soleChainBalance([SOLANA_ROW])).toBe(SOLANA_ROW);
  });

  it("returns NULL for two chains rather than picking the first", () => {
    /*
      The mutation this exists to kill: `balances ? balances[0] : null`. It
      passed all 300 tests in a mutation sweep, and it would have shown a
      two-chain buyer their Solana balance on a screen whose whole purpose is a
      sentence about their maximum exposure.
    */
    expect(soleChainBalance([SOLANA_ROW, EVM_ROW])).toBeNull();
    /* And the loser: the first row is not smuggled back some other way. */
    expect(soleChainBalance([EVM_ROW, SOLANA_ROW])).toBeNull();
  });

  it("returns NULL for an empty list — absent, never a zero", () => {
    expect(soleChainBalance([])).toBeNull();
  });
});
