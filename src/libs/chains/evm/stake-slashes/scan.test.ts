import { describe, expect, it, vi } from "vitest";

import { SLASH_CANCELLED_TOPIC, SLASH_EXECUTED_TOPIC, SLASH_PROPOSED_TOPIC } from "./abi";
import { CONTRACT, PROVIDER, proposedLog } from "./fixtures";
import {
  REORG_MARGIN,
  SlashLogCache,
  addressTopic,
  isRangeRefusal,
  providerSlashTopics,
  scanLogsChunked,
  scanProviderSlashLogs,
  type LogRange,
  type LogSource,
  type RawLog,
} from "./scan";

const b = (n: number) => BigInt(n);

/** A fake RPC that serves `logs` by block and refuses any range wider than `maxRange`. */
function fakeSource(logs: RawLog[], head: number, maxRange = Infinity) {
  const calls: { from: bigint; to: bigint }[] = [];
  const source: LogSource = {
    getBlockNumber: vi.fn(async () => b(head)),
    getLogs: vi.fn(async (range: LogRange) => {
      calls.push({ from: range.fromBlock, to: range.toBlock });
      if (Number(range.toBlock - range.fromBlock + b(1)) > maxRange) {
        throw new Error(`query spans too many blocks, but only ${maxRange} are allowed`);
      }
      return logs.filter((log) => {
        const block = BigInt(log.blockNumber!);
        return block >= range.fromBlock && block <= range.toBlock;
      });
    }),
  };
  return { source, calls };
}

const RANGE: LogRange = { address: CONTRACT, fromBlock: b(0), toBlock: b(0), topics: [] };

describe("scanLogsChunked", () => {
  it("covers the range in contiguous windows with no gap and no overlap", async () => {
    const { source, calls } = fakeSource([], 0);
    await scanLogsChunked(source, { ...RANGE, fromBlock: b(10), toBlock: b(35) }, { chunkSize: b(10) });
    expect(calls).toEqual([
      { from: b(10), to: b(19) },
      { from: b(20), to: b(29) },
      { from: b(30), to: b(35) },
    ]);
  });

  it("returns every log in block order", async () => {
    const logs = [proposedLog(1, { block: 12 }), proposedLog(2, { block: 25 }), proposedLog(3, { block: 35 })];
    const { source } = fakeSource(logs, 0);
    const out = await scanLogsChunked(source, { ...RANGE, fromBlock: b(10), toBlock: b(35) }, { chunkSize: b(10) });
    expect(out.map((log) => log.blockNumber)).toEqual(logs.map((log) => log.blockNumber));
  });

  it("halves the window when the node refuses the range, and keeps going", async () => {
    const logs = [proposedLog(1, { block: 5 }), proposedLog(2, { block: 95 })];
    const { source, calls } = fakeSource(logs, 0, 30);
    const out = await scanLogsChunked(
      source,
      { ...RANGE, fromBlock: b(0), toBlock: b(99) },
      { chunkSize: b(100), minChunkSize: b(1) },
    );
    expect(out).toHaveLength(2);
    // 100 refused, 50 refused, 25 accepted from then on.
    expect(calls.slice(0, 3)).toEqual([
      { from: b(0), to: b(99) },
      { from: b(0), to: b(49) },
      { from: b(0), to: b(24) },
    ]);
    expect(calls.at(-1)).toEqual({ from: b(75), to: b(99) });
  });

  it("gives up once the window is at its minimum", async () => {
    const { source } = fakeSource([], 0, 5);
    await expect(
      scanLogsChunked(source, { ...RANGE, fromBlock: b(0), toBlock: b(99) }, { chunkSize: b(40), minChunkSize: b(10) }),
    ).rejects.toThrow(/too many blocks/);
  });

  it("does not retry an error that is not a range refusal", async () => {
    const source: LogSource = {
      getBlockNumber: async () => b(0),
      getLogs: vi.fn(async () => {
        throw new Error("fetch failed");
      }),
    };
    await expect(
      scanLogsChunked(source, { ...RANGE, fromBlock: b(0), toBlock: b(99) }, { chunkSize: b(50) }),
    ).rejects.toThrow("fetch failed");
    expect(source.getLogs).toHaveBeenCalledTimes(1);
  });
});

describe("isRangeRefusal", () => {
  it("recognises the ways nodes word a range limit", () => {
    expect(
      isRangeRefusal(
        new Error("query spans 135012779 blocks (0 to 135012778), but only 30000 are allowed for this request"),
      ),
    ).toBe(true);
    expect(isRangeRefusal(new Error("eth_getLogs is limited to a 10,000 block range"))).toBe(true);
    expect(isRangeRefusal(new Error("query returned more than 10000 results"))).toBe(true);
    expect(isRangeRefusal(new Error("Log response size exceeded."))).toBe(true);
    expect(isRangeRefusal(new Error("fetch failed"))).toBe(false);
  });
});

describe("providerSlashTopics", () => {
  it("ORs the three events and filters topic2 on the provider", () => {
    const topics = providerSlashTopics(PROVIDER);
    expect(topics[0]).toEqual([SLASH_PROPOSED_TOPIC, SLASH_EXECUTED_TOPIC, SLASH_CANCELLED_TOPIC]);
    expect(topics[1]).toBeNull();
    expect(topics[2]).toBe(addressTopic(PROVIDER));
    expect(addressTopic(PROVIDER)).toBe(`0x000000000000000000000000${PROVIDER.slice(2).toLowerCase()}`);
  });
});

describe("scanProviderSlashLogs", () => {
  const input = { chainId: "eip155:46630", contract: CONTRACT, deployBlock: b(100), provider: PROVIDER };

  it("starts at the deployment block and ends at the head", async () => {
    const { source, calls } = fakeSource([proposedLog(1, { block: 150 })], 1_000);
    const result = await scanProviderSlashLogs(source, input, { cache: new SlashLogCache() });
    expect(calls[0].from).toBe(b(100));
    expect(calls.at(-1)!.to).toBe(b(1_000));
    expect(result.scannedTo).toBe(b(1_000));
    expect(result.logs).toHaveLength(1);
  });

  it("asks only for new blocks (plus the reorg margin) on the next read, without duplicating", async () => {
    const cache = new SlashLogCache();
    const logs = [proposedLog(1, { block: 150 }), proposedLog(2, { block: 990 })];
    const first = fakeSource(logs, 1_000);
    await scanProviderSlashLogs(first.source, input, { cache });

    const later = fakeSource([...logs, proposedLog(3, { block: 1_200 })], 1_300);
    const result = await scanProviderSlashLogs(later.source, input, { cache });
    expect(later.calls[0].from).toBe(b(1_000) - REORG_MARGIN + b(1));
    expect(result.logs.map((log) => BigInt(log.blockNumber!))).toEqual([b(150), b(990), b(1_200)]);
  });

  it("drops a log a reorg removed from the re-read window", async () => {
    const cache = new SlashLogCache();
    await scanProviderSlashLogs(fakeSource([proposedLog(1, { block: 995 })], 1_000).source, input, { cache });
    const result = await scanProviderSlashLogs(fakeSource([], 1_010).source, input, { cache });
    expect(result.logs).toHaveLength(0);
  });

  it("keeps separate histories per provider", async () => {
    const cache = new SlashLogCache();
    await scanProviderSlashLogs(fakeSource([proposedLog(1, { block: 150 })], 1_000).source, input, { cache });
    const other = fakeSource([], 1_000);
    await scanProviderSlashLogs(
      other.source,
      { ...input, provider: "0x2222222222222222222222222222222222222222" },
      { cache },
    );
    expect(other.calls[0].from).toBe(b(100));
  });

  it("does not cache a failed scan", async () => {
    const cache = new SlashLogCache();
    const failing: LogSource = {
      getBlockNumber: async () => b(1_000),
      getLogs: async () => {
        throw new Error("fetch failed");
      },
    };
    await expect(scanProviderSlashLogs(failing, input, { cache })).rejects.toThrow();
    const retry = fakeSource([], 1_000);
    await scanProviderSlashLogs(retry.source, input, { cache });
    expect(retry.calls[0].from).toBe(b(100));
  });
});
