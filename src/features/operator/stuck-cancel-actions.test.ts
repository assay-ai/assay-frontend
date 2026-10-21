import { describe, expect, it } from "vitest";

import type { ManualActionRefusal, OperatorCaseBrief, OperatorIdentity, OperatorRole } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";

import { approvalOutcome, approverRolesFor, approvalNeeds } from "./approvals";
import { caseAuthority, caseFacts, caseNextStep, manualActionCopy, type CaseActionId } from "./case-flow";
import { manualActionRefusedSentence, operatorErrorSentence } from "./operator-errors";

/**
 * B18: the three stuck-cancel actions are offered only when the brief's live
 * read says their guard holds, only to the roles that may take them, and each
 * says what happens (money, chain, approver, undo) before it is sent.
 */
const NOW = Date.parse("2026-10-18T12:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const fmt = (value: string) => value.slice(0, 16);

type Allowed = Partial<Record<"close" | "record" | "repropose", boolean>>;

function brief(input: {
  status: string;
  chainRecord: OperatorCaseBrief["chainRecord"];
  allowed?: Allowed;
  withManual?: boolean;
}): OperatorCaseBrief {
  const proposedAt = iso(NOW - 5 * DAY);
  const refused: ManualActionRefusal = "SWEEP_SETTLES";
  const option = (on: boolean | undefined) => ({ allowed: on === true, refusal: on ? null : refused });
  return {
    case: {
      proposal: {
        id: "34ccdb62-b12c-45b7-bec6-74d0412526c1",
        status: input.status,
        providerId: "prov",
        bindingId: "b",
        bindingLabel: "b",
        toolId: "t",
        toolName: "get_weather",
        windowId: "w",
        windowLabel: null,
        penaltyAmount: { amount: "28470000", asset: "eip155:46630/erc20:0xabc", decimals: 6 },
        appliedAmount: null,
        clocks: {
          proposedAt,
          notifiedAt: proposedAt,
          acknowledgedAt: null,
          earliestExecutionAt: iso(NOW - DAY),
          chainDisputedAt: null,
          secondsRemaining: null,
          runningClock: "NONE",
          disputeBy: null,
          chainExecutableAt: null,
          chainStatus: "NONE",
          chainDisputedParts: 0,
          chainState: "PENDING",
          chainRecords: 0,
          cancelledRecords: 0,
        },
        disputeId: null,
        resolutionKind: null,
        resolvedAt: iso(NOW - 4 * DAY),
        executedAt: null,
      },
      changeOverlay: null,
      failuresByAgent: [],
      evidenceVerdictCount: 0,
      suggestedClaim: null,
      inaction: {} as never,
      arithmetic: [],
      priorWindows: [],
      failuresByRule: [],
    },
    timeline: [],
    restoration: [],
    chainStatus: "CANCEL_REQUESTED",
    chainExecutableAt: iso(NOW - DAY),
    chainDisputedParts: 0,
    chainRecord: input.chainRecord,
    chainStanding: input.chainRecord === "STANDING" || input.chainRecord === "UNKNOWN",
    ...(input.withManual === false
      ? {}
      : {
          manualActions: {
            closeNothingStanding: option(input.allowed?.close),
            recordExecution: { ...option(input.allowed?.record), appliedMinor: input.allowed?.record ? "4000000" : null },
            repropose: option(input.allowed?.repropose),
          },
        }),
  } as OperatorCaseBrief;
}

const as = (roles: OperatorRole[]): Pick<OperatorIdentity, "roles" | "authorityLimit"> => ({ roles, authorityLimit: null });

function nextAction(b: OperatorCaseBrief, roles: OperatorRole[]): CaseActionId | null {
  const facts = caseFacts(b, NOW);
  const step = caseNextStep(facts, caseAuthority(b, as(roles), facts), fmt);
  return step.kind === "action" ? step.action : null;
}

const B18: readonly (CaseActionId | null)[] = ["close-cancel", "record-execution", "repropose"];

describe("B18: an action is offered only when its guard holds", () => {
  it("close: a closed case whose record reads cancelled, to ADJL or TRE only", () => {
    const b = brief({ status: "OVERTURNED", chainRecord: "GONE", allowed: { close: true } });
    expect(nextAction(b, ["ADJL"])).toBe("close-cancel");
    expect(nextAction(b, ["TRE"])).toBe("close-cancel");
    expect(nextAction(b, ["ADJ", "SRE", "SUP"])).toBeNull();
  });

  it("record: executed while the cancel waited, drawn as an alert", () => {
    const b = brief({ status: "CANCELLED", chainRecord: "EXECUTED", allowed: { record: true } });
    const facts = caseFacts(b, NOW);
    const step = caseNextStep(facts, caseAuthority(b, as(["TRE"]), facts), fmt);
    expect(step).toMatchObject({ kind: "action", action: "record-execution", alert: true });
    expect(step.description).toContain("The stake was taken");
    expect(step.description).not.toMatch(/nothing was taken/i);
    // Someone who may not record it is told who does, still as an alert.
    const other = caseNextStep(facts, caseAuthority(b, as(["SUP"]), facts), fmt);
    expect(other).toMatchObject({ kind: "waiting", action: null, alert: true });
  });

  it("re-propose: an upheld case whose earlier record reads cancelled", () => {
    const b = brief({ status: "UPHELD", chainRecord: "GONE", allowed: { repropose: true } });
    expect(nextAction(b, ["ADJL"])).toBe("repropose");
    expect(nextAction(b, ["ADJ"])).toBeNull();
  });

  it.each([
    ["STANDING", "CANCELLED"],
    ["EXECUTED", "CANCELLED"],
    ["GONE", "CANCELLED"],
    ["UNKNOWN", "CANCELLED"],
    ["GONE", "UPHELD"],
    ["UNKNOWN", "UPHELD"],
  ] as const)("read %s, case %s, every guard refused: no B18 action for anyone", (record, status) => {
    const b = brief({ status, chainRecord: record });
    for (const roles of [["ADJL"], ["TRE"], ["ADJL", "TRE"]] as OperatorRole[][]) {
      expect(B18).not.toContain(nextAction(b, roles));
    }
  });

  it("an older backend without manualActions offers none", () => {
    for (const record of ["STANDING", "EXECUTED", "GONE", "UNKNOWN"] as const) {
      const b = brief({ status: "CANCELLED", chainRecord: record, withManual: false });
      expect(B18).not.toContain(nextAction(b, ["ADJL", "TRE"]));
      const facts = caseFacts(b, NOW);
      expect(caseAuthority(b, as(["ADJL", "TRE"]), facts)).toMatchObject({
        closeCancel: false,
        recordExecution: false,
        repropose: false,
      });
    }
  });

  it("a guard that holds is never offered past the brief's chain reading (no close on a standing record)", () => {
    // Even if a stale field said allowed, a standing record keeps the cancel path, never a close.
    const b = brief({ status: "CANCELLED", chainRecord: "STANDING", allowed: { close: true } });
    expect(nextAction(b, ["ADJL"])).not.toBe("close-cancel");
  });
});

describe("B18: what happens, before it is sent", () => {
  it.each(["close", "record", "repropose"] as const)("%s says money, chain, approver and undo", (kind) => {
    const copy = manualActionCopy(kind, { penalty: "$28.47", applied: "$4.00" });
    expect(copy.lines.map((line) => line.kind)).toEqual(["money", "chain", "approver", "undo"]);
    expect(copy.confirm.length).toBeGreaterThan(20);
  });

  it("only close is one person; record and re-propose need a second approver", () => {
    expect(manualActionCopy("close", { penalty: "$1", applied: null })).toMatchObject({ code: "S-15", twoPerson: false, approvalAction: null });
    expect(manualActionCopy("record", { penalty: "$1", applied: null })).toMatchObject({ code: "S-16", twoPerson: true, approvalAction: "slash.record_execution" });
    expect(manualActionCopy("repropose", { penalty: "$1", applied: null })).toMatchObject({ code: "S-17", twoPerson: true, approvalAction: "slash.repropose" });
  });

  it("never promises an outcome the backend does not guarantee", () => {
    for (const kind of ["close", "record", "repropose"] as const) {
      const text = manualActionCopy(kind, { penalty: "$28.47", applied: "$4.00" }).lines.map((l) => l.text).join(" ");
      expect(text).toMatch(/read again/);
      expect(text).not.toMatch(/will be (refunded|paid back)/i);
    }
    const record = manualActionCopy("record", { penalty: "$28.47", applied: "$4.00" }).lines[0]!.text;
    expect(record).toContain("$4.00 was already taken");
    expect(record).toContain("moves no money now");
  });

  it("m4: record says a pay-back is separate only for a closed penalty; upheld closes as executed", () => {
    const closed = manualActionCopy("record", { penalty: "$28.47", applied: "$4.00" }, true).lines[0]!.text;
    const upheld = manualActionCopy("record", { penalty: "$28.47", applied: "$4.00" }, false).lines[0]!.text;
    expect(closed).toContain("paying it back is a separate request");
    expect(upheld).not.toMatch(/pay(ing)? it back/i);
    expect(upheld).toContain("closes as executed");
  });

  it("the approver roles match the backend register rows", () => {
    expect(approverRolesFor("S-16")).toEqual(["ADJL", "TRE"]);
    expect(approverRolesFor("S-17")).toEqual(["ADJ", "ADJL"]);
    expect(approvalNeeds("S-17", ["TRE"])).toBe("an Adjudicator or Lead adjudicator");
  });

  it("the approvals inbox says what approving does", () => {
    const record = approvalOutcome({ action: "slash.record_execution", target: "slash_proposal:x", payload: { proposalId: "x" } });
    expect(record.map((l) => l.kind)).toEqual(["money", "chain", "record", "runs", "record"]);
    expect(record[0]!.text).toContain("no money moves now");
    const repropose = approvalOutcome({ action: "slash.repropose", target: "slash_proposal:x", payload: { proposalId: "x" } });
    expect(repropose.map((l) => l.kind)).toEqual(["money", "chain", "record", "runs", "record"]);
  });
});

describe("B18: a refusal says why, and that nothing changed", () => {
  it.each(["CHANGED", "STANDING", "EXECUTED", "CHAIN_UNKNOWN", "DISPUTED_ON_CHAIN", "BENEFICIARY_NOT_AN_AGENT", "SPLIT_NOT_EXPRESSIBLE", "SOMETHING_NEW"])("%s", (reason) => {
    const error = new ApiError("SLASH_MANUAL_ACTION_REFUSED", "refused", 409, undefined, { reason });
    const sentence = operatorErrorSentence(error);
    expect(sentence).toContain("Nothing was changed.");
    expect(sentence).toBe(manualActionRefusedSentence(error));
  });
});
