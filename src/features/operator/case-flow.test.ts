import { describe, expect, it } from "vitest";

import type { OperatorCaseBrief, OperatorIdentity } from "@/interfaces/operator";

import { caseAuthority, caseFacts, caseNextStep, caseTimelineSteps, cancelDeadlineSentence } from "./case-flow";
import { cancelDeadlineNotice } from "./state";

/**
 * B11: the console never says "anyone can execute" unless something stands
 * on chain (`chainStanding`), and a penalty not on chain past its computed
 * dates says so instead of showing dates already gone.
 */
const NOW = Date.parse("2026-10-18T12:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const fmt = (value: string) => value.slice(0, 16);
const ADMIN: Pick<OperatorIdentity, "roles" | "authorityLimit"> = { roles: ["ADMIN", "ADJL"], authorityLimit: null } as never;

function brief(overrides: {
  status?: string;
  chainStatus?: OperatorCaseBrief["chainStatus"];
  chainRecord?: OperatorCaseBrief["chainRecord"];
  executableAt?: string | null;
  proposedAt?: string;
}): OperatorCaseBrief {
  const proposedAt = overrides.proposedAt ?? iso(NOW - 5 * DAY);
  return {
    case: {
      proposal: {
        id: "34ccdb62-b12c-45b7-bec6-74d0412526c1",
        status: overrides.status ?? "CANCELLED",
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
          respondByAt: null,
          platformDecisionDueAt: null,
          earliestExecutionAt: overrides.executableAt === undefined ? iso(NOW - DAY) : overrides.executableAt,
          chainDisputedAt: null,
          secondsRemaining: null,
          runningClock: "NONE",
          disputeOnChain: true,
          disputeBy: null,
          chainExecutableAt: null,
          chainStatus: "NONE",
          chainDisputedParts: 0,
          chainState: "PENDING",
          chainRecords: 0,
          cancelledRecords: 0,
        },
        disputeId: null,
        outcome: null,
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
    dispute: null,
    timeline: [],
    restoration: [],
    requiresSecondSignature: false,
    chainStatus: overrides.chainStatus ?? "CANCEL_REQUESTED",
    chainExecutableAt: overrides.executableAt === undefined ? iso(NOW - DAY) : overrides.executableAt,
    chainDisputedParts: 0,
    chainRecord: overrides.chainRecord ?? "STANDING",
    chainStanding: (overrides.chainRecord ?? "STANDING") === "STANDING" || overrides.chainRecord === "UNKNOWN",
  } as OperatorCaseBrief;
}

function allText(b: OperatorCaseBrief): string {
  const facts = caseFacts(b, NOW);
  const next = caseNextStep(facts, caseAuthority(b, ADMIN, facts), fmt);
  const steps = caseTimelineSteps(b, facts, { now: NOW });
  return [next.title, next.description, ...steps.flatMap((step) => [step.label, step.dateLabel ?? "", step.description ?? ""])].join(" | ");
}

describe("a cancel with nothing standing on chain (case 34ccdb62)", () => {
  it("reads as cancelled, with nothing to execute and no signature step", () => {
    const b = brief({ chainRecord: "GONE" });
    const facts = caseFacts(b, NOW);
    expect(facts.stage).toBe("cancelled");
    expect(facts.nothingOnChain).toBe(true);
    const authority = caseAuthority(b, ADMIN, facts);
    expect(authority.cancel).toBe(false);
    const next = caseNextStep(facts, authority, fmt);
    expect(next).toMatchObject({ kind: "done", action: null });
    expect(next.description).toContain("Nothing is on chain: nothing can be executed");
    expect(allText(b)).not.toMatch(/anyone can execute/i);
  });

  it("an overdue cancel that still stands keeps its urgent step", () => {
    const b = brief({ chainRecord: "STANDING" });
    const facts = caseFacts(b, NOW);
    expect(facts.stage).toBe("cancel-requested");
    const next = caseNextStep(facts, caseAuthority(b, ADMIN, facts), fmt);
    expect(next).toMatchObject({ kind: "action", action: "cancel", title: "Get the cancel signed now" });
    expect(next.description).toMatch(/anyone can execute/);
  });

  it("an older backend without the field reads as before (standing)", () => {
    expect(caseFacts(brief({}), NOW).stage).toBe("cancel-requested");
  });

  it("a cancel still requested on an open case, with nothing standing, has no signature step", () => {
    const b = brief({ status: "UPHELD", chainRecord: "GONE" });
    const facts = caseFacts(b, NOW);
    expect(facts.stage).toBe("cancel-requested");
    expect(caseAuthority(b, ADMIN, facts).cancel).toBe(false);
    expect(allText(b)).toContain("Nothing on chain to cancel");
    expect(allText(b)).not.toMatch(/anyone can execute|sign by/i);
  });

  it("an executable record with nothing standing never says anyone can execute it", () => {
    const b = brief({ status: "PROPOSED", chainStatus: "PENDING", chainRecord: "GONE" });
    expect(caseFacts(b, NOW).stage).toBe("executable");
    expect(allText(b)).not.toMatch(/anyone/i);
    expect(allText(b)).toContain("Nothing is on chain");
  });

  it("the cancel notice says the same", () => {
    expect(cancelDeadlineNotice("CANCEL_REQUESTED", iso(NOW - DAY), new Date(NOW), "eip155:46630", "GONE")).toEqual({
      overdue: false,
      text: "Nothing is on chain: nothing can be executed, and there is nothing to sign.",
    });
    expect(cancelDeadlineNotice("CANCEL_REQUESTED", iso(NOW - DAY), new Date(NOW), "eip155:46630", "STANDING")?.overdue).toBe(true);
  });
});

describe("C1: an executed record is never \"nothing was taken\"", () => {
  it("a closed case whose record was executed while the cancel waited reads as executed, as an alert", () => {
    const b = brief({ chainRecord: "EXECUTED" });
    const facts = caseFacts(b, NOW);
    expect(facts.stage).toBe("cancel-requested");
    expect(facts.executedWhileCancelWaited).toBe(true);
    expect(facts.nothingOnChain).toBe(false);
    const authority = caseAuthority(b, ADMIN, facts);
    expect(authority.cancel).toBe(false);
    const next = caseNextStep(facts, authority, fmt);
    expect(next).toMatchObject({ title: "Executed on chain while the cancel waited", alert: true, action: null });
    expect(next.description).toContain("The stake was taken");
    const text = allText(b);
    expect(text).not.toMatch(/Nothing was taken|Nothing is on chain|nothing can be executed/i);
    expect(cancelDeadlineNotice("CANCEL_REQUESTED", iso(NOW - DAY), new Date(NOW), "eip155:46630", "EXECUTED")?.text).toContain("stake was taken");
  });

  it("UNKNOWN keeps the cancel step and its action", () => {
    const b = brief({ chainRecord: "UNKNOWN" });
    const facts = caseFacts(b, NOW);
    expect(facts.stage).toBe("cancel-requested");
    expect(facts.nothingOnChain).toBe(false);
    expect(caseAuthority(b, ADMIN, facts).cancel).toBe(true);
  });

  // V1-15: legacy case 34ccdb62, past its deadline, whose live read found no record.
  it("UNKNOWN past the deadline never says anyone can execute it", () => {
    const b = brief({ chainRecord: "UNKNOWN" });
    const facts = caseFacts(b, NOW);
    expect(facts.chainUnconfirmed).toBe(true);
    const next = caseNextStep(facts, caseAuthority(b, ADMIN, facts), fmt);
    expect(next).toMatchObject({ kind: "action", action: "cancel", title: "Check the chain and get the cancel signed now" });
    expect(next.description).toContain("We could not confirm what stands there");
    expect(allText(b)).not.toMatch(/anyone can execute/i);
    expect(cancelDeadlineSentence(facts, fmt)).not.toMatch(/anyone can execute/i);
    const notice = cancelDeadlineNotice("CANCEL_REQUESTED", iso(NOW - DAY), new Date(NOW), "eip155:46630", "UNKNOWN");
    expect(notice?.overdue).toBe(true);
    expect(notice?.text).not.toMatch(/anyone can execute/i);
    // Still urgent (review m2): a failed read may hide a record that stands.
    expect(next.description).toContain("its deadline has passed");
    expect(notice?.text).toContain("its deadline has passed");
  });
});

describe("a cancel-requested side with nothing on chain (owner rule: the console closes nothing)", () => {
  it("says there is nothing to sign, with no action, for any role", () => {
    const b = brief({ chainRecord: "GONE" });
    const facts = caseFacts(b, NOW);
    expect(facts.closeOutstanding).toBe(true);
    for (const who of [ADMIN, { roles: ["SUP"], authorityLimit: null } as never]) {
      const authority = caseAuthority(b, who, facts);
      expect(authority.cancel).toBe(false);
      expect(caseNextStep(facts, authority, fmt)).toMatchObject({ kind: "done", action: null, title: "Nothing is on chain" });
    }
  });

  it("once closed (mirror CANCELLED), it reads as a plain cancelled penalty", () => {
    const b = brief({ chainStatus: "CANCELLED", chainRecord: "GONE" });
    const facts = caseFacts(b, NOW);
    expect(facts.closeOutstanding).toBe(false);
    expect(caseNextStep(facts, caseAuthority(b, ADMIN, facts), fmt).title).toBe("Penalty cancelled");
  });
});

describe("not on chain past its computed dates", () => {
  it("says how long, and shows no date already gone", () => {
    const b = brief({ status: "AWAITING_SECOND", chainStatus: "PROPOSING", executableAt: iso(NOW - 2 * DAY) });
    const facts = caseFacts(b, NOW);
    expect(facts.stage).toBe("not-on-chain");
    expect(facts.notOnChainForDays).toBe(5);
    const next = caseNextStep(facts, caseAuthority(b, ADMIN, facts), fmt);
    expect(next.title).toBe("Not on chain after 5 days");
    const steps = caseTimelineSteps(b, facts, { now: NOW });
    expect(steps.find((step) => step.id === "window")).toMatchObject({ date: null, dateLabel: "not on chain after 5 days" });
    expect(steps.find((step) => step.id === "end")).toMatchObject({ date: null, dateLabel: "once it is on chain" });
  });

  it("keeps a computed date still ahead", () => {
    const b = brief({ status: "PROPOSED", chainStatus: "PROPOSING", executableAt: iso(NOW + DAY) });
    const facts = caseFacts(b, NOW);
    expect(facts.notOnChainForDays).toBeNull();
    expect(caseNextStep(facts, caseAuthority(b, ADMIN, facts), fmt).title).toBe("Going on chain");
  });
});
