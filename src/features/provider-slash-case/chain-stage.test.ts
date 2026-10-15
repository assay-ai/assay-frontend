import { describe, expect, it } from "vitest";

import {
  caseChainStageOf,
  caseStageOf,
  disputeDeadlineOf,
  disputesOnChain,
  executionFloorOf,
  mayAcknowledge,
  mayDisputeOnChain,
  onChainDisputeHref,
  onChainDisputeSentence,
  respondByApplies,
} from "./chain-stage";
import { DISPUTED_CLOCKS, R13, UPHELD_CLOCKS, caseOf, clocksOf } from "./fixtures/r13-case";

describe("executionFloorOf", () => {
  it("takes the chain's executableAt when it is later than Assay's promise (R13: 09:37, not 08:36)", () => {
    expect(executionFloorOf(clocksOf())).toBe(R13.chainExecutableAt);
  });

  it("keeps Assay's promise when it is the later one", () => {
    expect(executionFloorOf(clocksOf({ earliestExecutionAt: "2026-10-16T00:00:00.000Z" }))).toBe(
      "2026-10-16T00:00:00.000Z",
    );
  });

  it("falls back to Assay's promise when the chain date is absent or unparseable", () => {
    expect(executionFloorOf(clocksOf({ chainExecutableAt: null }))).toBe(R13.earliestExecutionAt);
    expect(executionFloorOf(clocksOf({ chainExecutableAt: undefined }))).toBe(R13.earliestExecutionAt);
    expect(executionFloorOf(clocksOf({ chainExecutableAt: "not a date" }))).toBe(R13.earliestExecutionAt);
  });
});

describe("caseChainStageOf", () => {
  it("is open, at the chain's time, for a plain pending record", () => {
    expect(caseChainStageOf(clocksOf())).toEqual({
      kind: "open",
      executableAt: R13.chainExecutableAt,
      disputedParts: 0,
    });
  });

  it("is disputed, with the 30-day expiry from the chain's disputedAt", () => {
    expect(caseChainStageOf(clocksOf(DISPUTED_CLOCKS))).toEqual({
      kind: "disputed",
      disputedAt: R13.chainDisputedAt,
      expiresAt: "2026-11-14T08:58:08.000Z",
    });
  });

  it("is disputed without dates when the backend sends no disputedAt", () => {
    expect(caseChainStageOf(clocksOf({ ...DISPUTED_CLOCKS, chainDisputedAt: null }))).toEqual({
      kind: "disputed",
      disputedAt: null,
      expiresAt: null,
    });
  });

  it("N-4: is not upheld when the backend's per-record state says a record stands undisputed", () => {
    // The arbiter cancelled the disputed part; another part stands undisputed.
    expect(
      caseChainStageOf(
        clocksOf({ chainStatus: "PENDING", chainDisputedAt: R13.chainDisputedAt, chainDisputedParts: 0, chainState: "PENDING" }),
      ).kind,
    ).toBe("open");
  });

  it("is upheld when the record is Pending again with a disputedAt and no disputed part", () => {
    expect(caseChainStageOf(clocksOf(UPHELD_CLOCKS))).toEqual({
      kind: "upheld",
      disputedAt: R13.chainDisputedAt,
      executableAt: R13.chainExecutableAt,
    });
  });

  it("uses the executableAt the uphold moved the record to", () => {
    const later = "2026-10-15T10:05:00.000Z";
    expect(caseChainStageOf(clocksOf({ ...UPHELD_CLOCKS, chainExecutableAt: later }))).toMatchObject({
      kind: "upheld",
      executableAt: later,
    });
  });

  it("stays open, counting the disputed parts, when only some parts are disputed", () => {
    expect(
      caseChainStageOf(clocksOf({ chainStatus: "PENDING", chainDisputedAt: R13.chainDisputedAt, chainDisputedParts: 2 })),
    ).toMatchObject({ kind: "open", disputedParts: 2 });
  });

  it("is open on an older backend that mirrors nothing", () => {
    expect(
      caseChainStageOf(
        clocksOf({ chainStatus: undefined, chainDisputedAt: undefined, chainDisputedParts: undefined, chainExecutableAt: undefined }),
      ),
    ).toEqual({ kind: "open", executableAt: R13.earliestExecutionAt, disputedParts: 0 });
  });

  it("is open for a record that is closed, whatever its dispute history", () => {
    for (const chainStatus of ["EXECUTED", "CANCELLED", "CANCEL_REQUESTED", "NONE"] as const) {
      expect(caseChainStageOf(clocksOf({ chainStatus, chainDisputedAt: R13.chainDisputedAt })).kind).toBe("open");
    }
  });
});

describe("respondByApplies and mayAcknowledge", () => {
  it("both apply to a fresh case waiting on the provider", () => {
    const data = caseOf("PROPOSED");
    const stage = caseChainStageOf(data.proposal.clocks);
    expect(respondByApplies(data.proposal, stage)).toBe(true);
    expect(mayAcknowledge(data.proposal, stage)).toBe(true);
  });

  it("neither applies once the case is disputed on chain", () => {
    const data = caseOf("DISPUTED", DISPUTED_CLOCKS, { disputeId: "d1" });
    const stage = caseChainStageOf(data.proposal.clocks);
    expect(respondByApplies(data.proposal, stage)).toBe(false);
    expect(mayAcknowledge(data.proposal, stage)).toBe(false);
  });

  it("neither applies once the dispute was upheld, even if the case still reads PROPOSED", () => {
    const data = caseOf("PROPOSED", UPHELD_CLOCKS);
    const stage = caseChainStageOf(data.proposal.clocks);
    expect(respondByApplies(data.proposal, stage)).toBe(false);
    expect(mayAcknowledge(data.proposal, stage)).toBe(false);
  });

  it("respond-by stops applying once the case is disputed in the app", () => {
    const data = caseOf("DISPUTED", {}, { disputeId: "d1" });
    expect(respondByApplies(data.proposal, caseChainStageOf(data.proposal.clocks))).toBe(false);
  });
});

describe("the on-chain dispute, the only dispute on EVM", () => {
  const before = new Date(R13.chainExecutableAt).getTime() - 60_000;
  const after = new Date(R13.chainExecutableAt).getTime() + 60_000;

  it("is the dispute unless the backend says the case is Solana", () => {
    expect(disputesOnChain(clocksOf())).toBe(true);
    expect(disputesOnChain(clocksOf({ disputeOnChain: true }))).toBe(true);
    expect(disputesOnChain(clocksOf({ disputeOnChain: false }))).toBe(false);
  });

  it("has one deadline: disputeBy, else the record's executableAt", () => {
    expect(disputeDeadlineOf(clocksOf({ disputeBy: "2026-10-15T10:00:00.000Z" }))).toBe("2026-10-15T10:00:00.000Z");
    expect(disputeDeadlineOf(clocksOf())).toBe(R13.chainExecutableAt);
    expect(disputeDeadlineOf(clocksOf({ chainExecutableAt: null }))).toBeNull();
  });

  it("can be sent while the case is PROPOSED and its record Pending, before the door", () => {
    const data = caseOf("PROPOSED");
    const stage = caseStageOf(data.proposal);
    expect(mayDisputeOnChain(data.proposal, stage, before)).toBe(true);
    expect(mayDisputeOnChain(data.proposal, stage, after)).toBe(false);
  });

  it("cannot be sent twice, nor before the record is on chain, nor on Solana", () => {
    for (const data of [
      caseOf("DISPUTED", DISPUTED_CLOCKS, { disputeId: "d1" }),
      caseOf("PROPOSED", UPHELD_CLOCKS),
      caseOf("PROPOSED", { chainStatus: "NONE", chainExecutableAt: null }),
      caseOf("PROPOSED", { disputeOnChain: false }),
    ]) {
      expect(mayDisputeOnChain(data.proposal, caseStageOf(data.proposal), before)).toBe(false);
    }
  });

  it("N-4: follows the backend's per-record disputeBy, whatever the case status or a sibling's dispute", () => {
    const partly = caseOf("UPHELD", {
      chainStatus: "PENDING",
      chainDisputedAt: R13.chainDisputedAt,
      chainDisputedParts: 1,
      chainState: "DISPUTED",
      disputeBy: R13.chainExecutableAt,
    });
    expect(mayDisputeOnChain(partly.proposal, caseStageOf(partly.proposal), before)).toBe(true);
    expect(mayDisputeOnChain(partly.proposal, caseStageOf(partly.proposal), after)).toBe(false);

    const none = caseOf("PROPOSED", { disputeBy: null, chainState: "UPHELD" });
    expect(mayDisputeOnChain(none.proposal, caseStageOf(none.proposal), before)).toBe(false);
  });

  it("links to the penalties on chain page with the case selected", () => {
    expect(onChainDisputeHref("p 1")).toBe("/provider/capital/penalties?case=p%201");
  });

  it("says plainly that disputing freezes the penalty, and by when", () => {
    expect(onChainDisputeSentence("2026-10-15T09:37:00.000Z", () => "2026-10-15 09:37")).toBe(
      "Disputing freezes the penalty on chain until the arbiter decides; you must dispute before 2026-10-15 09:37 UTC.",
    );
    expect(onChainDisputeSentence(null, (iso) => iso)).toMatch(/^Disputing freezes the penalty on chain until the arbiter decides;/);
  });
});
