import { describe, expect, it } from "vitest";

import type { AssayCaseIndex } from "@/features/chain-slashes/assay-match";
import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";
import { slashRecordStatusOf } from "@/libs/chains/evm/stake-slashes/status";

import { countByTab, lossOf, openPenaltyHold, openPenaltyPhrase, penaltyRowOf, penaltyTimeline, sortPenalties } from "./model";
import { failureSentence } from "./sentences";

const NOW = 1_800_000_000;
const ASSET = { decimals: 6, symbol: "USDG" };

function chainRow(code: number, patch: Partial<ChainSlashRow> = {}, everDisputed = false): ChainSlashRow {
  return {
    requestId: "0xABC",
    status: slashRecordStatusOf(code, everDisputed),
    cancelReason: null,
    penalty: BigInt(28_470_000),
    reserved: BigInt(28_470_000),
    applied: null,
    beneficiary: "0x0000000000000000000000000000000000000000",
    proposedAt: NOW - 3600,
    executableAt: NOW + 7200,
    disputedAt: null,
    disputeExpiresAt: null,
    upheld: false,
    upheldAt: null,
    upheldTx: null,
    disputeTx: null,
    proposeTx: null,
    closeTx: null,
    stateSource: "record",
    ...patch,
  } as ChainSlashRow;
}

const index: AssayCaseIndex = { status: "checked", known: new Map([["0xabc", { proposalId: "p1" }]]) };

describe("penaltyRowOf", () => {
  it("puts a pending record in Needs action with Dispute before its deadline", () => {
    const row = penaltyRowOf(chainRow(1), ASSET, index, NOW);
    expect(row.tab).toBe("needs-action");
    expect(row.canDispute).toBe(true);
    expect(row.proposalId).toBe("p1");
    expect(row.amount).toEqual({ amount: "28470000", asset: "USDG", decimals: 6 });
    // What the provider would actually lose: 90% of what the chain reserved.
    expect(lossOf(row)?.amount).toBe("25623000");
  });

  it("never offers Dispute after the deadline, on an executed or on an upheld record", () => {
    expect(penaltyRowOf(chainRow(1, { executableAt: NOW - 1 }), ASSET, index, NOW).canDispute).toBe(false);
    const executed = penaltyRowOf(chainRow(2, { applied: BigInt(1) }), ASSET, index, NOW);
    expect(executed.canDispute).toBe(false);
    expect(executed.tab).toBe("closed");
    expect(executed.closedAs).toBe("executed");
    const upheld = penaltyRowOf(chainRow(1, { upheld: true }, true), ASSET, index, NOW);
    expect(upheld.canDispute).toBe(false);
    expect(upheld.tab).toBe("needs-action");
  });

  it("gives a disputed record the arbiter's 7-day target", () => {
    const row = penaltyRowOf(chainRow(4, { disputedAt: NOW - 86_400, disputeExpiresAt: NOW + 29 * 86_400 }), ASSET, index, NOW);
    expect(row.tab).toBe("disputed");
    expect(row.arbiterTargetAt).toBe(new Date((NOW - 86_400 + 7 * 86_400) * 1000).toISOString());
  });

  it("reads an unresolved-dispute cancel as expired", () => {
    const row = penaltyRowOf(chainRow(3, { cancelReason: "Dispute unresolved (30 days)" }), ASSET, null, NOW);
    expect(row.closedAs).toBe("expired");
    expect(row.proposalId).toBeNull();
  });
});

describe("penaltyTimeline", () => {
  it("runs Proposed → Disputed → Arbiter rules → final", () => {
    const pending = penaltyTimeline(penaltyRowOf(chainRow(1), ASSET, index, NOW));
    expect(pending.map((s) => s.id)).toEqual(["proposed", "disputed", "ruling", "final"]);
    expect(pending[1]!.state).toBe("current");
    expect(pending[2]!.state).toBe("skipped");

    const disputed = penaltyTimeline(penaltyRowOf(chainRow(4, { disputedAt: NOW - 10 }), ASSET, index, NOW));
    expect(disputed[1]!.state).toBe("done");
    expect(disputed[2]!.state).toBe("current");
  });
});

describe("sorting and counts", () => {
  it("counts per tab and sorts open rows by deadline", () => {
    const rows = sortPenalties([
      penaltyRowOf(chainRow(1, { requestId: "0x2", executableAt: NOW + 900 }), ASSET, null, NOW),
      penaltyRowOf(chainRow(1, { requestId: "0x1", executableAt: NOW + 100 }), ASSET, null, NOW),
      penaltyRowOf(chainRow(2, { requestId: "0x3" }), ASSET, null, NOW),
    ]);
    expect(rows[0]!.id).toBe("0x1");
    expect(countByTab(rows)).toEqual({ "needs-action": 2, disputed: 0, closed: 1 });
  });
});

describe("failureSentence", () => {
  it("says failures in words", () => {
    expect(failureSentence("FRESHNESS_STALE", 21)).toBe("21 calls returned data older than allowed.");
    expect(failureSentence("VALUE_RANGE_OUT_OF_BOUNDS", 1)).toBe("1 call returned a value outside the plausible range.");
    expect(failureSentence("SOMETHING_NEW", 3)).not.toMatch(/SOMETHING_NEW/);
  });
});

describe("openPenaltyHold", () => {
  it("counts every open penalty, disputed included, and sums what they hold", () => {
    const rows = [
      penaltyRowOf(chainRow(1), ASSET, index, NOW),
      penaltyRowOf(chainRow(4, { disputedAt: NOW - 10 }), ASSET, index, NOW),
      penaltyRowOf(chainRow(2, { applied: BigInt(1) }), ASSET, index, NOW),
    ];
    const hold = openPenaltyHold(rows);
    expect(hold).toMatchObject({ count: 2, needsAction: 1, disputed: 1 });
    expect(hold.total?.amount).toBe((BigInt(rows[0]!.amount.amount) + BigInt(rows[1]!.amount.amount)).toString());
    expect(openPenaltyPhrase(hold)).toBe("2 open penalties (1 needs your answer, 1 disputed)");
  });

  it("says nothing extra for one kind", () => {
    expect(openPenaltyPhrase({ count: 1, needsAction: 1, disputed: 0, total: null })).toBe("1 open penalty");
    expect(openPenaltyHold([]).total).toBeNull();
  });
});

describe("lossOf", () => {
  it("counts from what the chain reserved, and is nothing for a cancelled record", () => {
    const capped = penaltyRowOf(chainRow(1, { reserved: BigInt(10_000_000) }), ASSET, index, NOW);
    expect(lossOf(capped)?.amount).toBe("9000000");
    expect(lossOf({ ...capped, closedAs: "cancelled" })).toBeNull();
  });
});
