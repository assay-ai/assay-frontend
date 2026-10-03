import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from "@solana-program/compute-budget";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { describe, expect, it } from "vitest";

import { buildDepositTransaction } from "@/libs/chains/solana/deposit-transaction";

/*
  The deposit transaction's shape is load-bearing for model `A`, and every
  detail here has an expensive reason behind it — see the top of
  `deposit-transaction.ts`. This test exists so that shape stops being oral
  tradition: if someone "modernizes" it to v0, changes the compute unit price,
  or reorders the instructions, it goes red here instead of going red inside
  Kora after a devnet round trip.
*/

const INPUT = {
  owner: "DnTdUmwEBCitxN4tgUfaXrWRSC1JrZgTMD2uPsHC5i73",
  escrowAta: "AtW955vMKUkYMef861U1ZhPQsqbj2D4Xyb5HnFcm3S6E",
  mint: "AiUqZiWkX3FBjULeRwPi73kC9raWdSnYmn5uQhk6SVP7",
  decimals: 6,
  amountAtomic: 1_500_000n,
  feePayer: "45bt7r8bDWm7JRtQwfWFb9GvTAfFw5rtXpAEm2LhUXLt",
  memo: "dep_01JABCDEF",
  blockhash: "5VgvvRTZKGBS6Ps7wZeCGn9i3DbWmbtb89DT8RkUujuy",
  lastValidBlockHeight: 100n,
} as const;

async function buildAndDecode() {
  const built = await buildDepositTransaction(INPUT);
  const tx = getTransactionDecoder().decode(built.transactionBytes);
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  /*
    Narrowing, not a cast. `@solana/kit` 7.1 widened `CompiledTransactionMessage`
    to `Legacy | V0 | V1`, and the V1 variant carries `instructionHeaders` /
    `instructionPayloads` instead of `instructions` — so every assertion below
    fails to typecheck until the union is narrowed. Discriminating on `version`
    narrows it AND makes the test refuse a non-legacy message outright, which is
    the property Kora depends on. An `as` cast would have silenced the type error
    while leaving a v0/v1 message to fail somewhere far less obvious.
  */
  if (message.version !== "legacy") {
    throw new Error(`expected a legacy message, got version ${String(message.version)}`);
  }
  return { built, tx, message };
}

describe("buildDepositTransaction", () => {
  it("builds a legacy transaction, not v0", async () => {
    const { message } = await buildAndDecode();
    // Kora 1.0.3 deserializes with `bincode::deserialize::<Transaction>` —
    // legacy-only. A v0 message would pass our `/verify` and only die inside
    // Kora, so this is the only place that catches it.
    expect(message.version).toBe("legacy");
  });

  it("carries exactly four instructions, in the right order", async () => {
    const { message } = await buildAndDecode();
    const programs = message.instructions.map(
      (ix) => message.staticAccounts[ix.programAddressIndex],
    );
    expect(programs).toEqual([
      COMPUTE_BUDGET_PROGRAM_ADDRESS,
      COMPUTE_BUDGET_PROGRAM_ADDRESS,
      TOKEN_PROGRAM_ADDRESS,
      MEMO_PROGRAM_ADDRESS,
    ]);
  });

  it("sets the compute unit limit to 30_000", async () => {
    const { message } = await buildAndDecode();
    // discriminator 2, then a little-endian u32. 30_000 = 0x7530.
    expect(Array.from(message.instructions[0].data!)).toEqual([2, 0x30, 0x75, 0, 0]);
  });

  it("sets the compute unit price to exactly 1 microLamport", async () => {
    const { message } = await buildAndDecode();
    // discriminator 3, then a little-endian u64. `1_000` was rejected by the
    // facilitator with `invalid_exact_svm_payload_compute_budget`; `1` is
    // accepted.
    expect(Array.from(message.instructions[1].data!)).toEqual([3, 1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("TransferChecked carries the right amount and decimals", async () => {
    const { message } = await buildAndDecode();
    // discriminator 12, u64 LE amount, then 1 byte of decimals.
    const data = Array.from(message.instructions[2].data!);
    expect(data[0]).toBe(12);
    expect(data[data.length - 1]).toBe(6);
    const amount = new DataView(
      Uint8Array.from(data.slice(1, 9)).buffer,
    ).getBigUint64(0, true);
    expect(amount).toBe(1_500_000n);
  });

  it("TransferChecked sends the money to the escrow ATA, from the owner's ATA", async () => {
    const { built, message } = await buildAndDecode();
    // Order matters: `getTransferCheckedInstruction` takes named fields, so a
    // `source`/`destination` swap in the builder compiles fine and every other
    // assertion in this file still passes — only reading the full account list,
    // in order, catches money routed to the wrong place.
    const accounts = message.instructions[2].accountIndices!.map(
      (i) => message.staticAccounts[i],
    );
    expect(accounts).toEqual([built.ownerAta, INPUT.mint, INPUT.escrowAta, INPUT.owner]);
  });

  it("writes the memo as exactly the deposit intent id", async () => {
    const { message } = await buildAndDecode();
    // The memo is what binds these lamports to this exact intent. Everything
    // else in the transaction, an attacker could reconstruct.
    expect(new TextDecoder().decode(message.instructions[3].data!)).toBe("dep_01JABCDEF");
  });

  it("makes the user's authority a signer, not readonly", async () => {
    const { message } = await buildAndDecode();
    // The trap: passing a bare `Address` for `authority` yields role 0
    // (readonly), and the transaction ends up requiring only 1 signature. The
    // user then has no slot to sign.
    expect(message.header.numSignerAccounts).toBe(2);
    const authorityIndex = message.instructions[2].accountIndices![3];
    expect(message.staticAccounts[authorityIndex]).toBe(INPUT.owner);
    expect(authorityIndex).toBeLessThan(message.header.numSignerAccounts);
  });

  it("leaves the fee payer signature slot empty, ahead of the user's", async () => {
    const { tx } = await buildAndDecode();
    const slots = Object.entries(tx.signatures);
    expect(slots.map(([addressText]) => addressText)).toEqual([INPUT.feePayer, INPUT.owner]);
    // Both are empty: the facilitator fills the first slot, Privy fills the second.
    expect(slots.every(([, signature]) => signature === null)).toBe(true);
  });

  it("locks the given blockhash into the compiled message's lifetime", async () => {
    const { message } = await buildAndDecode();
    // Nothing else in this file reads `lifetimeToken` — without this, a broken
    // blockhash path (e.g. the cast this module deliberately avoids) would be
    // invisible to the suite.
    expect(message.lifetimeToken).toBe(INPUT.blockhash);
  });

  it("derives the user's ATA from the wallet and mint", async () => {
    const { built } = await buildAndDecode();
    // Expected value derived from `INPUT.owner` + `INPUT.mint` with the real
    // `@solana-program/token` PDA derivation, not hand-computed.
    expect(built.ownerAta).toBe("7xJo1CZaLKUb4cCV6h9Dni3C7UbgCRRU5WZ5SSAQiaqe");
  });

  it("rejects an empty memo", async () => {
    await expect(buildDepositTransaction({ ...INPUT, memo: "" })).rejects.toThrow(
      /memo/i,
    );
  });

  it("rejects a zero amount", async () => {
    await expect(
      buildDepositTransaction({ ...INPUT, amountAtomic: 0n }),
    ).rejects.toThrow(/amountAtomic/i);
  });
});
