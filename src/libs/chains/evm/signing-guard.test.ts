import { encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";

import type { Eip155TypedDataRequest } from "@/interfaces/chain-transaction";

import { assertContractCall, assertTypedData, decodePinnedCall, SIGNING_REFUSED } from "./signing-guard";
import { PINNED_STAKE as PINNED } from "./stake-slashes/deployments";

const CHAIN = "eip155:46630";
const BUYER = "0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1" as const;
const ATTACKER = "0x000000000000000000000000000000000000dEaD" as const;

function requestWithdraw(overrides: Partial<Eip155TypedDataRequest> = {}): Eip155TypedDataRequest {
  return {
    namespace: "eip155",
    chainId: CHAIN,
    kind: "typed-data",
    relayed: true,
    domain: { name: "Assay Settlement", version: "2", chainId: "46630", verifyingContract: PINNED.escrowContract },
    types: {
      RequestWithdraw: [
        { name: "buyer", type: "address" },
        { name: "amount", type: "uint64" },
        { name: "nonce", type: "uint64" },
        { name: "deadline", type: "uint64" },
      ],
    },
    primaryType: "RequestWithdraw",
    message: { buyer: BUYER, amount: "5000000", nonce: "0", deadline: "4102444800" },
    ...overrides,
  };
}

const EXPECTED = { chainId: CHAIN, primaryTypes: ["RequestWithdraw"], message: { buyer: BUYER, amount: "5000000" } };

describe("assertTypedData", () => {
  it("accepts the pinned domain, the canonical struct and the chosen values", () => {
    expect(() => assertTypedData(requestWithdraw(), EXPECTED)).not.toThrow();
  });

  it("compares addresses case-insensitively", () => {
    expect(() =>
      assertTypedData(requestWithdraw(), { ...EXPECTED, message: { buyer: BUYER.toLowerCase(), amount: "5000000" } }),
    ).not.toThrow();
  });

  it.each([
    ["name", { name: "Other" }],
    ["version", { version: "1" }],
    ["chainId", { chainId: "1" }],
    ["verifyingContract", { verifyingContract: ATTACKER }],
    ["salt", { salt: "0x01" }],
  ])("refuses another domain %s", (field, change) => {
    const request = requestWithdraw();
    expect(() => assertTypedData({ ...request, domain: { ...request.domain, ...change } }, EXPECTED)).toThrow(
      new RegExp(field),
    );
  });

  it("refuses a primary type this flow does not sign, even a known one", () => {
    expect(() => assertTypedData(requestWithdraw({ primaryType: "SetLimits" }), EXPECTED)).toThrow(SIGNING_REFUSED);
  });

  it("refuses an altered field list or an extra struct", () => {
    const request = requestWithdraw();
    expect(() =>
      assertTypedData({ ...request, types: { RequestWithdraw: request.types.RequestWithdraw.slice(1) } }, EXPECTED),
    ).toThrow(/types/);
    expect(() =>
      assertTypedData({ ...request, types: { ...request.types, Extra: [{ name: "x", type: "uint8" }] } }, EXPECTED),
    ).toThrow(/types/);
  });

  it("refuses a different amount or buyer than the one chosen", () => {
    expect(() =>
      assertTypedData(requestWithdraw({ message: { buyer: BUYER, amount: "9", nonce: "0", deadline: "1" } }), EXPECTED),
    ).toThrow(/amount/);
    expect(() =>
      assertTypedData(requestWithdraw({ message: { buyer: ATTACKER, amount: "5000000", nonce: "0", deadline: "1" } }), EXPECTED),
    ).toThrow(/buyer/);
  });

  it("refuses a chain with no pinned deployment, and a request for another chain", () => {
    expect(() =>
      assertTypedData(requestWithdraw({ chainId: "eip155:1" }), { ...EXPECTED, chainId: "eip155:1" }),
    ).toThrow(/no pinned contracts/);
    expect(() => assertTypedData(requestWithdraw({ chainId: "eip155:1" }), EXPECTED)).toThrow(/eip155:1/);
  });

  it("pins the stake contract for a stake-authority proof", () => {
    const proof: Eip155TypedDataRequest = {
      ...requestWithdraw(),
      domain: { name: "Assay Settlement", version: "2", chainId: "46630", verifyingContract: PINNED.escrowContract },
      types: {
        StakeAuthorityProof: [
          { name: "account", type: "address" },
          { name: "organizationId", type: "string" },
          { name: "nonce", type: "string" },
          { name: "expiresAt", type: "uint64" },
        ],
      },
      primaryType: "StakeAuthorityProof",
      message: { account: BUYER, organizationId: "o", nonce: "n", expiresAt: "1" },
    };
    const expected = { chainId: CHAIN, primaryTypes: ["StakeAuthorityProof"], message: { account: BUYER } };
    expect(() => assertTypedData(proof, expected)).toThrow(/verifyingContract/);
    expect(() =>
      assertTypedData({ ...proof, domain: { ...proof.domain, verifyingContract: PINNED.stakeContract } }, expected),
    ).not.toThrow();
  });
});

const STAKE_ABI = parseAbi(["function withdrawStake(uint64 amount)", "function requestUnstake(uint64 amount)"]);
const APPROVE_ABI = parseAbi(["function approve(address spender, uint256 amount)", "function transfer(address to, uint256 amount)"]);

describe("assertContractCall", () => {
  const withdrawStake = (amount: bigint) =>
    encodeFunctionData({ abi: STAKE_ABI, functionName: "withdrawStake", args: [amount] });
  const call = (data: string, to: string = PINNED.stakeContract) => ({ chainId: CHAIN, to, data, value: "0" });
  const expected = { contract: "stake" as const, functionName: "withdrawStake", args: ["10"] };

  it("accepts exactly the chosen call to the pinned contract, and returns it decoded", () => {
    const decoded = assertContractCall(call(withdrawStake(10n)), expected);
    expect(decoded).toMatchObject({ contract: "stake", functionName: "withdrawStake", args: [10n] });
  });

  it("refuses another amount, another function, value, or another contract", () => {
    expect(() => assertContractCall(call(withdrawStake(11n)), expected)).toThrow(/arguments/);
    expect(() =>
      assertContractCall(call(encodeFunctionData({ abi: STAKE_ABI, functionName: "requestUnstake", args: [10n] })), expected),
    ).toThrow(/requestUnstake, not withdrawStake/);
    expect(() => assertContractCall({ ...call(withdrawStake(10n)), value: "1" }, expected)).toThrow(/value/);
    expect(() => assertContractCall(call(withdrawStake(10n), ATTACKER), expected)).toThrow(/none of this app's contracts/);
  });

  it("refuses a function the pinned contract is never sent, like a token transfer", () => {
    const transfer = encodeFunctionData({ abi: APPROVE_ABI, functionName: "transfer", args: [ATTACKER, 1n] });
    expect(() => decodePinnedCall(call(transfer, PINNED.settlementToken))).toThrow(/no function this app sends/);
  });

  it("decodes only the one-argument updateConfig (0x33cea666), never the removed newAdmin one (0xd044590b)", () => {
    const paramSet =
      "struct ParamSet { address treasury; address redeemer; uint64 unbondingPeriodSeconds; uint64 minimumStake; uint64 penaltyAmount; uint64 verifierDailyCap; uint16 takeRateBps; uint16 slashAgentBps; uint16 slashPlatformBps; uint16 slashCapBps; }";
    const params = {
      treasury: BUYER,
      redeemer: BUYER,
      unbondingPeriodSeconds: 950_400n,
      minimumStake: 100_000_000n,
      penaltyAmount: 1_000_000n,
      verifierDailyCap: 10_000_000n,
      takeRateBps: 1000,
      slashAgentBps: 5000,
      slashPlatformBps: 5000,
      slashCapBps: 2000,
    };
    const current = encodeFunctionData({
      abi: parseAbi([paramSet, "function updateConfig(ParamSet p)"]),
      functionName: "updateConfig",
      args: [params],
    });
    const removed = encodeFunctionData({
      abi: parseAbi([paramSet, "function updateConfig(ParamSet p, address newAdmin)"]),
      functionName: "updateConfig",
      args: [params, ATTACKER],
    });
    expect(current.slice(0, 10)).toBe("0x33cea666");
    expect(removed.slice(0, 10)).toBe("0xd044590b");
    expect(decodePinnedCall(call(current, PINNED.configContract)).functionName).toBe("updateConfig");
    expect(() => decodePinnedCall(call(removed, PINNED.configContract))).toThrow(/no function this app sends/);
  });

  it("refuses an approve of another spender than the one expected", () => {
    const approve = encodeFunctionData({ abi: APPROVE_ABI, functionName: "approve", args: [ATTACKER, 5n] });
    expect(() =>
      assertContractCall(call(approve, PINNED.settlementToken), {
        contract: "token",
        functionName: "approve",
        args: [PINNED.escrowContract, "5"],
      }),
    ).toThrow(/arguments/);
  });
});
