import { decodeEventLog, type Address, type Hex } from "viem";

import { DISPUTE_TIMEOUT_SECONDS, STAKE_EVENTS_ABI } from "./abi";
import type { RawLog } from "./scan";
import { cancelReasonLabel, slashRecordStatusOf, type SlashStatusInfo } from "./status";

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
      /** The split the chain applied, as `SlashExecuted` recorded it. */
      readonly agentAmount?: bigint;
      readonly platformAmount?: bigint;
      readonly providerAmount?: bigint;
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
    }
  | {
      /** `SlashDisputed`: the provider's `disputeSlash` moved the record to `Disputed`. */
      readonly kind: "disputed";
      readonly requestId: Hex;
      readonly provider: Address;
      readonly disputedAt: bigint;
      readonly executableAt: bigint;
      readonly txHash: Hex | null;
      readonly blockNumber: bigint | null;
    }
  | {
      /** `SlashUpheld`: the arbiter ruled against the provider; back to `Pending`, executable from `executableAt`. */
      readonly kind: "upheld";
      readonly requestId: Hex;
      readonly provider: Address;
      readonly arbiter: Address;
      readonly executableAt: bigint;
      readonly txHash: Hex | null;
      readonly blockNumber: bigint | null;
    };

/**
 * One raw log → a typed event, or `null` for a log this page does not know.
 * Never throws.
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
        agentAmount: decoded.args.agentAmount,
        platformAmount: decoded.args.platformAmount,
        providerAmount: decoded.args.providerAmount,
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
    case "SlashDisputed":
      return {
        kind: "disputed",
        requestId: decoded.args.requestId,
        provider: decoded.args.provider,
        disputedAt: decoded.args.disputedAt,
        executableAt: decoded.args.executableAt,
        txHash,
        blockNumber,
      };
    case "SlashUpheld":
      return {
        kind: "upheld",
        requestId: decoded.args.requestId,
        provider: decoded.args.provider,
        arbiter: decoded.args.arbiter,
        executableAt: decoded.args.executableAt,
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
  /** Unix seconds; 0 when never disputed. */
  readonly disputedAt: bigint;
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
  /**
   * An executed record's split as `SlashExecuted` recorded it (agents,
   * platform, and the provider's share never taken). `null` before execution
   * or when the event was not seen; absent in older fixtures.
   */
  readonly executedSplit?: { agentAmount: bigint; platformAmount: bigint; providerAmount: bigint } | null;
  readonly beneficiary: Address;
  /** Unix seconds. */
  readonly proposedAt: number;
  /**
   * Unix seconds: the dispute window ends and execution may start here. The
   * chain's own value — the slash delay is a Config parameter, never assumed
   * to be 72 hours — and moved to the ruling time by an arbiter's uphold.
   */
  readonly executableAt: number;
  /** Unix seconds the provider disputed it on chain, or `null` if it never was. */
  readonly disputedAt: number | null;
  /**
   * Unix seconds from which an unruled dispute can be expired (`disputedAt` +
   * 30 days), releasing the stake. Only while the record is `Disputed`.
   */
  readonly disputeExpiresAt: number | null;
  /**
   * True once the arbiter upheld a dispute: a record is disputed at most once.
   * Read from the record (`Pending` or `Executed` with a `disputedAt`) as well
   * as from a scanned `SlashUpheld`, so a missed event does not hide it.
   */
  readonly upheld: boolean;
  /**
   * Unix seconds of the block that carried `SlashUpheld`, when that event was
   * scanned and its block time could be read. The event itself has no time.
   */
  readonly upheldAt: number | null;
  /** The `upholdSlash` transaction, when its event was seen. */
  readonly upheldTx: Hex | null;
  /** The `disputeSlash` transaction, when its event was seen. */
  readonly disputeTx: Hex | null;
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
  /** Unix seconds by block number (decimal string), for the blocks of `SlashUpheld` logs. */
  blockTimes: ReadonlyMap<string, number> = new Map(),
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
    const lastDisputed = latest(group, "disputed");
    const lastUpheld = latest(group, "upheld");
    const rawRecord = records.get(id);
    const record =
      rawRecord && rawRecord.status !== 0 && sameAddress(rawRecord.provider, provider)
        ? rawRecord
        : undefined;

    if (!proposed && !record) continue;

    /*
      From the events alone: a closing event wins; otherwise the later of the
      dispute and the uphold decides between Disputed and Pending.
    */
    const ruledAfterDispute =
      lastUpheld !== null && (lastDisputed === null || isAfter(lastUpheld, lastDisputed));
    const eventCode = cancelled ? 3 : executed ? 2 : lastDisputed && !ruledAfterDispute ? 4 : 1;
    const eventDisputedAtRaw = lastDisputed?.kind === "disputed" ? lastDisputed.disputedAt : null;
    /* Pending with a dispute behind it is an upheld record (see `status.ts`). */
    const everDisputed =
      (record !== undefined && record.disputedAt > BigInt(0)) || lastDisputed !== null || lastUpheld !== null;
    const status = slashRecordStatusOf(record ? record.status : eventCode, everDisputed);
    const executedApplied = executed?.kind === "executed" ? executed.applied : null;

    const eventExecutableAt =
      lastUpheld?.kind === "upheld"
        ? lastUpheld.executableAt
        : proposed?.kind === "proposed"
          ? proposed.executableAt
          : BigInt(0);
    const recordDisputedAt = record && record.disputedAt > BigInt(0) ? record.disputedAt : null;
    const disputedAtRaw = recordDisputedAt ?? eventDisputedAtRaw;
    const disputedAt = disputedAtRaw === null ? null : Number(disputedAtRaw);

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
      executedSplit:
        status.key === "executed" &&
        executed?.kind === "executed" &&
        executed.agentAmount !== undefined &&
        executed.platformAmount !== undefined &&
        executed.providerAmount !== undefined
          ? {
              agentAmount: executed.agentAmount,
              platformAmount: executed.platformAmount,
              providerAmount: executed.providerAmount,
            }
          : null,
      beneficiary:
        record?.beneficiary ??
        (proposed?.kind === "proposed" ? proposed.beneficiary : ("0x" as Address)),
      proposedAt: Number(
        record?.proposedAt ?? (proposed?.kind === "proposed" ? proposed.proposedAt : BigInt(0)),
      ),
      executableAt: Number(record?.executableAt ?? eventExecutableAt),
      disputedAt,
      disputeExpiresAt:
        status.key === "disputed" && disputedAt !== null ? disputedAt + DISPUTE_TIMEOUT_SECONDS : null,
      upheld:
        lastUpheld !== null ||
        status.key === "upheld" ||
        (status.key === "executed" && disputedAt !== null),
      upheldAt:
        lastUpheld?.blockNumber !== null && lastUpheld?.blockNumber !== undefined
          ? (blockTimes.get(lastUpheld.blockNumber.toString()) ?? null)
          : null,
      upheldTx: lastUpheld?.txHash ?? null,
      disputeTx: lastDisputed?.txHash ?? null,
      proposeTx: proposed?.txHash ?? null,
      closeTx: executed?.txHash ?? cancelled?.txHash ?? null,
      stateSource: record ? "record" : "events",
    });
  }
  return rows;
}

/** The last log of one kind in a group, by block (and by scan order within a block). */
function latest(group: readonly ParsedStakeLog[], kind: ParsedStakeLog["kind"]): ParsedStakeLog | null {
  let found: ParsedStakeLog | null = null;
  for (const log of group) {
    if (log.kind !== kind) continue;
    if (found === null || !isAfter(found, log)) found = log;
  }
  return found;
}

/** True when `a` was mined strictly after `b`. Equal or unknown blocks are not "after". */
function isAfter(a: ParsedStakeLog, b: ParsedStakeLog): boolean {
  if (a.blockNumber === null || b.blockNumber === null) return false;
  return a.blockNumber > b.blockNumber;
}

/** The distinct request ids in a set of parsed logs, lower-case. */
export function requestIdsOf(logs: readonly ParsedStakeLog[]): Hex[] {
  return [...new Set(logs.map((log) => log.requestId.toLowerCase()))] as Hex[];
}
