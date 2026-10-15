import { describe, expect, it } from "vitest";

import {
  BENEFICIARY,
  OTHER_PROVIDER,
  PROVIDER,
  cancelledLog,
  executedLog,
  proposedLog,
  record,
  requestId,
  unknownLog,
} from "./fixtures";
import { buildChainSlashRows, parseStakeLog, requestIdsOf, type ParsedStakeLog } from "./rows";

const parse = (...logs: ReturnType<typeof proposedLog>[]) =>
  logs.map(parseStakeLog).filter((log): log is ParsedStakeLog => log !== null);

describe("parseStakeLog", () => {
  it("decodes SlashProposed with its amounts and both clocks", () => {
    const parsed = parseStakeLog(
      proposedLog(1, { penalty: BigInt(150_000), reserved: BigInt(120_000), proposedAt: 500, executableAt: 900 }),
    );
    expect(parsed).toMatchObject({
      kind: "proposed",
      requestId: requestId(1),
      provider: PROVIDER,
      beneficiary: BENEFICIARY,
      penalty: BigInt(150_000),
      reserved: BigInt(120_000),
      proposedAt: BigInt(500),
      executableAt: BigInt(900),
      blockNumber: BigInt(100),
    });
    expect(parsed?.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("decodes SlashExecuted's applied amount", () => {
    expect(parseStakeLog(executedLog(1, { applied: BigInt(700_000) }))).toMatchObject({
      kind: "executed",
      applied: BigInt(700_000),
    });
  });

  it("decodes SlashCancelled's reason", () => {
    expect(parseStakeLog(cancelledLog(1, { reason: 1 }))).toMatchObject({ kind: "cancelled", reason: 1 });
  });

  it("skips a log from an event it does not know instead of throwing", () => {
    expect(parseStakeLog(unknownLog(1))).toBeNull();
    expect(parseStakeLog({ ...proposedLog(1), data: "0x1234" })).toBeNull();
  });
});

describe("buildChainSlashRows", () => {
  it("takes the current state from the record over the events", () => {
    const logs = parse(proposedLog(1, { penalty: BigInt(1_000_000) }));
    const rows = buildChainSlashRows(
      PROVIDER,
      logs,
      new Map([[requestId(1), record({ status: 4, penalty: BigInt(900_000) })]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: { key: "disputed" }, penalty: BigInt(900_000), stateSource: "record" });
  });

  it("falls back to the events when a record could not be read", () => {
    const rows = buildChainSlashRows(
      PROVIDER,
      parse(proposedLog(1), proposedLog(2), executedLog(2, { applied: BigInt(400_000) }), proposedLog(3), cancelledLog(3, { reason: 2 })),
      new Map(),
    );
    const byId = new Map(rows.map((row) => [row.requestId, row]));
    expect(byId.get(requestId(1))).toMatchObject({ status: { key: "pending" }, applied: null, stateSource: "events" });
    expect(byId.get(requestId(2))).toMatchObject({ status: { key: "executed" }, applied: BigInt(400_000) });
    expect(byId.get(requestId(3))).toMatchObject({ status: { key: "cancelled" } });
    expect(byId.get(requestId(3))?.cancelReason).toMatch(/verifier/i);
  });

  it("carries the cancel reason and both transactions", () => {
    const rows = buildChainSlashRows(
      PROVIDER,
      parse(proposedLog(1), cancelledLog(1, { reason: 0 })),
      new Map([[requestId(1), record({ status: 3 })]]),
    );
    expect(rows[0].cancelReason).toMatch(/arbiter/i);
    expect(rows[0].proposeTx).not.toBeNull();
    expect(rows[0].closeTx).not.toBeNull();
    expect(rows[0].closeTx).not.toBe(rows[0].proposeTx);
  });

  it("only reports applied for an executed record", () => {
    const rows = buildChainSlashRows(
      PROVIDER,
      parse(proposedLog(1), proposedLog(2)),
      new Map([
        [requestId(1), record({ status: 2, applied: BigInt(600_000) })],
        [requestId(2), record({ status: 1, applied: BigInt(0) })],
      ]),
    );
    expect(rows.find((row) => row.requestId === requestId(1))?.applied).toBe(BigInt(600_000));
    expect(rows.find((row) => row.requestId === requestId(2))?.applied).toBeNull();
  });

  it("drops another provider's logs and ignores a record that names another provider", () => {
    const rows = buildChainSlashRows(
      PROVIDER,
      parse(proposedLog(1, { provider: OTHER_PROVIDER }), proposedLog(2)),
      new Map([[requestId(2), record({ provider: OTHER_PROVIDER, status: 2 })]]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ requestId: requestId(2), status: { key: "pending" }, stateSource: "events" });
  });

  it("keeps a record whose status the page does not know, flagged for attention", () => {
    const rows = buildChainSlashRows(PROVIDER, parse(proposedLog(1)), new Map([[requestId(1), record({ status: 7 })]]));
    expect(rows[0].status).toMatchObject({ key: "unknown", needsAttention: true });
  });

  it("matches provider and request id case-insensitively", () => {
    const rows = buildChainSlashRows(
      PROVIDER.toLowerCase() as `0x${string}`,
      parse(proposedLog(1)),
      new Map([[requestId(1).toLowerCase(), record({ status: 2 })]]),
    );
    expect(rows[0].status.key).toBe("executed");
  });
});

describe("requestIdsOf", () => {
  it("lists each request once", () => {
    expect(requestIdsOf(parse(proposedLog(1), executedLog(1), proposedLog(2)))).toEqual([requestId(1), requestId(2)]);
  });
});
