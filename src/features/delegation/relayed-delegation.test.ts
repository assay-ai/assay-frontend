import { describe, expect, it, vi } from "vitest";

import type { Signer } from "@/hooks/useSigner";
import type { DelegateIntent, RelayedDelegate } from "@/interfaces";

import {
  DELEGATION_SUBMISSION_REFUSED,
  submitRelayedDelegation,
} from "./relayed-delegation";

const PAYER = "0x18103e1D79257c695B2FBbd4b346CD2Ba7927296";
const DELEGATE = "0x5555555555555555555555555555555555555555";
const SIGNATURE = `0x${"ab".repeat(64)}1b`;

function authorizeIntent(
  message: Record<string, unknown> = {},
): DelegateIntent {
  return {
    kind: "AUTHORIZE_DELEGATE",
    account: `eip155:46630:${PAYER}`,
    transaction: {
      namespace: "eip155",
      chainId: "eip155:46630",
      kind: "typed-data",
      domain: {
        name: "Assay Settlement",
        version: "2",
        chainId: "46630",
        verifyingContract: "0x1D2625efD87c2fc10b8563f3F0890072845Fcf41",
      },
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
        payer: PAYER,
        delegate: DELEGATE,
        maxVoucherAmount: "500000",
        maxPerWindow: "5000000",
        validUntil: "1802592000",
        nonce: "3",
        deadline: "1800000300",
        ...message,
      },
      relayed: true,
    },
  } as DelegateIntent;
}

const ESCROW = "0x1D2625efD87c2fc10b8563f3F0890072845Fcf41";
const DOMAIN = { chainId: "46630", verifyingContract: ESCROW };
const EXPECTED = {
  domain: DOMAIN,
  delegate: DELEGATE,
  maxVoucherAmount: "500000",
  maxPerWindow: "5000000",
  validUntil: "1802592000",
};
const RELAYED = { kind: "AUTHORIZE_DELEGATE" } as RelayedDelegate;

function signerSpy(address = PAYER) {
  return {
    address,
    chainId: "eip155:46630",
    signTypedData: vi.fn(async () => SIGNATURE),
  } as unknown as Signer & {
    signTypedData: ReturnType<typeof vi.fn>;
  };
}

describe("submitRelayedDelegation", () => {
  it("signs with the payer's wallet and relays the issued message, echoed back with the signature", async () => {
    const signer = signerSpy();
    const submit = vi.fn(async (_body: Record<string, unknown>) => RELAYED);
    await expect(
      submitRelayedDelegation(authorizeIntent(), signer, EXPECTED, submit),
    ).resolves.toBe(RELAYED);
    expect(signer.signTypedData).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0]).toEqual({
      payer: PAYER,
      delegate: DELEGATE,
      maxVoucherAmount: "500000",
      maxPerWindow: "5000000",
      validUntil: "1802592000",
      nonce: "3",
      deadline: "1800000300",
      signature: SIGNATURE,
    });
  });

  it.each([
    [
      "another delegate",
      { delegate: "0x6666666666666666666666666666666666666666" },
    ],
    ["a higher per-payment cap", { maxVoucherAmount: "500001" }],
    ["a higher window cap", { maxPerWindow: "9000000" }],
    ["a later expiry", { validUntil: "1900000000" }],
  ])(
    "refuses, without asking the wallet, a request that grants %s than was chosen",
    async (_name, patch) => {
      const signer = signerSpy();
      const submit = vi.fn();
      await expect(
        submitRelayedDelegation(
          authorizeIntent(patch),
          signer,
          EXPECTED,
          submit,
        ),
      ).rejects.toThrow(DELEGATION_SUBMISSION_REFUSED);
      expect(signer.signTypedData).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    },
  );

  /** Review S3-10: the screen checks WHERE the grant is valid, not only what it says. */
  it.each([
    [
      "another escrow",
      {
        name: "Assay Settlement",
        version: "2",
        chainId: "46630",
        verifyingContract: "0x9999999999999999999999999999999999999999",
      },
    ],
    [
      "another chain",
      {
        name: "Assay Settlement",
        version: "2",
        chainId: "4663",
        verifyingContract: ESCROW,
      },
    ],
    [
      "another domain name",
      {
        name: "Assay Settlement2",
        version: "2",
        chainId: "46630",
        verifyingContract: ESCROW,
      },
    ],
    [
      "another version",
      {
        name: "Assay Settlement",
        version: "3",
        chainId: "46630",
        verifyingContract: ESCROW,
      },
    ],
  ])(
    "refuses, without asking the wallet, a request for %s",
    async (_name, domain) => {
      const intent = authorizeIntent();
      const tampered = {
        ...intent,
        transaction: { ...intent.transaction, domain },
      } as DelegateIntent;
      const signer = signerSpy();
      await expect(
        submitRelayedDelegation(tampered, signer, EXPECTED, vi.fn()),
      ).rejects.toThrow(/not for this escrow/);
      expect(signer.signTypedData).not.toHaveBeenCalled();
    },
  );

  it("refuses a request whose field list is not the canonical one", async () => {
    const intent = authorizeIntent();
    const tx = intent.transaction as unknown as {
      types: Record<string, { name: string; type: string }[]>;
    };
    const swapped = [...tx.types.AuthorizeDelegate];
    [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
    const tampered = {
      ...intent,
      transaction: {
        ...intent.transaction,
        types: { AuthorizeDelegate: swapped },
      },
    } as DelegateIntent;
    const signer = signerSpy();
    await expect(
      submitRelayedDelegation(tampered, signer, EXPECTED, vi.fn()),
    ).rejects.toThrow(/types/);
    expect(signer.signTypedData).not.toHaveBeenCalled();
  });

  it("refuses a request made out to another payer before the wallet is asked", async () => {
    const signer = signerSpy("0x7777777777777777777777777777777777777777");
    await expect(
      submitRelayedDelegation(authorizeIntent(), signer, EXPECTED, vi.fn()),
    ).rejects.toThrow(/made out to/);
    expect(signer.signTypedData).not.toHaveBeenCalled();
  });

  it("refuses a request whose primary type is not the one its kind signs", async () => {
    const intent = authorizeIntent();
    const wrong = { ...intent, kind: "REVOKE_DELEGATE" } as DelegateIntent;
    await expect(
      submitRelayedDelegation(wrong, signerSpy(), EXPECTED, vi.fn()),
    ).rejects.toThrow(/must sign RevokeDelegate/);
  });

  it("refuses a payload that is not a relayed signature request", async () => {
    const intent = {
      ...authorizeIntent(),
      transaction: { namespace: "eip155", kind: "transaction" },
    } as unknown as DelegateIntent;
    await expect(
      submitRelayedDelegation(intent, signerSpy(), EXPECTED, vi.fn()),
    ).rejects.toThrow(DELEGATION_SUBMISSION_REFUSED);
  });

  it("accepts a checksummed vs lower-case address as the same payer and delegate", async () => {
    const signer = signerSpy(PAYER.toLowerCase());
    const submit = vi.fn(async (_body: Record<string, unknown>) => RELAYED);
    await submitRelayedDelegation(
      authorizeIntent(),
      signer,
      { ...EXPECTED, delegate: `eip155:46630:${DELEGATE}` },
      submit,
    );
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
