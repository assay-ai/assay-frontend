import { describe, expect, it } from "vitest";

import type {
  Eip155TypedDataRequest,
  Eip155UnsignedTransaction,
  SolanaUnsignedTransaction,
} from "@/interfaces/chain-transaction";

import { unsignedPayloadSummary } from "./unsigned-summary";

const SOLANA: SolanaUnsignedTransaction = {
  namespace: "solana",
  chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  kind: "transaction",
  transactionBase64: "ZmFrZQ==",
  feePayer: "BuyerAccount111111111111111111111111111111",
  signers: ["BuyerAccount111111111111111111111111111111"],
  blockhash: "FakeBlockhash1111111111111111111111111111",
  lastValidBlockHeight: "312445678",
};

const EVM_TX: Eip155UnsignedTransaction = {
  namespace: "eip155",
  chainId: "eip155:46630",
  kind: "transaction",
  from: "0x83ab1234567890abcdef1234567890abcdef2913",
  to: "0x3333333333333333333333333333333333333333",
  data: "0xa9059cbb",
  value: "0",
  nonce: "7",
  gasLimit: "120000",
  maxFeePerGas: "1500000000",
  maxPriorityFeePerGas: "1000000",
};

const TYPED: Eip155TypedDataRequest = {
  namespace: "eip155",
  chainId: "eip155:46630",
  kind: "typed-data",
  domain: {
    name: "X402Escrow",
    version: "1",
    chainId: "46630",
    verifyingContract: "0x3333333333333333333333333333333333333333",
  },
  types: { SetLimits: [{ name: "maxVoucherAmount", type: "uint256" }] },
  primaryType: "SetLimits",
  message: { maxVoucherAmount: "100000000" },
  relayed: true,
};

describe("unsignedPayloadSummary", () => {
  it("names the fee payer and the expiry on solana", () => {
    expect(unsignedPayloadSummary(SOLANA)).toBe(
      "Fee payer BuyerAccount111111111111111111111111111111. Valid to block height 312445678.",
    );
  });

  it("never prints 'fee payer' or a block height for an eip155 transaction", () => {
    // The mutation this exists to stop: the Solana sentence rendered over an
    // EVM payload puts `undefined` in front of somebody approving a payment.
    const text = unsignedPayloadSummary(EVM_TX);
    expect(text).toBe("From 0x83ab1234567890abcdef1234567890abcdef2913 to 0x3333333333333333333333333333333333333333. Nonce 7, gas limit 120000.");
    expect(text.toLowerCase()).not.toContain("fee payer");
    expect(text.toLowerCase()).not.toContain("block height");
    expect(text).not.toContain("undefined");
  });

  it("says a typed-data request is not a transaction, and that this browser sends nothing", () => {
    const text = unsignedPayloadSummary(TYPED);
    expect(text).toContain("A signature request, not a transaction");
    expect(text).toContain("SetLimits");
    expect(text).toContain("relayer submits");
    // Assert the loser: it must not read like something the browser broadcasts.
    expect(text.toLowerCase()).not.toContain("fee payer");
    expect(text).not.toContain("undefined");
  });
});
