import { createPublicClient, http, numberToHex, type Address, type Hex } from "viem";

import { ERC20_METADATA_ABI, STAKE_VIEWS_ABI } from "./abi";
import type { StakeDeployment } from "./deployments";
import { buildChainSlashRows, parseStakeLog, requestIdsOf, type ChainSlashRow, type SlashRecordState } from "./rows";
import { scanProviderSlashLogs, type LogSource, type RawLog, type ScanOptions, type SlashLogCache } from "./scan";

/**
 * The whole read, from the browser straight to the RPC. No request on this
 * path goes to Assay's backend.
 */

export interface AssetMeta {
  readonly decimals: number;
  readonly symbol: string;
  /** False when the token could not be read and the pinned fallback is shown. */
  readonly fromChain: boolean;
}

/** Everything the page reads from the chain. A test hands in a fake. */
export interface StakeChainReader extends LogSource {
  readSlashRecord(requestId: Hex): Promise<SlashRecordState>;
  readAssetMeta(): Promise<{ decimals: number; symbol: string }>;
}

/** The real reader: viem over the pinned public RPC. */
export function createStakeChainReader(deployment: StakeDeployment): StakeChainReader {
  const client = createPublicClient({
    transport: http(deployment.rpcUrl, { retryCount: 1, timeout: 20_000 }),
  });
  const contract = deployment.stakeContract;

  return {
    getBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),

    async getLogs(range) {
      const logs = await client.request({
        method: "eth_getLogs",
        params: [
          {
            address: range.address,
            fromBlock: numberToHex(range.fromBlock),
            toBlock: numberToHex(range.toBlock),
            topics: range.topics as (Hex | Hex[] | null)[],
          },
        ],
      });
      return logs as unknown as RawLog[];
    },

    async readSlashRecord(requestId) {
      const record = await client.readContract({
        address: contract,
        abi: STAKE_VIEWS_ABI,
        functionName: "slashRecordOf",
        args: [requestId],
      });
      return {
        provider: record.provider,
        status: Number(record.status),
        penalty: record.penalty,
        beneficiary: record.beneficiary,
        proposedAt: record.proposedAt,
        executableAt: record.executableAt,
        reserved: record.reserved,
        applied: record.applied,
        executedAt: record.executedAt,
      };
    },

    async readAssetMeta() {
      const asset = await client.readContract({
        address: contract,
        abi: STAKE_VIEWS_ABI,
        functionName: "ASSET",
      });
      const [decimals, symbol] = await Promise.all([
        client.readContract({ address: asset, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
        client.readContract({ address: asset, abi: ERC20_METADATA_ABI, functionName: "symbol" }),
      ]);
      return { decimals: Number(decimals), symbol };
    },
  };
}

export interface ChainSlashesResult {
  readonly rows: readonly ChainSlashRow[];
  /** The chain head this answer covers. */
  readonly scannedTo: bigint;
  readonly asset: AssetMeta;
  /** Rows whose `slashRecordOf` read failed and were built from events alone. */
  readonly recordReadFailures: number;
}

/** Run `fn` over `items` with at most `limit` in flight, keeping input order. */
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function loadChainSlashes(
  reader: StakeChainReader,
  deployment: StakeDeployment,
  provider: Address,
  options: ScanOptions & { cache?: SlashLogCache; concurrency?: number } = {},
): Promise<ChainSlashesResult> {
  /*
    The scan is the part that must succeed: if the logs cannot be read, the
    page does not know whether there are penalties, and it says so with a
    retry. The asset read and each record read are allowed to fail on their own.
  */
  const [scan, asset] = await Promise.all([
    scanProviderSlashLogs(
      reader,
      {
        chainId: deployment.chainId,
        contract: deployment.stakeContract,
        deployBlock: deployment.deployBlock,
        provider,
      },
      options,
    ),
    reader.readAssetMeta().then(
      (meta): AssetMeta => ({ ...meta, fromChain: true }),
      (): AssetMeta => ({
        decimals: deployment.fallbackAssetDecimals,
        symbol: deployment.fallbackAssetSymbol,
        fromChain: false,
      }),
    ),
  ]);

  const parsed = scan.logs.map(parseStakeLog).filter((log) => log !== null);
  const ids = requestIdsOf(parsed);
  const reads = await mapLimited(ids, options.concurrency ?? 4, async (id) => {
    try {
      return [id, await reader.readSlashRecord(id)] as const;
    } catch {
      return [id, null] as const;
    }
  });
  const records = new Map<string, SlashRecordState>();
  let failures = 0;
  for (const [id, record] of reads) {
    if (record) records.set(id.toLowerCase(), record);
    else failures += 1;
  }

  return {
    rows: buildChainSlashRows(provider, parsed, records),
    scannedTo: scan.scannedTo,
    asset,
    recordReadFailures: failures,
  };
}
