import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  The page-origin RPC the eip155 approval goes through. A recorder, so the
  tests assert what was read, approved and waited for — and in what order.
*/
const evmRpc = vi.hoisted(() => ({
  allowance: 0n,
  calls: [] as string[],
  approvals: [] as Array<{ spender: string; amount: bigint }>,
}));

vi.mock("@/libs/chains/evm/deposit-transaction", () => ({
  readDepositReadiness: async (input: { owner: string; token: string; spender: string }) => {
    evmRpc.calls.push(`readiness:${input.owner}:${input.token}:${input.spender}`);
    return { nativeWei: 10n ** 15n, tokenAtomic: 10n ** 9n, allowanceAtomic: evmRpc.allowance };
  },
  encodeApprove: (spender: string, amount: bigint) => {
    evmRpc.approvals.push({ spender, amount });
    return "0x095ea7b3";
  },
  fillTransaction: async (input: { chainId: string; from: string; to: string; data: string }) => {
    evmRpc.calls.push(`fill:${input.to}`);
    return {
      namespace: "eip155",
      chainId: input.chainId,
      kind: "transaction",
      from: input.from,
      to: input.to,
      data: input.data,
      value: "0",
      nonce: "0",
      gasLimit: "60000",
      maxFeePerGas: "10000000",
      maxPriorityFeePerGas: "0",
    };
  },
  broadcastAndWait: async (_chainId: string, raw: string) => {
    evmRpc.calls.push(`broadcastAndWait:${raw}`);
    return "0xapprove";
  },
  waitForSuccess: async (_chainId: string, hash: string) => {
    evmRpc.calls.push(`waitForSuccess:${hash}`);
  },
}));

import { caip2Of, runStakeIntent } from "@/features/provider-stake/run-stake-intent";
import { assertChainMatches, type Signer } from "@/hooks/useSigner";
import type { UnsignedChainTransaction } from "@/interfaces/chain-transaction";
import type { StakeIntent } from "@/interfaces/provider-stake";

/*
  The runner is two beats now — refuse a null transaction, and hand the rest to
  a signer bound to one chain. Decoding and chain derivation moved into
  `useSigner`, where the payload's own `chainId` is compared against the
  signer's rather than derived beside it. Every remaining beat is still a place
  a stake can go wrong quietly: a `null` transaction dereferenced into "cannot
  read transactionBase64 of null" on the screen where the provider is being told
  why their withdrawal was blocked, and a payload for the wrong chain handed to
  a wallet that will sign it. So the signer is a recorder and the assertions are
  on what it was handed, not on what it returned.
*/

const DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const AUTHORITY = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

/** The wire bytes of a compiled transaction are arbitrary — this just has to survive. */
const TRANSACTION_BASE64 = "AAEC+v+AQA==";

const SIGNATURE = "5htY17Sunf3u3gSuVP6rGMRh8TxKEjQVKwnxYHCvarnrKjkRCodCDjtfbHn1fgnNY6dn6vsUWcQy1ZMPsjQkrZwW";

function stakeIntent(overrides: Partial<StakeIntent> = {}): StakeIntent {
  return {
    kind: "OPEN_STAKE",
    account: `${DEVNET}:${AUTHORITY}`,
    amount: null,
    transaction: {
      namespace: "solana",
      chainId: DEVNET,
      kind: "transaction",
      transactionBase64: TRANSACTION_BASE64,
      feePayer: AUTHORITY,
      signers: [AUTHORITY],
      blockhash: "GTuk6rgDHinihXh4nxYFq5beh8k5zcPiRcspV61ZJyjW",
      lastValidBlockHeight: "412345678",
    },
    preflight: {
      /* `"0"` for every kind but DEPOSIT, and this fixture is an OPEN_STAKE. */
      requiredStakeAsset: { amount: "0", asset: `${DEVNET}/token:${AUTHORITY}`, decimals: 6 },
      stakeAssetBalance: null,
      requiredGas: { amount: "5000", asset: `${DEVNET}/slip44:501`, decimals: 9 },
      gasBalance: { amount: "1000000", asset: `${DEVNET}/slip44:501`, decimals: 9 },
      hasEnoughStakeAsset: false,
      hasEnoughGas: true,
      gasSponsored: false,
      gasNotSponsoredReason: "The platform sponsors an agent's x402 payment, not this.",
    },
    withdrawable: null,
    blockedBy: null,
    ...overrides,
  };
}

/**
 * A signer bound to devnet that records what it was asked to broadcast.
 *
 * `signAndSend` runs the REAL guard — `assertChainMatches` imported from the
 * hook — rather than a stub that always accepts. A recorder that skipped it
 * would make the "refuses another chain" test below assert nothing, which is
 * this project's dominant failure mode written as a fixture.
 */
function recordingSigner(chainId = DEVNET): {
  signer: Signer;
  calls: Array<{ transaction: UnsignedChainTransaction }>;
} {
  const calls: Array<{ transaction: UnsignedChainTransaction }> = [];
  return {
    calls,
    signer: {
      address: AUTHORITY,
      kind: "external",
      chainId,
      signMessage: vi.fn(),
      signTransaction: vi.fn(),
      signTypedData: vi.fn(),
      signAndSend: async (transaction) => {
        assertChainMatches(chainId, transaction);
        calls.push({ transaction });
        return SIGNATURE;
      },
    },
  };
}

/*
  `base64ToBytes`'s two assertions are not gone: they moved, verbatim and with
  their fixtures, to `libs/chains/solana/base64.test.ts` when the codec's two
  halves were joined into one module. Nothing decodes base64 in this file any
  more — the signer does it, once, on the way to the wallet.
*/

describe("caip2Of", () => {
  it("keeps the first two segments of a CAIP-10 account", () => {
    expect(caip2Of(`${DEVNET}:${AUTHORITY}`)).toBe(DEVNET);
  });

  it("refuses anything that is not CAIP-10, rather than guessing a chain", () => {
    expect(() => caip2Of(AUTHORITY)).toThrow();
    expect(() => caip2Of("solana:")).toThrow();
    expect(() => caip2Of("")).toThrow();
  });
});

describe("runStakeIntent", () => {
  it("hands the signer the server's payload untouched, base64 and all", async () => {
    /*
      No decoding here any more, and that is the assertion: the runner must pass
      the envelope through, because the envelope is what carries the chain id
      the signer checks. A runner that unwrapped it to bytes would hand the
      wallet something with no chain on it at all.
    */
    const { signer, calls } = recordingSigner();
    const intent = stakeIntent();
    await runStakeIntent(intent, signer);

    expect(calls).toHaveLength(1);
    /* The SAME object, by identity — not a copy and not a decode. */
    expect(calls[0].transaction).toBe(intent.transaction);
  });

  it("carries the chain the backend built for, on the payload itself", async () => {
    /*
      No endpoint publishes the deployment's chain id — `exit/page.tsx` says so
      in the hint under its chain field — and it is no longer derived from
      `intent.account` either: the wire puts it on the transaction, which is the
      thing that was actually built for a chain.
    */
    const { signer, calls } = recordingSigner();
    await runStakeIntent(stakeIntent(), signer);

    expect(calls[0].transaction.chainId).toBe(DEVNET);
  });

  it("refuses an intent whose transaction names another chain", async () => {
    const { signer, calls } = recordingSigner();
    const elsewhere = stakeIntent({
      transaction: { ...stakeIntent().transaction!, chainId: "eip155:46630" },
    });
    await expect(runStakeIntent(elsewhere, signer)).rejects.toThrow(/bound to/);
    expect(calls).toHaveLength(0);
  });

  it("returns the signature the wallet reported", async () => {
    const { signer } = recordingSigner();
    await expect(runStakeIntent(stakeIntent(), signer)).resolves.toEqual({ signature: SIGNATURE });
  });

  it("refuses a null transaction with a readable error instead of dereferencing it", async () => {
    /* A blocked withdrawal is a 201 carrying `transaction: null` — a real response. */
    const { signer, calls } = recordingSigner();
    const blocked = stakeIntent({
      kind: "WITHDRAW",
      transaction: null,
      blockedBy: "UNBONDING_NOT_MATURED",
    });

    await expect(runStakeIntent(blocked, signer)).rejects.toThrow(/no transaction/i);
    /* Not a TypeError about reading a property of null. */
    await expect(runStakeIntent(blocked, signer)).rejects.not.toThrow(TypeError);
    expect(calls).toHaveLength(0);
  });
});

/*
  eip155: a stake deposit is `approve` then `depositStake`, and the backend
  builds only the second — `transferFrom` cannot be estimated against a zero
  allowance. The runner sequences the approval, the way the buyer deposit does.
*/
describe("runStakeIntent on eip155", () => {
  const TESTNET = "eip155:46630";
  const PROVIDER = "0x31b1DF6F36ec62075a3BE03a5C0BebB06534bA72";
  const STAKE = "0xF80b7d295f8F62f6a2ade0477823A20374815E3f";
  const USDG = "0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec";

  function evmDeposit(): StakeIntent {
    return stakeIntent({
      kind: "DEPOSIT",
      account: `${TESTNET}:${PROVIDER}`,
      amount: { amount: "50000000", asset: `${TESTNET}/erc20:${USDG}`, decimals: 6 },
      transaction: {
        namespace: "eip155",
        chainId: TESTNET,
        kind: "transaction",
        from: PROVIDER,
        to: STAKE,
        data: "0x208d4960",
        value: "0",
        nonce: "0",
        gasLimit: "350000",
        maxFeePerGas: "10000000",
        maxPriorityFeePerGas: "0",
      },
    });
  }

  function evmSigner(kind: "embedded" | "external" = "embedded") {
    const order: string[] = [];
    const signer: Signer = {
      address: PROVIDER,
      kind,
      chainId: TESTNET,
      signMessage: vi.fn(),
      signTypedData: vi.fn(),
      signTransaction: vi.fn(async (tx: UnsignedChainTransaction) => {
        order.push(`sign:${tx.namespace === "eip155" && tx.kind === "transaction" ? tx.to : "?"}`);
        return { namespace: "eip155" as const, chainId: TESTNET, rawTransaction: "0xa11" as const };
      }),
      signAndSend: vi.fn(async (tx: UnsignedChainTransaction) => {
        order.push(`send:${tx.namespace === "eip155" && tx.kind === "transaction" ? tx.to : "?"}`);
        return "0xdep";
      }),
    };
    return { signer, order };
  }

  beforeEach(() => {
    evmRpc.allowance = 0n;
    evmRpc.calls = [];
  });

  it("approves the stake contract for the amount, waits for it, then deposits", async () => {
    const { signer, order } = evmSigner();

    await expect(runStakeIntent(evmDeposit(), signer)).resolves.toEqual({ signature: "0xdep" });

    expect(evmRpc.calls).toEqual([
      `readiness:${PROVIDER}:${USDG}:${STAKE}`,
      `fill:${USDG}`,
      "broadcastAndWait:0xa11",
    ]);
    expect(evmRpc.approvals).toContainEqual({ spender: STAKE, amount: 50_000_000n });
    /* The approval goes to the TOKEN, the deposit to the stake contract, in that order. */
    expect(order).toEqual([`sign:${USDG}`, `send:${STAKE}`]);
  });

  it("lets an injected wallet SEND the approval, waits for it to land, then deposits", async () => {
    // MetaMask/Rabby cannot sign without sending; `signTransaction` refuses
    // them, so the approval must go through `signAndSend` like the deposit.
    const { signer, order } = evmSigner("external");

    await expect(runStakeIntent(evmDeposit(), signer)).resolves.toEqual({ signature: "0xdep" });

    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(order).toEqual([`send:${USDG}`, `send:${STAKE}`]);
    expect(evmRpc.calls).toContain("waitForSuccess:0xdep");
    expect(evmRpc.calls.indexOf("waitForSuccess:0xdep")).toBeGreaterThan(
      evmRpc.calls.indexOf(`fill:${USDG}`),
    );
  });

  it("skips the approval when the allowance already covers the amount", async () => {
    evmRpc.allowance = 50_000_000n;
    const { signer, order } = evmSigner();

    await runStakeIntent(evmDeposit(), signer);

    expect(order).toEqual([`send:${STAKE}`]);
  });

  it("never approves for an unstake — nothing is pulled from the wallet", async () => {
    const { signer, order } = evmSigner();
    const unstake = { ...evmDeposit(), kind: "UNSTAKE" as const };

    await runStakeIntent(unstake, signer);

    expect(evmRpc.calls).toEqual([]);
    expect(order).toEqual([`send:${STAKE}`]);
  });
});
