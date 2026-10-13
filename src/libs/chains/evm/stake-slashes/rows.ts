import { decodeEventLog, type Address, type Hex } from "viem";

import { STAKE_EVENTS_ABI } from "./abi";
import type { RawLog } from "./scan";
import { cancelReasonLabel, slashStatusOf, type SlashStatusInfo } from "./status";

/**
 * Logs plus `slashRecordOf` reads → one row per slash request.
 *
 * The **record is the current state** and wins wherever it was read. The
 * events supply what the record does not keep: the cancel reason (only in
 * `SlashCancelled`) and the transaction hashes. When a record read fails, the
 * row still renders from its events and says so (`stateSource: "events"`), so
 * one bad `eth_call` cannot hide a pending penalty.
 */

export type ParsedStakeLog =
  | {
      readonly kind: "proposed";
      readonly requestId: Hex;
      readonly provider: Address;
      readonly beneficiary: Address;
      readonly penalty: bigint;
      readonly reserved: bigint;
      readonly proposedAt: bigint;
      readonly executableAt: bigint;
      readonly txHash: Hex | null;
      readonly blockNumber: bigint | null;
    }
  | {
      readonly kind: "executed";
      readonly requestId: Hex;
      readonly provider: Address;
      readonly beneficiary: Address;
      readonly penalty: bigint;
      readonly applied: bigint;
      readonly executedAt: bigint;
      readonly txHash: Hex | null;
      readonly blockNumber: bigint | null;
    }
  | {
      readonly kind: "cancelled";
      readonly requestId: Hex;
      readonly provider: Address;
      readonly reason: number;
      readonly cancelledAt: bigint;
      readonly txHash: Hex | null;
      readonly blockNumber: bigint | null;
    };

/**
 * One raw log → a typed event, or `null` for a log this page does not know
 * (a `SlashDisputed` from the upcoming contract, or anything else). Never throws.
 */
export function parseStakeLog(log: RawLog): ParsedStakeLog | null {
  let decoded;
  try {
    decoded = decodeEventLog({
      abi: STAKE_EVENTS_ABI,
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
    });
  } catch {
    return null;
  }
  const txHash = log.transactionHash;
  const blockNumber = log.blockNumber === null ? null : BigInt(log.blockNumber);
  switch (decoded.eventName) {
    case "SlashProposed":
      return {
        kind: "proposed",
        requestId: decoded.args.requestId,
        provider: decoded.args.provider,
        beneficiary: decoded.args.beneficiary,
        penalty: decoded.args.penalty,
        reserved: decoded.args.reserved,
        proposedAt: decoded.args.proposedAt,
        executableAt: decoded.args.executableAt,
        txHash,
        blockNumber,
      };
    case "SlashExecuted":
      return {
        kind: "executed",
        requestId: decoded.args.requestId,
        provider: decoded.args.provider,
        beneficiary: decoded.args.beneficiary,
        penalty: decoded.args.penalty,
        applied: decoded.args.applied,
        executedAt: decoded.args.executedAt,
        txHash,
        blockNumber,
      };
    case "SlashCancelled":
      return {
        kind: "cancelled",
        requestId: decoded.args.requestId,
        provider: decoded.args.provider,
        reason: decoded.args.reason,
        cancelledAt: decoded.args.cancelledAt,
        txHash,
        blockNumber,
      };
    default:
      return null;
  }
}

/** `slashRecordOf(requestId)`, the fields this page reads. `status` is the raw enum value. */
export interface SlashRecordState {
  readonly provider: Address;
  readonly status: number;
  readonly penalty: bigint;
  readonly beneficiary: Address;
  readonly proposedAt: bigint;
  readonly executableAt: bigint;
  readonly reserved: bigint;
  readonly applied: bigint;
  readonly executedAt: bigint;
}

export interface ChainSlashRow {
  /** 32-byte request id, lower-case hex with `0x`. */
  readonly requestId: Hex;
  readonly status: SlashStatusInfo;
  /** Only for a cancelled record. */
  readonly cancelReason: string | null;
  /** Atomic units of the stake asset. */
  readonly penalty: bigint;
  readonly reserved: bigint;
  /** What the chain took. `null` until executed. */
  readonly applied: bigint | null;
  readonly beneficiary: Address;
  /** Unix seconds. */
  readonly proposedAt: number;
  /** Unix seconds: the dispute window ends and execution may start here. */
  readonly executableAt: number;
  readonly proposeTx: Hex | null;
  /** The execute or cancel transaction, whichever closed the record. */
  readonly closeTx: Hex | null;
  /** `record` when `slashRecordOf` answered; `events` when it did not and the logs were used. */
  readonly stateSource: "record" | "events";
}

const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Group parsed logs by request id and merge each group with its record.
 *
 * Logs for another provider are dropped (the topic filter should already
 * exclude them; this is the belt). A record whose `provider` is not this
 * provider is ignored and the row falls back to its events — a record cannot
 * move between providers, so a mismatch means the read is not to be trusted.
 */
export function buildChainSlashRows(
  provider: Address,
  logs: readonly ParsedStakeLog[],
  records: ReadonlyMap<string, SlashRecordState>,
): ChainSlashRow[] {
  const groups = new Map<string, ParsedStakeLog[]>();
  for (const log of logs) {
    if (!sameAddress(log.provider, provider)) continue;
    const id = log.requestId.toLowerCase();
    const group = groups.get(id);
    if (group) group.push(log);
    else groups.set(id, [log]);
  }

  const rows: ChainSlashRow[] = [];
  for (const [id, group] of groups) {
    const proposed = group.find((log) => log.kind === "proposed");
    const executed = group.find((log) => log.kind === "executed");
    const cancelled = group.find((log) => log.kind === "cancelled");
    const rawRecord = records.get(id);
    const record =
      rawRecord && rawRecord.status !== 0 && sameAddress(rawRecord.provider, provider)
        ? rawRecord
        : undefined;

    if (!proposed && !record) continue;

    const eventCode = cancelled ? 3 : executed ? 2 : 1;
    const status = slashStatusOf(record ? record.status : eventCode);
    const executedApplied = executed?.kind === "executed" ? executed.applied : null;

    rows.push({
      requestId: id as Hex,
      status,
      cancelReason:
        status.key === "cancelled" && cancelled?.kind === "cancelled"
          ? cancelReasonLabel(cancelled.reason)
          : null,
      penalty: record?.penalty ?? (proposed?.kind === "proposed" ? proposed.penalty : BigInt(0)),
      reserved: record?.reserved ?? (proposed?.kind === "proposed" ? proposed.reserved : BigInt(0)),
      applied: status.key === "executed" ? (record?.applied ?? executedApplied) : null,
      beneficiary:
        record?.beneficiary ??
        (proposed?.kind === "proposed" ? proposed.beneficiary : ("0x" as Address)),
      proposedAt: Number(
        record?.proposedAt ?? (proposed?.kind === "proposed" ? proposed.proposedAt : BigInt(0)),
      ),
      executableAt: Number(
        record?.executableAt ?? (proposed?.kind === "proposed" ? proposed.executableAt : BigInt(0)),
      ),
      proposeTx: proposed?.txHash ?? null,
      closeTx: executed?.txHash ?? cancelled?.txHash ?? null,
      stateSource: record ? "record" : "events",
    });
  }
  return rows;
}

/** The distinct request ids in a set of parsed logs, lower-case. */
export function requestIdsOf(logs: readonly ParsedStakeLog[]): Hex[] {
  return [...new Set(logs.map((log) => log.requestId.toLowerCase()))] as Hex[];
}
