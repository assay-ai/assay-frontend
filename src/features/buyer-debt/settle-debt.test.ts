import { describe, expect, it, vi } from "vitest";

import type { Signer } from "@/hooks/useSigner";
import type { BuyerDebt, DebtVoucherIntent } from "@/interfaces/buyer-debt";
import { ROBINHOOD_TESTNET_STAKE as PINNED } from "@/libs/chains/evm/stake-slashes/deployments";
import { voucherResourceHash } from "@/libs/chains/evm/voucher-hash";

import { DEBT_SIGNING_REFUSED, debtSigningRequest, requestHashBytes32, settleDebt } from "./settle-debt";

const CHAIN = "eip155:46630";
const PAYER = "0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1";
const PROVIDER = "0x1111111111111111111111111111111111111111";
const ATTACKER = "0x000000000000000000000000000000000000dEaD";
const ASSET = `${CHAIN}/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3`;
const RESOURCE = "/mcp/tools/price_quote";
const REQUEST_HASH = "ab".repeat(32);
const NOW = 1_800_000_000_000;
const EXPIRES = NOW / 1000 + 300;

const debt: BuyerDebt = {
  intentId: "int_1",
  payer: `${CHAIN}:${PAYER}`,
  amount: { amount: "2500000", asset: ASSET, decimals: 6 },
  providerId: "prv_1",
  toolId: "tool_1",
  cause: "DelegateIsRevoked",
  state: "OPEN",
  lapsedAt: "2026-10-16T00:00:00.000Z",
  writeOffAt: "2026-11-15T00:00:00.000Z",
  replacedAt: null,
  createdAt: "2026-10-15T23:59:00.000Z",
  replaceableAt: "2026-10-16T00:00:00.000Z",
};

function intent(overrides: {
  voucher?: Partial<DebtVoucherIntent["voucher"]>;
  domain?: Record<string, string>;
  message?: Record<string, unknown>;
  primaryType?: string;
} = {}): DebtVoucherIntent {
  const voucher = {
    payer: `${CHAIN}:${PAYER}`,
    payTo: `${CHAIN}:${PINNED.escrowContract}`,
    provider: `${CHAIN}:${PROVIDER}`,
    amount: { amount: "2500000", asset: ASSET, decimals: 6 },
    resource: RESOURCE,
    requestHash: `sha256:${REQUEST_HASH}`,
    seq: "42",
    issuedAt: NOW / 1000,
    expiresAt: EXPIRES,
    ...overrides.voucher,
  };
  return {
    debt,
    voucher,
    signers: ["payer", "delegate"],
    delegate: null,
    typedData: {
      domain: {
        name: "Assay Settlement",
        version: "2",
        chainId: "46630",
        verifyingContract: PINNED.escrowContract,
        ...overrides.domain,
      },
      types: {
        Voucher: [
          { name: "payer", type: "address" },
          { name: "provider", type: "address" },
          { name: "amount", type: "uint64" },
          { name: "resourceHash", type: "bytes32" },
          { name: "requestHash", type: "bytes32" },
          { name: "seq", type: "uint64" },
          { name: "issuedAt", type: "uint64" },
          { name: "expiresAt", type: "uint64" },
        ],
      },
      primaryType: overrides.primaryType ?? "Voucher",
      message: {
        payer: PAYER,
        provider: PROVIDER,
        amount: "2500000",
        resourceHash: voucherResourceHash(RESOURCE),
        requestHash: `0x${REQUEST_HASH}`,
        seq: "42",
        issuedAt: String(NOW / 1000),
        expiresAt: String(EXPIRES),
        ...overrides.message,
      },
    },
  };
}

const signerOf = (address = PAYER) => ({ address, chainId: CHAIN });

describe("debtSigningRequest", () => {
  it("accepts the pinned Voucher struct that pays exactly this debt", () => {
    const request = debtSigningRequest(intent(), debt, signerOf(), NOW);
    expect(request).toMatchObject({ namespace: "eip155", chainId: CHAIN, kind: "typed-data", primaryType: "Voucher" });
  });

  it.each([
    ["a domain for another contract", { domain: { verifyingContract: ATTACKER } }, /verifyingContract/],
    ["a domain on another chain", { domain: { chainId: "1" } }, /chainId/],
    ["another struct", { primaryType: "RequestWithdraw" }, /signs Voucher/],
    ["a larger amount", { message: { amount: "9999999" } }, /amount/],
    ["another provider", { message: { provider: ATTACKER } }, /provider/],
    ["another resource", { message: { resourceHash: voucherResourceHash("/x") } }, /resourceHash/],
    ["another seq", { message: { seq: "43" } }, /seq/],
    ["a voucher paying elsewhere", { voucher: { payTo: `${CHAIN}:${ATTACKER}` } }, /escrow contract/],
    ["a voucher for more", { voucher: { amount: { amount: "1", asset: ASSET, decimals: 6 } } }, /owes/],
    ["an expired voucher", { voucher: { expiresAt: NOW / 1000 - 1 } }, /expired/],
  ])("refuses %s", (_label, overrides, pattern) => {
    expect(() => debtSigningRequest(intent(overrides), debt, signerOf(), NOW)).toThrow(pattern);
    expect(() => debtSigningRequest(intent(overrides), debt, signerOf(), NOW)).toThrow(DEBT_SIGNING_REFUSED);
  });

  it("refuses when the connected wallet is not the payer", () => {
    expect(() => debtSigningRequest(intent(), debt, signerOf(ATTACKER), NOW)).toThrow(/connected wallet/);
  });

  it("refuses a chain with no typed data", () => {
    expect(() => debtSigningRequest({ ...intent(), typedData: null }, debt, signerOf(), NOW)).toThrow(
      /no wallet signature/,
    );
  });

  it("refuses a voucher for another debt", () => {
    expect(() =>
      debtSigningRequest({ ...intent(), debt: { ...debt, intentId: "int_2" } }, debt, signerOf(), NOW),
    ).toThrow(/another call/);
  });
});

describe("requestHashBytes32", () => {
  it("reads sha256:, 0x and bare hex alike", () => {
    expect(requestHashBytes32(`sha256:${REQUEST_HASH}`)).toBe(`0x${REQUEST_HASH}`);
    expect(requestHashBytes32(`0x${REQUEST_HASH.toUpperCase()}`)).toBe(`0x${REQUEST_HASH}`);
    expect(requestHashBytes32(REQUEST_HASH)).toBe(`0x${REQUEST_HASH}`);
    expect(() => requestHashBytes32("abc")).toThrow(DEBT_SIGNING_REFUSED);
  });
});

describe("settleDebt", () => {
  it("signs the checked request and posts the voucher unchanged with the signature", async () => {
    const issued = intent();
    const signTypedData = vi.fn(async () => "0xsig" as const);
    const signer = { ...signerOf(), signTypedData } as unknown as Signer;
    const submit = vi.fn(async () => ({ intentId: "int_1", status: "REPLACING" as const, seq: "42", remainingDebts: 0 }));

    const result = await settleDebt(debt, signer, {
      createIntent: async () => issued,
      submit,
      now: () => NOW,
    });

    expect(result.remainingDebts).toBe(0);
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("int_1", { voucher: issued.voucher, signature: "0xsig" });
  });

  it("never asks the wallet when the request is refused", async () => {
    const signTypedData = vi.fn();
    const signer = { ...signerOf(), signTypedData } as unknown as Signer;
    const submit = vi.fn();
    await expect(
      settleDebt(debt, signer, {
        createIntent: async () => intent({ domain: { verifyingContract: ATTACKER } }),
        submit,
        now: () => NOW,
      }),
    ).rejects.toThrow(DEBT_SIGNING_REFUSED);
    expect(signTypedData).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
});
