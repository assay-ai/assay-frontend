import { beforeEach, describe, expect, it, vi } from "vitest";

import { SOLANA_DEVNET_CAIP2 } from "@/libs/chains/solana/chains";

/*
  The two deposit endpoints are the seam between the browser's wallet and the
  chain, and what is worth locking here is the *envelope* — not that axios
  works.

  Three properties, each of which failed silently rather than loudly when it
  was wrong:

    - `createDeposit` sends `{ amount, chainId }` and nothing else. The route
      validates with `forbidNonWhitelisted`, so an extra key is a 400 at the
      moment the user is trying to move money. `chainId` is on every request
      even though the backend can infer it for a one-account buyer — see
      the service's own doc.
    - `settleDeposit` builds the whole x402 envelope itself. The four fields
      are all required; two of them are protocol constants, so a caller that
      assembled them by hand would be a fourth place to get `scheme` wrong.
      `network` is NOT a constant — it is the chain the intent was created on,
      and a constant there is a valid signature declared against the wrong
      network rather than a validation error.
    - `lastValidBlockHeight` stays a **string**. It is a u64, it arrives as a
      decimal string for exactly that reason, and converting it here would put
      a `bigint` in a value the screen has to hold and hand back around a
      render — where JSON cannot round-trip it. `BigInt()` belongs at the
      `buildDepositTransaction` call site, which is the only thing that needs
      the number.

  `@/services/api` is mocked at the module boundary rather than through axios:
  what is under test is the request this file *composes*, and an axios-level
  mock would additionally assert the client's envelope-unwrapping, which
  `ApiClient` owns and already does.
*/

const post = vi.fn();

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn(),
    post: (...args: unknown[]) => post(...args) as unknown,
  },
}));

const { createDeposit, isEvmDepositRequirements, settleDeposit } = await import(
  "@/services/funding.service"
);
type CreatedDeposit = Awaited<ReturnType<typeof createDeposit>>;
type SettledDeposit = Awaited<ReturnType<typeof settleDeposit>>;

const DEPOSIT_ID = "dep_01JABCDEF";

const CREATED: CreatedDeposit = {
  depositId: DEPOSIT_ID,
  expiresAt: "2026-08-23T10:05:00.000Z",
  requirements: {
    namespace: "solana",
    chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    payTo: "AtW955vMKUkYMef861U1ZhPQsqbj2D4Xyb5HnFcm3S6E",
    asset: "AiUqZiWkX3FBjULeRwPi73kC9raWdSnYmn5uQhk6SVP7",
    amount: "1500000",
    decimals: 6,
    feePayer: "45bt7r8bDWm7JRtQwfWFb9GvTAfFw5rtXpAEm2LhUXLt",
    memo: DEPOSIT_ID,
    blockhash: "5VgvvRTZKGBS6Ps7wZeCGn9i3DbWmbtb89DT8RkUujuy",
    lastValidBlockHeight: "382915044",
  },
};

const SETTLED: SettledDeposit = {
  id: DEPOSIT_ID,
  status: "SETTLED",
  settledAmount: {
    amount: "1500000",
    /* `Money.asset` is CAIP-19, unlike `DepositRequirements.asset` which is the bare mint. */
    asset: `${SOLANA_DEVNET_CAIP2}/token:AiUqZiWkX3FBjULeRwPi73kC9raWdSnYmn5uQhk6SVP7`,
    decimals: 6,
  },
  chainTxRef: "DMAqNwtWHtycLqiMWuBP7KFBkCyu3e4YpkDcfJeUPqLG",
};

beforeEach(() => {
  post.mockReset();
});

describe("createDeposit", () => {
  it("posts the amount and the chain, and nothing else, to /deposits", async () => {
    post.mockResolvedValue(CREATED);

    await createDeposit("1500000", SOLANA_DEVNET_CAIP2);

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0];
    expect(url).toBe("/deposits");
    /* Not `toMatchObject` — an extra key is the failure this asserts against. */
    expect(body).toEqual({ amount: "1500000", chainId: SOLANA_DEVNET_CAIP2 });
  });

  it("passes the atomic amount through as the decimal string it was given", async () => {
    post.mockResolvedValue(CREATED);

    /* Larger than Number.MAX_SAFE_INTEGER: a client that parsed it would lose digits. */
    await createDeposit("90071992547409929", SOLANA_DEVNET_CAIP2);

    expect(post.mock.calls[0][1]).toEqual({
      amount: "90071992547409929",
      chainId: SOLANA_DEVNET_CAIP2,
    });
  });

  it("returns the created deposit with its requirements unchanged", async () => {
    post.mockResolvedValue(CREATED);

    const created = await createDeposit("1500000", SOLANA_DEVNET_CAIP2);

    expect(created).toEqual(CREATED);
    if (isEvmDepositRequirements(created.requirements)) throw new Error("expected solana");
    /* The memo IS the deposit id — the on-chain link back to the intent. */
    expect(created.requirements.memo).toBe(created.depositId);
  });

  it("leaves lastValidBlockHeight a string rather than converting it to a bigint", async () => {
    post.mockResolvedValue(CREATED);

    const created = await createDeposit("1500000", SOLANA_DEVNET_CAIP2);
    if (isEvmDepositRequirements(created.requirements)) throw new Error("expected solana");

    expect(typeof created.requirements.lastValidBlockHeight).toBe("string");
    expect(created.requirements.lastValidBlockHeight).toBe("382915044");
    /* And it survives a JSON round trip, which a bigint would not. */
    expect(JSON.parse(JSON.stringify(created))).toEqual(CREATED);
  });

  it("keeps decimals a number — it is the only numeric field in requirements", async () => {
    post.mockResolvedValue(CREATED);

    const created = await createDeposit("1500000", SOLANA_DEVNET_CAIP2);

    expect(typeof created.requirements.decimals).toBe("number");
    expect(typeof created.requirements.amount).toBe("string");
  });
});

describe("settleDeposit", () => {
  const TRANSACTION_BASE64 = "AQABAgMEBQYHCAkKCwwNDg8=";

  it("posts to the deposit's own settle route", async () => {
    post.mockResolvedValue(SETTLED);

    await settleDeposit(DEPOSIT_ID, SOLANA_DEVNET_CAIP2, TRANSACTION_BASE64);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(`/deposits/${DEPOSIT_ID}/settle`);
  });

  it("builds all four envelope fields, with the transaction under payload", async () => {
    post.mockResolvedValue(SETTLED);

    await settleDeposit(DEPOSIT_ID, SOLANA_DEVNET_CAIP2, TRANSACTION_BASE64);

    expect(post.mock.calls[0][1]).toEqual({
      x402Version: 2,
      scheme: "exact",
      network: SOLANA_DEVNET_CAIP2,
      payload: { transaction: TRANSACTION_BASE64 },
    });
  });

  it("names the network with the chain it was handed", async () => {
    post.mockResolvedValue(SETTLED);

    await settleDeposit(DEPOSIT_ID, SOLANA_DEVNET_CAIP2, TRANSACTION_BASE64);

    const body = post.mock.calls[0][1] as { network: string };
    expect(body.network).toBe("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  });

  it("returns the settlement result unchanged", async () => {
    post.mockResolvedValue(SETTLED);

    expect(await settleDeposit(DEPOSIT_ID, SOLANA_DEVNET_CAIP2, TRANSACTION_BASE64)).toEqual(
      SETTLED,
    );
  });

  it("carries a not-yet-settled result through with its nulls intact", async () => {
    /*
      `SETTLING` is a real terminal-for-now answer: the transaction was accepted
      and the chain has not confirmed it. Both money fields are null and the
      screen has to be able to tell that from a zero.
    */
    const settling: SettledDeposit = {
      id: DEPOSIT_ID,
      status: "SETTLING",
      settledAmount: null,
      chainTxRef: null,
    };
    post.mockResolvedValue(settling);

    const result = await settleDeposit(DEPOSIT_ID, SOLANA_DEVNET_CAIP2, TRANSACTION_BASE64);

    expect(result.settledAmount).toBeNull();
    expect(result.chainTxRef).toBeNull();
    expect(result.status).toBe("SETTLING");
  });

  it("does not swallow a rejection — the caller decides what a failure looks like", async () => {
    post.mockRejectedValue(new Error("DEPOSIT_INTENT_EXPIRED"));

    await expect(settleDeposit(DEPOSIT_ID, SOLANA_DEVNET_CAIP2, TRANSACTION_BASE64)).rejects.toThrow(
      "DEPOSIT_INTENT_EXPIRED",
    );
  });
});

describe("createDeposit / settleDeposit carry the chain", () => {
  const TRANSACTION_BASE64 = "AQABAgMEBQYHCAkKCwwNDg8=";
  const EVM_CHAIN = "eip155:46630";

  it("puts chainId on the create body, and sends the chain it was given", async () => {
    post.mockResolvedValue(CREATED);

    await createDeposit("5000000", EVM_CHAIN);

    /* Not `toMatchObject`: the route validates with `forbidNonWhitelisted`. */
    expect(post.mock.calls[0]).toEqual([
      "/deposits",
      { amount: "5000000", chainId: "eip155:46630" },
    ]);
  });

  it("settles against the chain the intent was created on, not a constant", async () => {
    /*
      This was `network: SOLANA_DEVNET_CAIP2`, a module constant. On a
      two-chain deployment that is not a validation error — it is a signature
      declared against the wrong network, which the facilitator checks against
      the chain the envelope names, so the failure is a valid signature over
      the wrong thing.
    */
    post.mockResolvedValue(SETTLED);

    await settleDeposit(DEPOSIT_ID, EVM_CHAIN, TRANSACTION_BASE64);

    expect(post.mock.calls[0]).toEqual([
      `/deposits/${DEPOSIT_ID}/settle`,
      {
        x402Version: 2,
        scheme: "exact",
        network: "eip155:46630",
        payload: { transaction: TRANSACTION_BASE64 },
      },
    ]);
  });

  it("does not fall back to Solana when the caller names another chain", async () => {
    /*
      The loser, asserted. A `network: chainId ?? SOLANA_DEVNET_CAIP2` would
      pass every assertion above and still be the constant, one `??` deep.
    */
    post.mockResolvedValue(SETTLED);

    await settleDeposit(DEPOSIT_ID, EVM_CHAIN, TRANSACTION_BASE64);

    const body = post.mock.calls[0][1] as { network: string };
    expect(body.network).not.toBe(SOLANA_DEVNET_CAIP2);
  });
});
