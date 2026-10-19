import { describe, expect, it, vi } from "vitest";

import {
  RELAYED_SUBMISSION_REFUSED,
  relayedSubmitBody,
  runEscrowAction,
  submitRelayedEscrowIntent,
  type RelayedSubmitters,
} from "./relayed-submission";

import type { Signer } from "@/hooks/useSigner";
import type { RelayedEscrowIntent } from "@/interfaces";
import { encodeCall } from "@/libs/chains/evm/calldata-fixtures";
import type {
  Eip155TypedDataRequest,
  UnsignedChainTransaction,
} from "@/interfaces/chain-transaction";

const CHAIN = "eip155:46630";
const BUYER = "0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1";
const SIGNATURE = `0x${"ab".repeat(65)}`;

/**
 * The `SetLimits` request, exactly as `POST /escrow/limits-intent` answered it
 * on the running fork — copied off the wire rather than invented, so a field
 * this app expects and the backend does not send is a failing test rather than
 * a passing fixture.
 */
function setLimitsRequest(
  message: Record<string, unknown> = {
    buyer: BUYER,
    maxVoucherAmount: "2500000",
    maxPerWindow: "9000000",
    nonce: "0",
    deadline: "1789143203",
  },
): Eip155TypedDataRequest {
  return {
    namespace: "eip155",
    chainId: CHAIN,
    kind: "typed-data",
    domain: {
      name: "Assay Settlement",
      version: "2",
      chainId: "46630",
      verifyingContract: "0x1eDb0E45747cfEf778bDB4f4418319efc0DD814f",
    },
    types: {
      SetLimits: [
        { name: "buyer", type: "address" },
        { name: "maxVoucherAmount", type: "uint64" },
        { name: "maxPerWindow", type: "uint64" },
        { name: "nonce", type: "uint64" },
        { name: "deadline", type: "uint64" },
      ],
    },
    primaryType: "SetLimits",
    message,
    relayed: true,
  };
}

function requestWithdrawRequest(): Eip155TypedDataRequest {
  return {
    ...setLimitsRequest({
      buyer: BUYER,
      amount: "55000000",
      nonce: "1",
      deadline: "1789143999",
    }),
    types: {
      RequestWithdraw: [
        { name: "buyer", type: "address" },
        { name: "amount", type: "uint64" },
        { name: "nonce", type: "uint64" },
        { name: "deadline", type: "uint64" },
      ],
    },
    primaryType: "RequestWithdraw",
  };
}

/** A signer that records what it was asked to sign, and as whom. */
function signerSpy(address = BUYER) {
  const signTypedData = vi.fn(async () => SIGNATURE as `0x${string}`);
  const signAndSend = vi.fn(async () => "broadcast-signature");
  return {
    signer: { address, chainId: CHAIN, signTypedData, signAndSend } as unknown as Signer,
    signTypedData,
    signAndSend,
  };
}

const RELAYED: RelayedEscrowIntent = {
  kind: "SET_LIMITS",
  account: `${CHAIN}:${BUYER}`,
  transactionHash: "0xfeed",
  blockNumber: "101840",
  gasUsed: "61234",
  escrow: {} as RelayedEscrowIntent["escrow"],
};

function submitterSpies() {
  /*
    The parameter is declared even though the body ignores it. `vi.fn(async () =>
    …)` records calls with an EMPTY tuple type, so `mock.calls[0][0]` is a
    compile error — and `next build` does not typecheck test files, so it would
    have been a compile error nobody saw until `tsc --noEmit` ran. The body this
    module posts is the thing under test; it has to be reachable.
  */
  const SET_LIMITS = vi.fn(async (_body: Record<string, unknown>) => RELAYED);
  const REQUEST_WITHDRAW = vi.fn(async (_body: Record<string, unknown>) => ({
    ...RELAYED,
    kind: "REQUEST_WITHDRAW" as const,
  }));
  return { submitters: { SET_LIMITS, REQUEST_WITHDRAW } as RelayedSubmitters, SET_LIMITS, REQUEST_WITHDRAW };
}

describe("relayedSubmitBody", () => {
  it("is the issued message echoed field for field, plus the signature", () => {
    const request = setLimitsRequest();
    const body = relayedSubmitBody(request, SIGNATURE);

    /*
      Field for field, and the SIGNATURE is checked as a value rather than as a
      key. A submit that posts `{...message}` and forgets the signature passes
      any assertion about the message alone — which is the first degenerate this
      file has to kill.
    */
    expect(body).toEqual({
      buyer: BUYER,
      maxVoucherAmount: "2500000",
      maxPerWindow: "9000000",
      nonce: "0",
      deadline: "1789143203",
      signature: SIGNATURE,
    });
  });

  it("keeps every uint64 a decimal STRING — JSON has no such number", () => {
    const body = relayedSubmitBody(setLimitsRequest(), SIGNATURE);
    for (const field of ["maxVoucherAmount", "maxPerWindow", "nonce", "deadline"]) {
      expect(typeof body[field], `${field} must stay a string`).toBe("string");
    }
  });

  it("survives a round trip through JSON with nothing dropped", () => {
    /*
      The wire is what the backend validates, and `JSON.stringify` is what makes
      it. A field whose value were `undefined` disappears here and NOWHERE else
      — the object would still look complete in a debugger.
    */
    const body = relayedSubmitBody(setLimitsRequest(), SIGNATURE);
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });

  it("refuses a message missing a field the struct declares, naming it", () => {
    const request = setLimitsRequest({
      buyer: BUYER,
      maxVoucherAmount: "2500000",
      maxPerWindow: "9000000",
      // `nonce` absent — `JSON.stringify` would drop it and the contract would
      // hash a different struct, answering SignerIsNotBuyer.
      deadline: "1789143203",
    });
    expect(() => relayedSubmitBody(request, SIGNATURE)).toThrow(/nonce/);
    expect(() => relayedSubmitBody(request, SIGNATURE)).toThrow(RELAYED_SUBMISSION_REFUSED);
  });
});

describe("submitRelayedEscrowIntent", () => {
  it("signs the request and posts the message with the signature on it", async () => {
    const { signer, signTypedData } = signerSpy();
    const { submitters, SET_LIMITS } = submitterSpies();
    const transaction = setLimitsRequest();

    const result = await submitRelayedEscrowIntent(
      { kind: "SET_LIMITS", transaction },
      signer,
      { kind: "SET_LIMITS", maxVoucherAmount: "2500000", maxPerWindow: "9000000" },
submitters,
    );

    // The wallet is handed the server's own request object, not a rebuild.
    expect(signTypedData).toHaveBeenCalledWith(transaction);
    const [body] = SET_LIMITS.mock.calls[0];
    expect(body.signature).toBe(SIGNATURE);
    expect(body.nonce).toBe("0");
    expect(result.transactionHash).toBe("0xfeed");
  });

  it("refuses when the connected wallet is not the buyer the request names", async () => {
    /*
      THE trap. Privy composes the wallet list embedded-first, so a screen that
      forgets `useSigner({ address })` signs as the wrong account — a genuine
      signature over the right struct by the wrong person. The contract recovers
      the signer and refuses it; the platform refuses it first with a 403. Both
      happen AFTER the user approved a prompt, so this refusal has to land
      before the wallet is asked for anything at all.
    */
    const { signer, signTypedData } = signerSpy("0x1111111111111111111111111111111111111111");
    const { submitters, SET_LIMITS } = submitterSpies();

    await expect(
      submitRelayedEscrowIntent(
        { kind: "SET_LIMITS", transaction: setLimitsRequest() },
        signer,
        { kind: "SET_LIMITS", maxVoucherAmount: "2500000", maxPerWindow: "9000000" },
submitters,
      ),
    ).rejects.toThrow(/0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1/);

    expect(signTypedData).not.toHaveBeenCalled();
    expect(SET_LIMITS).not.toHaveBeenCalled();
  });

  it("accepts the same address in a different EIP-55 case — the case is a checksum", async () => {
    const { signer } = signerSpy(BUYER.toLowerCase());
    const { submitters, SET_LIMITS } = submitterSpies();

    await submitRelayedEscrowIntent(
      { kind: "SET_LIMITS", transaction: setLimitsRequest() },
      signer,
      { kind: "SET_LIMITS", maxVoucherAmount: "2500000", maxPerWindow: "9000000" },
submitters,
    );
    expect(SET_LIMITS).toHaveBeenCalledTimes(1);
  });

  it("sends a REQUEST_WITHDRAW to the withdrawal route and never to the limits route", async () => {
    const { signer } = signerSpy();
    const { submitters, SET_LIMITS, REQUEST_WITHDRAW } = submitterSpies();

    await submitRelayedEscrowIntent(
      { kind: "REQUEST_WITHDRAW", transaction: requestWithdrawRequest() },
      signer,
      { kind: "REQUEST_WITHDRAW", amount: "55000000" },
submitters,
    );

    expect(REQUEST_WITHDRAW).toHaveBeenCalledTimes(1);
    expect(SET_LIMITS).not.toHaveBeenCalled();
    const [body] = REQUEST_WITHDRAW.mock.calls[0];
    expect(body).toEqual({
      buyer: BUYER,
      amount: "55000000",
      nonce: "1",
      deadline: "1789143999",
      signature: SIGNATURE,
    });
  });

  it("refuses a WITHDRAW outright — there is no withdrawBySig to relay it to", async () => {
    const { signer, signTypedData } = signerSpy();
    const { submitters, SET_LIMITS, REQUEST_WITHDRAW } = submitterSpies();

    await expect(
      submitRelayedEscrowIntent(
        { kind: "WITHDRAW", transaction: setLimitsRequest() },
        signer,
        { kind: "WITHDRAW" },
submitters,
      ),
    ).rejects.toThrow(/msg\.sender-only/);

    /*
      Not merely "it threw". A dispatcher that picked the nearest route would
      relay a withdrawal REQUEST in place of a withdrawal: the buyer would be
      shown a success for an action that did not happen, and the money would
      still be in the escrow.
    */
    expect(SET_LIMITS).not.toHaveBeenCalled();
    expect(REQUEST_WITHDRAW).not.toHaveBeenCalled();
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it("refuses a Solana payload rather than posting one to a relayed door", async () => {
    const { signer } = signerSpy();
    const { submitters, SET_LIMITS } = submitterSpies();
    const solana: UnsignedChainTransaction = {
      namespace: "solana",
      chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      kind: "transaction",
      transactionBase64: "aGVsbG8=",
      feePayer: BUYER,
      signers: [BUYER],
      blockhash: "Bh11",
      lastValidBlockHeight: "1",
    };

    await expect(
      submitRelayedEscrowIntent({ kind: "SET_LIMITS", transaction: solana }, signer, { kind: "SET_LIMITS", maxVoucherAmount: "2500000", maxPerWindow: "9000000" },
submitters),
    ).rejects.toThrow(/not a relayed signature request/);
    expect(SET_LIMITS).not.toHaveBeenCalled();
  });
});

describe("runEscrowAction", () => {
  it("relays a typed-data request and reports the mined transaction, not a signature", async () => {
    const { signer, signAndSend } = signerSpy();
    const { submitters } = submitterSpies();

    const result = await runEscrowAction(
      { kind: "SET_LIMITS", account: `${CHAIN}:${BUYER}`, transaction: setLimitsRequest() },
      signer,
      { kind: "SET_LIMITS", maxVoucherAmount: "2500000", maxPerWindow: "9000000" },
submitters,
    );

    if (result.kind !== "relayed") throw new Error(`expected relayed, got ${result.kind}`);
    expect(result.relayed.transactionHash).toBe("0xfeed");
    expect(result.relayed.gasUsed).toBe("61234");
    /* Nothing was broadcast from the browser — that is the member's whole point. */
    expect(signAndSend).not.toHaveBeenCalled();
  });

  it("broadcasts a Solana transaction through the wallet and posts nothing", async () => {
    const { signer, signAndSend } = signerSpy();
    const { submitters, SET_LIMITS, REQUEST_WITHDRAW } = submitterSpies();
    const transaction: UnsignedChainTransaction = {
      namespace: "solana",
      chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
      kind: "transaction",
      transactionBase64: "aGVsbG8=",
      feePayer: "Own1",
      signers: ["Own1"],
      blockhash: "Bh11",
      lastValidBlockHeight: "1",
    };

    const result = await runEscrowAction(
      { kind: "SET_LIMITS", account: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:Own1", transaction },
      signer,
      { kind: "SET_LIMITS", maxVoucherAmount: "2500000", maxPerWindow: "9000000" },
submitters,
    );

    if (result.kind !== "broadcast") throw new Error(`expected broadcast, got ${result.kind}`);
    expect(result.signature).toBe("broadcast-signature");
    expect(signAndSend).toHaveBeenCalledTimes(1);
    /*
      A Solana signature must never reach a relayed door: the platform pays no
      gas there, the buyer already signed and sent their own transaction, and a
      POST of it would be this app inventing a submit path the threat model
      forbids.
    */
    expect(SET_LIMITS).not.toHaveBeenCalled();
    expect(REQUEST_WITHDRAW).not.toHaveBeenCalled();
  });
});

/*
  Frontend review 2026-10-15, F1: a compromised or buggy backend must not be
  able to make these screens sign or send anything but what the buyer chose.
  Each case below was signed or sent before the guard existed.
*/
describe("a payload the buyer did not choose is refused before the wallet is asked", () => {
  const ATTACKER = "0x000000000000000000000000000000000000dEaD";
  const MAX = "18446744073709551615";

  it("refuses an AuthorizeDelegate behind the request-withdrawal button, on any domain", async () => {
    const { signer, signTypedData } = signerSpy();
    const { submitters } = submitterSpies();
    const grant: Eip155TypedDataRequest = {
      ...requestWithdrawRequest(),
      domain: { name: "Assay Settlement", version: "2", chainId: "1", verifyingContract: ATTACKER },
      types: {
        AuthorizeDelegate: [
          { name: "payer", type: "address" },
          { name: "delegate", type: "address" },
          { name: "maxVoucherAmount", type: "uint64" },
          { name: "maxPerWindow", type: "uint64" },
          { name: "validUntil", type: "uint64" },
          { name: "nonce", type: "uint64" },
          { name: "deadline", type: "uint64" },
        ],
      },
      primaryType: "AuthorizeDelegate",
      message: {
        buyer: BUYER,
        payer: BUYER,
        delegate: ATTACKER,
        maxVoucherAmount: MAX,
        maxPerWindow: MAX,
        validUntil: "4102444800",
        nonce: "0",
        deadline: "4102444800",
      },
    };
    for (const domain of [grant.domain, requestWithdrawRequest().domain]) {
      await expect(
        submitRelayedEscrowIntent(
          { kind: "REQUEST_WITHDRAW", transaction: { ...grant, domain } },
          signer,
          { kind: "REQUEST_WITHDRAW", amount: "55000000" },
          submitters,
        ),
      ).rejects.toThrow(RELAYED_SUBMISSION_REFUSED);
    }
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it("refuses a withdrawal request for another amount than the one typed", async () => {
    const { signer, signTypedData } = signerSpy();
    await expect(
      submitRelayedEscrowIntent(
        { kind: "REQUEST_WITHDRAW", transaction: requestWithdrawRequest() },
        signer,
        { kind: "REQUEST_WITHDRAW", amount: "1000000" },
        submitterSpies().submitters,
      ),
    ).rejects.toThrow(/amount/);
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it("refuses limits other than the ones typed", async () => {
    const { signer, signTypedData } = signerSpy();
    await expect(
      submitRelayedEscrowIntent(
        { kind: "SET_LIMITS", transaction: setLimitsRequest() },
        signer,
        { kind: "SET_LIMITS", maxVoucherAmount: "2500000", maxPerWindow: "1" },
        submitterSpies().submitters,
      ),
    ).rejects.toThrow(/maxPerWindow/);
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it("refuses a payload of another kind than the screen asked for", async () => {
    const { signer, signTypedData } = signerSpy();
    await expect(
      submitRelayedEscrowIntent(
        { kind: "SET_LIMITS", transaction: setLimitsRequest() },
        signer,
        { kind: "REQUEST_WITHDRAW", amount: "0" },
        submitterSpies().submitters,
      ),
    ).rejects.toThrow(/asked for REQUEST_WITHDRAW/);
    expect(signTypedData).not.toHaveBeenCalled();
  });

  const evmTx = (to: string, data: string) => ({
    kind: "WITHDRAW",
    account: `${CHAIN}:${BUYER}`,
    transaction: {
      namespace: "eip155" as const,
      chainId: CHAIN,
      kind: "transaction" as const,
      from: BUYER,
      to,
      data,
      value: "0",
      nonce: "0",
      gasLimit: "1",
      maxFeePerGas: "1",
      maxPriorityFeePerGas: "1",
    },
  });
  const ESCROW = "0x1eDb0E45747cfEf778bDB4f4418319efc0DD814f";
  const USDG = "0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3";

  it("sends withdraw() to the pinned escrow", async () => {
    const { signer, signAndSend } = signerSpy();
    const data = encodeCall("withdraw()");
    await runEscrowAction(evmTx(ESCROW, data), signer, { kind: "WITHDRAW" });
    expect(signAndSend).toHaveBeenCalledTimes(1);
  });

  it("refuses a withdraw button that sends a token transfer, or withdraw() to another contract", async () => {
    const { signer, signAndSend } = signerSpy();
    const transfer = encodeCall("transfer(address,uint256)", [ATTACKER, 10n ** 12n]);
    const withdraw = encodeCall("withdraw()");
    await expect(runEscrowAction(evmTx(USDG, transfer), signer, { kind: "WITHDRAW" })).rejects.toThrow(
      RELAYED_SUBMISSION_REFUSED,
    );
    await expect(runEscrowAction(evmTx(ATTACKER, withdraw), signer, { kind: "WITHDRAW" })).rejects.toThrow(
      /none of this app's contracts/,
    );
    expect(signAndSend).not.toHaveBeenCalled();
  });
});
