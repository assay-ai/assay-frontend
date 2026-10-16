import { decodeFunctionData, isAddress, parseAbi, type Abi } from "viem";

import type { Eip155TypedDataRequest } from "@/interfaces/chain-transaction";

import { stakeDeploymentFor, type StakeDeployment } from "./stake-slashes/deployments";

/**
 * The one check every EIP-712 request and every contract call goes through
 * before a wallet is asked to sign it (frontend review 2026-10-15, F1).
 *
 * The backend builds what the wallet signs. If it is compromised, or simply
 * buggy, it can hand a "request withdrawal" screen a delegate grant, or a
 * "dispute" button an `approve(attacker, max)`. So nothing is signed on the
 * API's word: the domain and the contract must be the ones pinned in the
 * frontend bundle (`stake-slashes/deployments.ts`), the struct or function must
 * be one this flow signs, and the fields the person chose on the screen must be
 * the fields in the payload. A chain with no pinned deployment is refused.
 */

export const SIGNING_REFUSED = "SIGNING_REFUSED";

export const EIP712_DOMAIN_NAME = "Assay Settlement";
export const EIP712_DOMAIN_VERSION = "2";

type PinnedContract = "escrow" | "stake" | "config" | "token";

interface Field {
  readonly name: string;
  readonly type: string;
}

/**
 * Every struct this app signs: its verifying contract and its canonical field
 * list, as assay-evm `src/Types.sol` and assay-backend `evm-proofs.ts` declare
 * them. A primary type missing here is never signed.
 */
const TYPED_DATA: Record<string, { readonly contract: "escrow" | "stake"; readonly fields: readonly Field[] }> = {
  SetLimits: {
    contract: "escrow",
    fields: [
      { name: "buyer", type: "address" },
      { name: "maxVoucherAmount", type: "uint64" },
      { name: "maxPerWindow", type: "uint64" },
      { name: "nonce", type: "uint64" },
      { name: "deadline", type: "uint64" },
    ],
  },
  RequestWithdraw: {
    contract: "escrow",
    fields: [
      { name: "buyer", type: "address" },
      { name: "amount", type: "uint64" },
      { name: "nonce", type: "uint64" },
      { name: "deadline", type: "uint64" },
    ],
  },
  AuthorizeDelegate: {
    contract: "escrow",
    fields: [
      { name: "payer", type: "address" },
      { name: "delegate", type: "address" },
      { name: "maxVoucherAmount", type: "uint64" },
      { name: "maxPerWindow", type: "uint64" },
      { name: "validUntil", type: "uint64" },
      { name: "nonce", type: "uint64" },
      { name: "deadline", type: "uint64" },
    ],
  },
  RevokeDelegate: {
    contract: "escrow",
    fields: [
      { name: "payer", type: "address" },
      { name: "delegate", type: "address" },
      { name: "nonce", type: "uint64" },
      { name: "deadline", type: "uint64" },
    ],
  },
  /*
    The payment voucher. The console signs one only to settle a buyer debt —
    a replacement for a served call whose own voucher lapsed (assay-backend
    `chains/evm/eip712/voucher.ts`, `VOUCHER_TYPES`).
  */
  Voucher: {
    contract: "escrow",
    fields: [
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
  PayoutProof: {
    contract: "escrow",
    fields: [
      { name: "account", type: "address" },
      { name: "organizationId", type: "string" },
      { name: "nonce", type: "string" },
      { name: "expiresAt", type: "uint64" },
    ],
  },
  StakeAuthorityProof: {
    contract: "stake",
    fields: [
      { name: "account", type: "address" },
      { name: "organizationId", type: "string" },
      { name: "nonce", type: "string" },
      { name: "expiresAt", type: "uint64" },
    ],
  },
};

/** The functions this app sends, per pinned contract. Anything else does not decode and is refused. */
const CONTRACT_ABIS: Record<PinnedContract, Abi> = {
  escrow: parseAbi([
    "function setLimits(uint64 maxVoucherAmount, uint64 maxPerWindow)",
    "function requestWithdraw(uint64 amount)",
    "function withdraw()",
    "function depositFor(address buyer, uint64 amount)",
  ]),
  stake: parseAbi([
    "function depositStake(uint64 amount)",
    "function requestUnstake(uint64 amount)",
    "function withdrawStake(uint64 amount)",
    "function disputeSlashBatch(bytes32[] requestIds)",
    "function upholdSlashBatch(bytes32[] requestIds)",
    "function cancelSlashBatch(bytes32[] requestIds)",
    "function cancelSlash(bytes32 requestId)",
  ]),
  config: parseAbi(["function setBlocked(address account, bool value)"]),
  token: parseAbi(["function approve(address spender, uint256 amount)"]),
};

function refuse(prefix: string, detail: string): never {
  throw new Error(`${prefix}: ${detail}. Nothing was signed.`);
}

/** The deployment pinned for a CAIP-2 chain; throws when this app knows none. */
export function pinnedDeployment(chainId: string, prefix: string = SIGNING_REFUSED): StakeDeployment {
  const deployment = stakeDeploymentFor(chainId);
  if (!deployment) refuse(prefix, `this app has no pinned contracts for ${chainId}, so it does not sign for it`);
  return deployment;
}

export function pinnedAddress(deployment: StakeDeployment, contract: PinnedContract): `0x${string}` {
  switch (contract) {
    case "escrow":
      return deployment.escrowContract;
    case "stake":
      return deployment.stakeContract;
    case "config":
      return deployment.configContract;
    case "token":
      return deployment.settlementToken;
  }
}

/**
 * Equal as the chain reads them: addresses and hex case-insensitive, numbers
 * by value. An array argument is only ever a batch of request ids, an atomic
 * set, so it compares in any order (but with the same count of each).
 */
function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    const sorted = (values: unknown[]) => values.map((value) => String(value).toLowerCase()).sort();
    const [a, b] = [sorted(left), sorted(right)];
    return a.every((value, i) => value === b[i]);
  }
  if (left === undefined || left === null || right === undefined || right === null) return false;
  return String(left).toLowerCase() === String(right).toLowerCase();
}

export interface ExpectedTypedData {
  /** CAIP-2 chain the signer is bound to; the domain must name it. */
  readonly chainId: string;
  /** The primary types this flow signs. */
  readonly primaryTypes: readonly string[];
  /** Message fields that must equal what the person chose (and who they are). */
  readonly message: Readonly<Record<string, string>>;
}

/**
 * Refuses a typed-data request unless it is exactly a struct this flow signs,
 * under the pinned "Assay Settlement" v2 domain for `expected.chainId`, with
 * the canonical field list and the chosen values. Returns the deployment.
 */
export function assertTypedData(
  request: Omit<Eip155TypedDataRequest, "relayed">,
  expected: ExpectedTypedData,
  prefix: string = SIGNING_REFUSED,
): StakeDeployment {
  if (request.namespace !== "eip155" || request.kind !== "typed-data") {
    refuse(prefix, "the request is not an EIP-712 signature request");
  }
  if (request.chainId !== expected.chainId) {
    refuse(prefix, `the request is for ${request.chainId}, not ${expected.chainId}`);
  }
  const deployment = pinnedDeployment(expected.chainId, prefix);
  const spec = TYPED_DATA[request.primaryType];
  if (!spec || !expected.primaryTypes.includes(request.primaryType)) {
    refuse(prefix, `this screen signs ${expected.primaryTypes.join(" or ")}, not ${request.primaryType}`);
  }

  const problems: string[] = [];
  const domain = request.domain;
  if (domain.name !== EIP712_DOMAIN_NAME) problems.push("name");
  if (domain.version !== EIP712_DOMAIN_VERSION) problems.push("version");
  if (String(domain.chainId) !== expected.chainId.slice(expected.chainId.indexOf(":") + 1)) {
    problems.push("chainId");
  }
  if (!sameValue(domain.verifyingContract, pinnedAddress(deployment, spec.contract))) {
    problems.push("verifyingContract");
  }
  if ((domain as { salt?: unknown }).salt !== undefined) problems.push("salt");
  const fields = request.types[request.primaryType];
  if (
    !fields ||
    fields.length !== spec.fields.length ||
    fields.some((f, i) => f.name !== spec.fields[i].name || f.type !== spec.fields[i].type) ||
    Object.keys(request.types).some((t) => t !== request.primaryType && t !== "EIP712Domain")
  ) {
    problems.push("types");
  }
  if (problems.length > 0) {
    refuse(prefix, `the request to sign is not for this app's ${spec.contract} contract (${problems.join(", ")})`);
  }

  const mismatched = Object.entries(expected.message)
    .filter(([name, want]) => !sameValue(request.message[name], want))
    .map(([name]) => name);
  if (mismatched.length > 0) {
    refuse(prefix, `the request to sign does not match what you chose (${mismatched.join(", ")})`);
  }
  return deployment;
}

export interface ContractCallLike {
  readonly chainId: string;
  readonly to: string;
  readonly data: string;
  readonly value: string;
}

export interface DecodedCall {
  readonly contract: PinnedContract;
  readonly to: `0x${string}`;
  readonly functionName: string;
  readonly args: readonly unknown[];
}

/**
 * Decodes a call against the pinned contract it is addressed to. Throws when
 * `to` is no pinned contract on that chain, or the calldata is no function
 * this app sends to it.
 */
export function decodePinnedCall(call: ContractCallLike, prefix: string = SIGNING_REFUSED): DecodedCall {
  const deployment = pinnedDeployment(call.chainId, prefix);
  if (!isAddress(call.to, { strict: false })) refuse(prefix, `${call.to} is not an address`);
  const contract = (["escrow", "stake", "config", "token"] as const).find((name) =>
    sameValue(pinnedAddress(deployment, name), call.to),
  );
  if (!contract) refuse(prefix, `${call.to} is none of this app's contracts on ${call.chainId}`);
  if (!/^0x[0-9a-fA-F]*$/.test(call.data)) refuse(prefix, "the calldata is not hex");
  let decoded: { functionName: string; args?: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: CONTRACT_ABIS[contract], data: call.data as `0x${string}` });
  } catch {
    refuse(prefix, `the calldata is no function this app sends to the ${contract} contract`);
  }
  return {
    contract,
    to: pinnedAddress(deployment, contract),
    functionName: decoded.functionName,
    args: decoded.args ?? [],
  };
}

export interface ExpectedCall {
  readonly contract: PinnedContract;
  readonly functionName: string;
  /** In calldata order; numbers as decimal strings or bigints, addresses in any case. */
  readonly args: readonly unknown[];
}

/**
 * Refuses a contract call unless it goes to the pinned `expected.contract`,
 * carries no value, and decodes to exactly `expected.functionName(args)`.
 */
export function assertContractCall(
  call: ContractCallLike,
  expected: ExpectedCall,
  prefix: string = SIGNING_REFUSED,
): DecodedCall {
  if (call.value !== "0") refuse(prefix, `the call carries a value of ${call.value} wei`);
  const decoded = decodePinnedCall(call, prefix);
  if (decoded.contract !== expected.contract) {
    refuse(prefix, `the call is addressed to the ${decoded.contract} contract, not the ${expected.contract} contract`);
  }
  if (decoded.functionName !== expected.functionName) {
    refuse(prefix, `the call is ${decoded.functionName}, not ${expected.functionName}`);
  }
  if (
    decoded.args.length !== expected.args.length ||
    decoded.args.some((value, i) => !sameValue(value, expected.args[i]))
  ) {
    refuse(prefix, `the ${decoded.functionName} arguments are not what you chose`);
  }
  return decoded;
}

/** One decoded argument as text, for a confirm screen. */
export function formatCallArg(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(formatCallArg).join(", ")}]`;
  return String(value);
}
