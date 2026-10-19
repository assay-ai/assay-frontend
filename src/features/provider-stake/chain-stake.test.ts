import { describe, expect, it } from "vitest";

import type { Money, ProviderChainStake, ProviderStake } from "@/interfaces";

import {
  STAKE_ASSET_DECIMALS,
  hasAmbiguousStakeChain,
  latestObservedAt,
  stakeActionChain,
  stakeChains,
  stakeDecimals,
  stakedFigure,
  unbondingFigure,
  unreadableChains,
  withProvedStakeAuthority,
} from "./chain-stake";

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM = "eip155:46630";
const STAKE_ASSET = `${SOLANA}/token:AiUqZiWkX3FBjULeRwPi73kC9raWdSnYmn5uQhk6SVP7`;

const usdc = (amount: string): Money => ({ amount, asset: STAKE_ASSET, decimals: 6 });

function chain(overrides: Partial<ProviderChainStake> = {}): ProviderChainStake {
  return {
    chainId: SOLANA,
    hasKnownStake: true,
    staked: usdc("500000000"),
    observedAt: "2026-09-11T15:03:54.381Z",
    unbonding: null,
    unbondingStartedAt: null,
    unbondingCompletesAt: null,
    chainReadable: true,
    stakeAuthority: null,
    ...overrides,
  };
}

function response(stake: ProviderChainStake[]): ProviderStake {
  return {
    stake,
    requirement: [],
    requirementRule: "max",
    requirementTotal: null,
    negotiatedMinimum: null,
    graceSummary: null,
    headroom: null,
    shortfall: null,
    recommendedBuffer: null,
  };
}

/**
 * The exact body `GET /providers/me/stake` returned for
 * `mcp_demo_token_provider` — the provider the console showed
 * "The chain could not be read" and four em dashes for.
 */
const LIVE_PROVIDER = response([chain()]);

describe("stakeChains", () => {
  it("hands back every chain, and an empty list for no response", () => {
    expect(stakeChains(undefined)).toHaveLength(0);
    expect(stakeChains(LIVE_PROVIDER)).toHaveLength(1);
    expect(stakeChains(response([chain(), chain({ chainId: EVM })]))).toHaveLength(2);
  });
});

describe("stakedFigure — the live regression", () => {
  it("reads the REAL $500 off the per-chain entry", () => {
    // The whole defect in one assertion. Before the interface was corrected
    // this figure came from `data.staked` — `undefined` — and rendered "—".
    expect(stakedFigure(stakeChains(LIVE_PROVIDER)[0])).toEqual({
      state: "read",
      text: "$500.00",
    });
  });

  it("distinguishes a ZERO reading from no reading at all", () => {
    const zero = stakedFigure(chain({ hasKnownStake: true, staked: usdc("0") }));
    const unknown = stakedFigure(chain({ hasKnownStake: false, staked: null }));
    expect(zero).toEqual({ state: "read", text: "$0.00" });
    expect(unknown.state).toBe("unreadable");
    expect(unknown.text).not.toBe(zero.text);
    // `hasKnownStake: false` is the DTO's "NEVER a zero". A $0.00 here would
    // tell an unbonded provider and an unreachable source the same thing.
    expect(unknown.text).not.toContain("$");
  });
});

describe("unbondingFigure", () => {
  it("is unknown — not zero — when the chain could not be read", () => {
    expect(unbondingFigure(chain({ chainReadable: false, unbonding: null })).state).toBe(
      "unreadable",
    );
  });

  it("is 'None' when the chain answered and nothing is unbonding", () => {
    const figure = unbondingFigure(chain({ chainReadable: true, unbonding: null }));
    expect(figure.state).toBe("absent");
    expect(figure.text).toBe("None");
  });

  it("KILLS 'staked and unbonding share one flag'", () => {
    /*
      They are two different unknowns. A chain that answered about the stake
      but not about the unbonding block is a real response, and a single flag
      driving both would report one of them wrongly.
    */
    const entry = chain({ hasKnownStake: true, staked: usdc("500000000"), chainReadable: false });
    expect(stakedFigure(entry).state).toBe("read");
    expect(unbondingFigure(entry).state).toBe("unreadable");
  });
});

describe("unreadableChains", () => {
  it("names ONLY the chains that failed", () => {
    const rows = unreadableChains(
      response([chain({ chainReadable: true }), chain({ chainId: EVM, chainReadable: false })]),
    );
    expect(rows.map((r) => r.chainId)).toEqual([EVM]);
  });

  it("KILLS a response-wide banner: a healthy response names nobody", () => {
    // The shipped banner fired on `!data.chainReadable` with a top-level field
    // that no longer existed. Live, it accused a chain that had just answered.
    expect(unreadableChains(LIVE_PROVIDER)).toHaveLength(0);
  });
});

describe("stakeActionChain — never `stake[0]`", () => {
  it("picks the sole chain when there is one", () => {
    expect(stakeActionChain(LIVE_PROVIDER)?.chainId).toBe(SOLANA);
  });

  it("picks the sole PROVED authority when there are two chains", () => {
    const picked = stakeActionChain(
      response([
        chain({ chainId: SOLANA, stakeAuthority: null }),
        chain({ chainId: EVM, stakeAuthority: `${EVM}:0x9965` }),
      ]),
    );
    expect(picked?.chainId).toBe(EVM);
  });

  it("KILLS the first-row pick: two candidates is NO pick, not the first one", () => {
    /*
      This is the assertion the whole function exists for. `stake[0]` passes
      every other test in this file — including the two above, since the first
      row is the right answer in both. Only an ambiguous response separates a
      rule from an index.
    */
    const ambiguous = response([
      chain({ chainId: SOLANA, stakeAuthority: `${SOLANA}:Auth1` }),
      chain({ chainId: EVM, stakeAuthority: `${EVM}:0x9965` }),
    ]);
    expect(stakeActionChain(ambiguous)).toBeNull();

    // And neither is "two chains, neither proved" — there is nothing to sign
    // with on either, so there is still no chain to act on.
    expect(
      stakeActionChain(
        response([chain({ chainId: SOLANA }), chain({ chainId: EVM })]),
      ),
    ).toBeNull();
  });

  it("has no chain before the query answers", () => {
    expect(stakeActionChain(undefined)).toBeNull();
    expect(stakeActionChain(response([]))).toBeNull();
  });
});

describe("hasAmbiguousStakeChain", () => {
  it("is false when two chains are listed but neither has a proved authority", () => {
    expect(
      hasAmbiguousStakeChain(response([chain({ chainId: SOLANA }), chain({ chainId: EVM })])),
    ).toBe(false);
  });

  it("is true only when more than one chain has a proved authority", () => {
    expect(
      hasAmbiguousStakeChain(
        response([
          chain({ chainId: SOLANA, stakeAuthority: `${SOLANA}:Auth1` }),
          chain({ chainId: EVM, stakeAuthority: `${EVM}:0x9965` }),
        ]),
      ),
    ).toBe(true);
    expect(
      hasAmbiguousStakeChain(
        response([chain({ chainId: SOLANA, stakeAuthority: `${SOLANA}:Auth1` }), chain({ chainId: EVM })]),
      ),
    ).toBe(false);
    expect(hasAmbiguousStakeChain(undefined)).toBe(false);
  });
});

describe("latestObservedAt", () => {
  it("takes the MOST RECENT stamp, not the first row's", () => {
    /*
      The lagging chain is first on purpose: `stake[0].observedAt` returns the
      older stamp here, which is exactly backwards — the header claims the page
      is staler than it is, or (with the order reversed) fresher than it is.
    */
    const stamp = latestObservedAt(
      response([
        chain({ chainId: EVM, observedAt: "2026-09-11T09:00:00.000Z" }),
        chain({ chainId: SOLANA, observedAt: "2026-09-11T15:03:54.381Z" }),
      ]),
    );
    expect(stamp).toBe("2026-09-11T15:03:54.381Z");
  });

  it("is null when no chain has been observed — never a fabricated 'now'", () => {
    expect(latestObservedAt(response([chain({ observedAt: null })]))).toBeNull();
    expect(latestObservedAt(undefined)).toBeNull();
  });
});

describe("stakeDecimals", () => {
  it("prefers a figure off the wire over the constant", () => {
    const withRequirement: ProviderStake = {
      ...LIVE_PROVIDER,
      requirementTotal: { amount: "50000000", asset: STAKE_ASSET, decimals: 8 },
    };
    expect(stakeDecimals(withRequirement)).toBe(8);
  });

  it("falls back to a chain's own staked figure, then to the constant", () => {
    expect(stakeDecimals(LIVE_PROVIDER)).toBe(6);
    expect(stakeDecimals(response([chain({ hasKnownStake: false, staked: null })]))).toBe(
      STAKE_ASSET_DECIMALS,
    );
  });
});

describe("withProvedStakeAuthority — the cache seed after a proof", () => {
  /*
    BUG-J-PROV-01: the prove sheet's success path wrote `stakeAuthority` at the
    TOP level of the cached response, which no reader looks at — every reader
    goes through `stakeActionChain`, i.e. the per-chain entries — so
    the Stake page kept "no authority has been proved" until a hard reload.
  */
  it("sets the authority on the chain it was proved on, so stakeActionChain sees it", () => {
    const before = response([chain({ chainId: EVM, stakeAuthority: null })]);
    const after = withProvedStakeAuthority(before, `${EVM}:0xfB18c1c4`);
    expect(stakeActionChain(after)?.stakeAuthority).toBe(`${EVM}:0xfB18c1c4`);
    expect(after).not.toHaveProperty("stakeAuthority");
    // The input is cache data: it is never mutated in place.
    expect(before.stake[0].stakeAuthority).toBeNull();
  });

  it("touches only the matching chain when there are two", () => {
    const after = withProvedStakeAuthority(
      response([chain({ chainId: SOLANA }), chain({ chainId: EVM })]),
      `${EVM}:0x9965`,
    );
    expect(after?.stake.map((entry) => entry.stakeAuthority)).toEqual([null, `${EVM}:0x9965`]);
    expect(stakeActionChain(after)?.chainId).toBe(EVM);
  });

  it("adds an entry with UNKNOWN figures for a chain the read did not list", () => {
    const after = withProvedStakeAuthority(
      response([chain({ chainId: SOLANA })]),
      `${EVM}:0x9965`,
    );
    const added = after?.stake.find((entry) => entry.chainId === EVM);
    expect(added).toMatchObject({
      stakeAuthority: `${EVM}:0x9965`,
      hasKnownStake: false,
      staked: null,
      chainReadable: false,
    });
  });

  it("leaves a missing response or a non-CAIP-10 authority alone", () => {
    expect(withProvedStakeAuthority(undefined, `${EVM}:0x9965`)).toBeUndefined();
    const live = response([chain()]);
    expect(withProvedStakeAuthority(live, "0x9965")).toBe(live);
  });
});
