import { describe, expect, it } from "vitest";

import type { ProviderPayoutAccount } from "@/interfaces";

import { justProvedAccountId, payoutStepIsDone, provedChainIsNew } from "./payout-accounts";
import { payoutCandidates } from "./use-setup";

/**
 * per-chain enrolment — the payout address is per chain, and the enrolment's status is
 * the half that decides whether money arrives.
 *
 * The bug these exist to keep out is one the backend already had and fixed:
 * The onboarding step read "Payout wallet ✓" on **any** status, so a provider
 * whose only enrolment was `SUSPENDED` was reassured by their own console
 * while every paid binding they owned was refused.
 */

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const CHAIN_4663 = "eip155:4663";

function account(
  chainId: string,
  address: string,
  status: ProviderPayoutAccount["status"],
): ProviderPayoutAccount {
  return {
    chainId,
    accountId: `${chainId}:${address}`,
    provedAt: "2026-09-01T10:00:00.000Z",
    status,
  };
}

describe("payoutStepIsDone", () => {
  it("is not done with nothing proved", () => {
    expect(payoutStepIsDone([], null)).toBe(false);
  });

  it("is done on one ACTIVE enrolment", () => {
    expect(payoutStepIsDone([account(SOLANA, "7xKX", "ACTIVE")], null)).toBe(true);
  });

  it("is NOT done when the only enrolment is SUSPENDED, however proved its address is", () => {
    expect(payoutStepIsDone([account(SOLANA, "7xKX", "SUSPENDED")], null)).toBe(false);
  });

  it("is NOT done when the only enrolment is UNBONDING", () => {
    expect(payoutStepIsDone([account(SOLANA, "7xKX", "UNBONDING")], null)).toBe(false);
  });

  it("is done when any one of several chains is ACTIVE", () => {
    const accounts = [
      account(SOLANA, "7xKX", "SUSPENDED"),
      account(CHAIN_4663, "0xabc", "ACTIVE"),
    ];
    expect(payoutStepIsDone(accounts, null)).toBe(true);
  });

  it("is done off a fresh proof on a chain the cached read does not mention", () => {
    // The read is served `private, max-age=10, stale-while-revalidate=3600`,
    // so it can be an hour behind a write. Proving on a chain with no
    // enrolment row INSERTS one, and inserts it ACTIVE — so this is the one
    // case where a proof is by itself evidence the step is done.
    expect(payoutStepIsDone([], `${SOLANA}:7xKX`)).toBe(true);
  });

  it("is NOT done off a fresh proof on a chain that is already SUSPENDED", () => {
    // Re-proving UPDATES the address and leaves `status` alone, on purpose: a
    // suspension must not be liftable by its owner signing a message. The
    // stale read cannot have invented the suspension, so it wins.
    const accounts = [account(SOLANA, "7xKX", "SUSPENDED")];
    expect(payoutStepIsDone(accounts, `${SOLANA}:9zQq`)).toBe(false);
  });

  it("ignores a proof whose address is already on the read", () => {
    const accounts = [account(SOLANA, "7xKX", "SUSPENDED")];
    expect(payoutStepIsDone(accounts, `${SOLANA}:7xKX`)).toBe(false);
  });

  it("does not treat an unparseable proof as a new chain", () => {
    expect(payoutStepIsDone([], "7xKXnotCaip10")).toBe(false);
  });
});

describe("justProvedAccountId", () => {
  it("is null with nothing proved this session", () => {
    expect(justProvedAccountId([account(SOLANA, "7xKX", "ACTIVE")], null)).toBeNull();
  });

  it("is null once the read carries the address, so it is never drawn twice", () => {
    const accounts = [account(SOLANA, "7xKX", "ACTIVE")];
    expect(justProvedAccountId(accounts, `${SOLANA}:7xKX`)).toBeNull();
  });

  it("survives a read that is behind the write — the whole reason it exists", () => {
    // Before the fix this screen read `registration.payoutAccountId`, which the
    // wire no longer carries; `??` swallowed the `undefined` and the screen
    // fell back to session state alone, telling a provider who proved an
    // address last week that they had not.
    expect(justProvedAccountId([], `${SOLANA}:7xKX`)).toBe(`${SOLANA}:7xKX`);
  });
});

describe("provedChainIsNew", () => {
  it("is true only when the proof enrolled a chain that was not listed", () => {
    expect(provedChainIsNew([], `${SOLANA}:7xKX`)).toBe(true);
    expect(provedChainIsNew([account(SOLANA, "7xKX", "SUSPENDED")], `${SOLANA}:9zQq`)).toBe(false);
    expect(provedChainIsNew([account(CHAIN_4663, "0xabc", "ACTIVE")], `${SOLANA}:7xKX`)).toBe(true);
  });
});


describe("payoutCandidates", () => {
  const evm = "0x1111111111111111111111111111111111111111";
  const solana = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

  it("keeps only wallets of a served namespace", () => {
    expect(payoutCandidates([solana, evm], [{ chainId: "eip155:46630", namespace: "eip155" }])).toEqual([evm]);
    expect(payoutCandidates([solana, evm], [{ chainId: "solana:devnet", namespace: "solana" }])).toEqual([solana]);
  });

  it("keeps every known wallet while the chain list is unknown", () => {
    expect(payoutCandidates([solana, evm, "nope"], [])).toEqual([solana, evm]);
  });
});
