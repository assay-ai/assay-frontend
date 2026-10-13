import { encodeAbiParameters, encodeEventTopics, getAddress, numberToHex, pad, type Address, type Hex } from "viem";

import { STAKE_EVENTS_ABI } from "./abi";
import type { SlashRecordState } from "./rows";
import type { RawLog } from "./scan";

/**
 * Test fixtures: real ABI-encoded logs, so the tests exercise the same decoder
 * the page does rather than a hand-shaped object.
 */

export const CONTRACT: Address = getAddress("0x0af4d08f97b4fa8ba3e47cb025ae8cad509bc73c");
export const PROVIDER: Address = getAddress("0xa271a3407d3302f4b4fbe469b9188487cedd7d45");
export const OTHER_PROVIDER: Address = getAddress("0x1111111111111111111111111111111111111111");
export const VERIFIER: Address = getAddress("0x18a508c9af1c6fc512015276f6ca2e9aabd74680");
export const BENEFICIARY: Address = getAddress("0x64fecbe18e8998cb2990bce631a042f8e2be1659");

export const requestId = (n: number): Hex => pad(numberToHex(n), { size: 32 });
const txHash = (tag: string, n: number): Hex =>
  pad(numberToHex(BigInt(n) + (tag === "p" ? BigInt(0) : tag === "e" ? BigInt(1_000) : BigInt(2_000))), {
    size: 32,
  });

function rawLog(topics: Hex[], data: Hex, block: number, tx: Hex, index = 0): RawLog {
  return {
    address: CONTRACT,
    topics,
    data,
    blockNumber: numberToHex(block),
    transactionHash: tx,
    logIndex: numberToHex(index),
  };
}

export function proposedLog(
  n: number,
  opts: {
    provider?: Address;
    penalty?: bigint;
    reserved?: bigint;
    proposedAt?: number;
    executableAt?: number;
    block?: number;
    beneficiary?: Address;
  } = {},
): RawLog {
  const proposedAt = opts.proposedAt ?? 1_000_000;
  const topics = encodeEventTopics({
    abi: STAKE_EVENTS_ABI,
    eventName: "SlashProposed",
    args: { requestId: requestId(n), provider: opts.provider ?? PROVIDER, verifier: VERIFIER },
  }) as Hex[];
  const data = encodeAbiParameters(
    [
      { type: "address" },
      { type: "bytes32" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "uint64" },
    ],
    [
      opts.beneficiary ?? BENEFICIARY,
      pad("0x01", { size: 32 }),
      opts.penalty ?? BigInt(1_000_000),
      opts.reserved ?? opts.penalty ?? BigInt(1_000_000),
      BigInt(20_000_000),
      BigInt(1_000_000),
      BigInt(proposedAt),
      BigInt(opts.executableAt ?? proposedAt + 72 * 3600),
    ],
  );
  return rawLog(topics, data, opts.block ?? 100, txHash("p", n));
}

export function executedLog(n: number, opts: { applied?: bigint; block?: number } = {}): RawLog {
  const topics = encodeEventTopics({
    abi: STAKE_EVENTS_ABI,
    eventName: "SlashExecuted",
    args: { requestId: requestId(n), provider: PROVIDER, verifier: VERIFIER },
  }) as Hex[];
  const u64 = { type: "uint64" } as const;
  const data = encodeAbiParameters(
    [
      { type: "address" },
      { type: "bytes32" },
      u64,
      u64,
      u64,
      u64,
      u64,
      { type: "uint16" },
      { type: "uint16" },
      u64,
      u64,
      { type: "uint128" },
      u64,
      u64,
      u64,
    ],
    [
      BENEFICIARY,
      pad("0x01", { size: 32 }),
      BigInt(1_000_000),
      opts.applied ?? BigInt(1_000_000),
      BigInt(0),
      BigInt(0),
      BigInt(0),
      0,
      0,
      BigInt(0),
      BigInt(0),
      BigInt(0),
      BigInt(0),
      BigInt(2_000_000),
      BigInt(1_000_000),
    ],
  );
  return rawLog(topics, data, opts.block ?? 200, txHash("e", n));
}

export function cancelledLog(n: number, opts: { reason?: number; block?: number } = {}): RawLog {
  const topics = encodeEventTopics({
    abi: STAKE_EVENTS_ABI,
    eventName: "SlashCancelled",
    args: { requestId: requestId(n), provider: PROVIDER },
  }) as Hex[];
  const data = encodeAbiParameters(
    [{ type: "uint8" }, { type: "uint64" }, { type: "uint64" }, { type: "uint64" }],
    [opts.reason ?? 0, BigInt(1_000_000), BigInt(0), BigInt(2_000_000)],
  );
  return rawLog(topics, data, opts.block ?? 300, txHash("c", n));
}

/** A log from an event this page does not know — e.g. the upcoming `SlashDisputed`. */
export function unknownLog(n: number): RawLog {
  return rawLog(
    [pad("0xdead", { size: 32 }), requestId(n), pad(PROVIDER.toLowerCase() as Hex, { size: 32 })],
    "0x",
    400,
    txHash("c", n + 500),
  );
}

export function record(overrides: Partial<SlashRecordState> = {}): SlashRecordState {
  return {
    provider: PROVIDER,
    status: 1,
    penalty: BigInt(1_000_000),
    beneficiary: BENEFICIARY,
    proposedAt: BigInt(1_000_000),
    executableAt: BigInt(1_000_000 + 72 * 3600),
    reserved: BigInt(1_000_000),
    applied: BigInt(0),
    executedAt: BigInt(0),
    ...overrides,
  };
}
