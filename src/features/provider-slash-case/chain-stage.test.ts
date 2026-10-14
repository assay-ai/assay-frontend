import { describe, expect, it } from "vitest";

import { caseChainStageOf, executionFloorOf, mayAcknowledge, respondByApplies } from "./chain-stage";
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
