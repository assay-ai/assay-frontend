import { pad, type Address, type Hex } from "viem";

import { SLASH_EVENT_TOPICS } from "./abi";

/**
 * Chunked `eth_getLogs` from the stake contract's deployment block, with a
 * per-session cache so a refresh only asks for the blocks it has not seen.
 *
 * ## Why chunked, and why adaptive
 *
 * Measured on `https://rpc.testnet.chain.robinhood.com` (2026-10-14): a query
 * with no `address` is refused past 30,000 blocks ("query spans … but only
 * 30000 are allowed … add an address filter"); the same query WITH the stake
 * contract's address answered across the whole 2.6M blocks since deployment.
 * Neither limit is a promise, and another RPC can be stricter. So the scan
 * starts with a large window and halves it whenever the node refuses a range,
 * down to `minChunkSize`; anything that is not a range refusal is a real error
 * and is thrown for the screen to show with a retry.
 */

/** A log as `eth_getLogs` returns it. Block numbers stay as the hex the node sent. */
export interface RawLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly blockNumber: Hex | null;
  readonly transactionHash: Hex | null;
  readonly logIndex: Hex | null;
}

export interface LogRange {
  readonly address: Address;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;
  /** `eth_getLogs` topic filter; `null` is a wildcard and a nested array is OR. */
  readonly topics: readonly (Hex | readonly Hex[] | null)[];
}

/** The two RPC calls a scan needs. A test hands in a fake; the page hands in viem. */
export interface LogSource {
  getBlockNumber(): Promise<bigint>;
  getLogs(range: LogRange): Promise<readonly RawLog[]>;
}

export interface ScanOptions {
  /** First window tried. */
  readonly chunkSize?: bigint;
  /** Smallest window before a range refusal is treated as a real error. */
  readonly minChunkSize?: bigint;
}

export const DEFAULT_CHUNK_SIZE = BigInt(5_000_000);
export const DEFAULT_MIN_CHUNK_SIZE = BigInt(1_000);

/**
 * True when the node refused the block range rather than failing. Matched on
 * the message because every node words it differently and none share a code:
 * geth/erigon "block range", Alchemy "up to a 10K block range", this RPC
 * "query spans … only 30000 are allowed", others "too many results",
 * "query returned more than 10000 results", "limit exceeded", "response size exceeded".
 */
export function isRangeRefusal(error: unknown): boolean {
  const text = errorText(error);
  return /block range|spans|too many|more than \d+ results|limit|exceed|narrow|too large|range is too|max(imum)? (block|range)|-32005/i.test(
    text,
  );
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const details = (error as { details?: unknown }).details;
    return `${error.message} ${typeof details === "string" ? details : ""}`;
  }
  return String(error);
}

/**
 * Every log in `[fromBlock, toBlock]`, in block order, one window at a time.
 * Windows never overlap and never leave a gap: each starts one block after the
 * last one that answered.
 */
export async function scanLogsChunked(
  source: LogSource,
  range: LogRange,
  options: ScanOptions = {},
): Promise<RawLog[]> {
  const minChunk = options.minChunkSize ?? DEFAULT_MIN_CHUNK_SIZE;
  let chunk = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  if (chunk < BigInt(1)) chunk = BigInt(1);
  const out: RawLog[] = [];
  let from = range.fromBlock;
  while (from <= range.toBlock) {
    const to = from + chunk - BigInt(1) < range.toBlock ? from + chunk - BigInt(1) : range.toBlock;
    try {
      const logs = await source.getLogs({ ...range, fromBlock: from, toBlock: to });
      out.push(...logs);
      from = to + BigInt(1);
    } catch (error) {
      if (isRangeRefusal(error) && chunk > minChunk) {
        const half = chunk / BigInt(2);
        chunk = half < minChunk ? minChunk : half;
        continue;
      }
      throw error;
    }
  }
  return out;
}

/** `0xabc…` → the 32-byte topic an indexed `address` is stored as. */
export function addressTopic(address: Address): Hex {
  return pad(address.toLowerCase() as Hex, { size: 32 });
}

/** The topic filter for one provider's whole slash history (see `abi.ts`). */
export function providerSlashTopics(provider: Address): LogRange["topics"] {
  return [[...SLASH_EVENT_TOPICS], null, addressTopic(provider)];
}

function logKey(log: RawLog): string {
  return `${log.transactionHash ?? "?"}:${log.logIndex ?? "?"}`;
}

/**
 * Blocks re-read on every incremental scan, so a log dropped by a short reorg
 * is not kept for the rest of the session. Duplicates are removed by
 * `(transactionHash, logIndex)`.
 */
export const REORG_MARGIN = BigInt(64);

interface CacheEntry {
  scannedTo: bigint;
  logs: RawLog[];
}

/**
 * In-memory only, per browser session (a reload starts over). Keyed by chain,
 * contract and provider, so checking a second address never mixes histories.
 * Nothing is written to `localStorage`: a cached "no penalties" that outlives
 * the tab is exactly the stale answer this page must not give.
 */
export class SlashLogCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    return this.entries.get(key);
  }

  set(key: string, entry: CacheEntry): void {
    this.entries.set(key, entry);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const sessionSlashLogCache = new SlashLogCache();

export interface ProviderScanInput {
  readonly chainId: string;
  readonly contract: Address;
  readonly deployBlock: bigint;
  readonly provider: Address;
}

export interface ProviderScanResult {
  readonly logs: readonly RawLog[];
  /** The last block this answer covers. */
  readonly scannedTo: bigint;
}

/**
 * One provider's slash logs from the deployment block to the chain head,
 * reusing what this session already scanned.
 */
export async function scanProviderSlashLogs(
  source: LogSource,
  input: ProviderScanInput,
  options: ScanOptions & { cache?: SlashLogCache } = {},
): Promise<ProviderScanResult> {
  const cache = options.cache ?? sessionSlashLogCache;
  const key = `${input.chainId}|${input.contract.toLowerCase()}|${input.provider.toLowerCase()}`;
  const head = await source.getBlockNumber();
  const cached = cache.get(key);

  let from = input.deployBlock;
  if (cached) {
    const rewind = cached.scannedTo - REORG_MARGIN + BigInt(1);
    from = rewind > input.deployBlock ? rewind : input.deployBlock;
  }
  if (from > head) {
    return { logs: cached?.logs ?? [], scannedTo: cached?.scannedTo ?? head };
  }

  const fresh = await scanLogsChunked(
    source,
    {
      address: input.contract,
      fromBlock: from,
      toBlock: head,
      topics: providerSlashTopics(input.provider),
    },
    options,
  );

  /* Keep what is below the re-read window; replace the window with the fresh answer. */
  const kept = (cached?.logs ?? []).filter((log) => {
    const block = log.blockNumber === null ? null : BigInt(log.blockNumber);
    return block !== null && block < from;
  });
  const seen = new Set<string>();
  const logs: RawLog[] = [];
  for (const log of [...kept, ...fresh]) {
    const k = logKey(log);
    if (seen.has(k)) continue;
    seen.add(k);
    logs.push(log);
  }
  cache.set(key, { scannedTo: head, logs });
  return { logs, scannedTo: head };
}
