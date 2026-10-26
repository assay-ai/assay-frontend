import type { Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

import { PINNED_STAKE } from "./deployments";
import {
  PROVIDER,
  cancelledLog,
  disputedLog,
  executedLog,
  proposedLog,
  record,
  requestId,
  unknownLog,
  upheldLog,
} from "./fixtures";
import { loadChainSlashes, type StakeChainReader } from "./load";
import { SlashLogCache, type RawLog } from "./scan";

const DEPLOY = PINNED_STAKE.deployBlock;

function reader(
  logs: RawLog[],
  records: Record<string, ReturnType<typeof record> | Error>,
  opts: { asset?: Error; head?: bigint } = {},
): StakeChainReader {
  return {
    getBlockNumber: vi.fn(async () => opts.head ?? DEPLOY + BigInt(10_000)),
    getLogs: vi.fn(async () => logs),
    readSlashRecord: vi.fn(async (id: Hex) => {
      const value = records[id.toLowerCase()];
      if (!value) throw new Error("no record");
      if (value instanceof Error) throw value;
      return value;
    }),
    readAssetMeta: vi.fn(async () => {
      if (opts.asset) throw opts.asset;
      return { decimals: 6, symbol: "USDG" };
    }),
  };
}

const at = (n: number) => Number(DEPLOY) + n;

describe("loadChainSlashes", () => {
  it("scans from the deployment block, reads each record once, and builds the rows", async () => {
    const r = reader(
      [
        proposedLog(1, { block: at(1) }),
        proposedLog(2, { block: at(2) }),
        executedLog(2, { block: at(3) }),
        proposedLog(3, { block: at(4) }),
        cancelledLog(3, { block: at(5), reason: 1 }),
        unknownLog(1),
      ],
      {
        [requestId(1)]: record({ status: 4 }),
        [requestId(2)]: record({ status: 2, applied: BigInt(500_000) }),
        [requestId(3)]: record({ status: 3 }),
      },
    );
    const result = await loadChainSlashes(r, PINNED_STAKE, PROVIDER, { cache: new SlashLogCache() });

    expect(vi.mocked(r.getLogs).mock.calls[0][0]).toMatchObject({
      address: PINNED_STAKE.stakeContract,
      fromBlock: DEPLOY,
    });
    expect(r.readSlashRecord).toHaveBeenCalledTimes(3);
    expect(result.asset).toEqual({ decimals: 6, symbol: "USDG", fromChain: true });
    expect(result.recordReadFailures).toBe(0);
    const byId = new Map(result.rows.map((row) => [row.requestId, row]));
    expect(byId.get(requestId(1))?.status.label).toBe("Disputed on chain — awaiting arbiter");
    expect(byId.get(requestId(2))?.applied).toBe(BigInt(500_000));
    expect(byId.get(requestId(3))?.cancelReason).toMatch(/expired/i);
  });

  it("still lists a penalty whose record read failed, from its events", async () => {
    const r = reader([proposedLog(1, { block: at(1) })], { [requestId(1)]: new Error("eth_call reverted") });
    const result = await loadChainSlashes(r, PINNED_STAKE, PROVIDER, { cache: new SlashLogCache() });
    expect(result.recordReadFailures).toBe(1);
    expect(result.rows[0]).toMatchObject({ status: { key: "pending" }, stateSource: "events" });
  });

  it("uses the pinned decimals when the token cannot be read, and says so", async () => {
    const r = reader([], {}, { asset: new Error("nope") });
    const result = await loadChainSlashes(r, PINNED_STAKE, PROVIDER, { cache: new SlashLogCache() });
    expect(result.asset).toEqual({ decimals: 6, symbol: "USDG", fromChain: false });
  });

  it("fails as a whole when the logs cannot be read: unknown is not none", async () => {
    const r = reader([], {});
    vi.mocked(r.getLogs).mockRejectedValue(new Error("fetch failed"));
    await expect(
      loadChainSlashes(r, PINNED_STAKE, PROVIDER, { cache: new SlashLogCache() }),
    ).rejects.toThrow("fetch failed");
  });

  it("answers an empty list when the chain has nothing for this provider", async () => {
    const result = await loadChainSlashes(reader([], {}), PINNED_STAKE, PROVIDER, {
      cache: new SlashLogCache(),
    });
    expect(result.rows).toEqual([]);
    expect(result.scannedTo).toBe(DEPLOY + BigInt(10_000));
  });
});

describe("loadChainSlashes — when a dispute was upheld", () => {
  it("reads the uphold's block time, once per block, and puts it on the row", async () => {
    const r: StakeChainReader = {
      ...reader(
        [proposedLog(1, { block: at(1) }), disputedLog(1, { block: at(2) }), upheldLog(1, { block: at(3) })],
        { [requestId(1).toLowerCase()]: record({ status: 1, disputedAt: BigInt(1_100_000) }) },
      ),
      readBlockTimestamp: vi.fn(async () => BigInt(1_150_000)),
    };
    const result = await loadChainSlashes(r, PINNED_STAKE, PROVIDER, { cache: new SlashLogCache() });
    expect(r.readBlockTimestamp).toHaveBeenCalledTimes(1);
    expect(r.readBlockTimestamp).toHaveBeenCalledWith(BigInt(at(3)));
    expect(result.rows[0]).toMatchObject({ status: { key: "upheld" }, upheldAt: 1_150_000 });
  });

  it("still loads when the block time cannot be read", async () => {
    const r: StakeChainReader = {
      ...reader(
        [proposedLog(1, { block: at(1) }), upheldLog(1, { block: at(3) })],
        { [requestId(1).toLowerCase()]: record({ status: 1, disputedAt: BigInt(1_100_000) }) },
      ),
      readBlockTimestamp: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    };
    const result = await loadChainSlashes(r, PINNED_STAKE, PROVIDER, { cache: new SlashLogCache() });
    expect(result.rows[0]).toMatchObject({ status: { key: "upheld" }, upheldAt: null });
  });
});
