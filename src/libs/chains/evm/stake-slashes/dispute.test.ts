import { describe, expect, it } from "vitest";

import { DISPUTE_TIMEOUT_SECONDS, SLASH_DISPUTED_TOPIC, SLASH_UPHELD_TOPIC } from "./abi";
import {
  ARBITER,
  PROVIDER,
  disputedLog,
  proposedLog,
  record,
  requestId,
  upheldLog,
} from "./fixtures";
import { buildChainSlashRows, parseStakeLog, type ParsedStakeLog } from "./rows";
import type { RawLog } from "./scan";

const parse = (...logs: RawLog[]) =>
  logs.map(parseStakeLog).filter((log): log is ParsedStakeLog => log !== null);

describe("parseStakeLog — the dispute events", () => {
  it("decodes SlashDisputed with both clocks", () => {
    const log = disputedLog(1, { disputedAt: 700, executableAt: 900 });
    expect(log.topics[0]).toBe(SLASH_DISPUTED_TOPIC);
    expect(parseStakeLog(log)).toMatchObject({
      kind: "disputed",
      requestId: requestId(1),
      provider: PROVIDER,
      disputedAt: BigInt(700),
      executableAt: BigInt(900),
    });
  });

  it("decodes SlashUpheld with the arbiter and the new executableAt", () => {
    const log = upheldLog(1, { executableAt: 1_500 });
    expect(log.topics[0]).toBe(SLASH_UPHELD_TOPIC);
    expect(parseStakeLog(log)).toMatchObject({
      kind: "upheld",
      provider: PROVIDER,
      arbiter: ARBITER,
      executableAt: BigInt(1_500),
    });
  });
});

describe("buildChainSlashRows — disputes", () => {
  it("shows a disputed record with its dispute time and the 30-day expiry", () => {
    const rows = buildChainSlashRows(
      PROVIDER,
      parse(proposedLog(1), disputedLog(1, { disputedAt: 1_100_000 })),
      new Map([[requestId(1), record({ status: 4, disputedAt: BigInt(1_100_000) })]]),
    );
    expect(rows[0]).toMatchObject({
      status: { key: "disputed", label: "Disputed on chain — awaiting arbiter", needsAttention: true },
      disputedAt: 1_100_000,
      disputeExpiresAt: 1_100_000 + DISPUTE_TIMEOUT_SECONDS,
      upheld: false,
    });
    expect(DISPUTE_TIMEOUT_SECONDS).toBe(30 * 86_400);
    expect(rows[0].disputeTx).not.toBeNull();
  });

  it("reads Disputed from the events when the record cannot be read", () => {
    const rows = buildChainSlashRows(
      PROVIDER,
      parse(proposedLog(1), disputedLog(1, { disputedAt: 1_050_000 })),
      new Map(),
    );
    expect(rows[0]).toMatchObject({ status: { key: "disputed" }, disputedAt: 1_050_000, stateSource: "events" });
  });

  it("goes back to Pending, executable at the ruling time, after an uphold", () => {
    const rows = buildChainSlashRows(
      PROVIDER,
      parse(
        proposedLog(1, { executableAt: 1_259_200 }),
        disputedLog(1, { block: 250 }),
        upheldLog(1, { executableAt: 1_300_000, block: 270 }),
      ),
      new Map(),
    );
    expect(rows[0]).toMatchObject({
      status: { key: "pending" },
      executableAt: 1_300_000,
      upheld: true,
      disputeExpiresAt: null,
    });
  });

  it("prefers the record's own executableAt and disputedAt over the events", () => {
    const rows = buildChainSlashRows(
      PROVIDER,
      parse(proposedLog(1), disputedLog(1, { disputedAt: 1 }), upheldLog(1, { executableAt: 2 })),
      new Map([
        [requestId(1), record({ status: 1, executableAt: BigInt(1_400_000), disputedAt: BigInt(1_110_000) })],
      ]),
    );
    expect(rows[0]).toMatchObject({ executableAt: 1_400_000, disputedAt: 1_110_000, upheld: true });
  });

  it("uses the events' dispute time when the record has none", () => {
    const rows = buildChainSlashRows(
      PROVIDER,
      parse(proposedLog(1), disputedLog(1, { disputedAt: 1_120_000 })),
      new Map([[requestId(1), record({ status: 4, disputedAt: BigInt(0) })]]),
    );
    expect(rows[0]).toMatchObject({ disputedAt: 1_120_000, disputeExpiresAt: 1_120_000 + 30 * 86_400 });
  });

  it("has no dispute time on a record that was never disputed", () => {
    const rows = buildChainSlashRows(PROVIDER, parse(proposedLog(1)), new Map([[requestId(1), record()]]));
    expect(rows[0]).toMatchObject({ disputedAt: null, disputeExpiresAt: null, upheld: false, disputeTx: null });
  });
});
