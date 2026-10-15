import { describe, expect, it } from "vitest";

import type {
  ArbiterDispute,
  OperatorApproval,
  OperatorCaseBrief,
  OperatorDirectoryEntry,
  OperatorRole,
  OverrideLogEntry,
  PlatformHealth,
} from "@/interfaces/operator";

import { activitySentence, activityText, isOfKind, targetTypeOf } from "./activity";
import { approvalChanges, approvalNeeds, approvalTargetId } from "./approvals";
import { disputeAmount, durationText } from "./arbiter";
import { evmAddressOf, noTargetText, pickedTarget, searchBlockTargets, walletLabel } from "./block-targets";
import { cancelDeadlineSentence, caseAuthority, caseFacts, caseNextStep, caseTimelineSteps } from "./case-flow";
import { deriveSubject, limitInputFromChoice } from "./directory";
import { allWaitingLabel, checkedAgo, disputeUrgency, eligibleApprovers, groupApprovals, healthIssues, needsYouBadgeText, needsYouBreakdown, needsYouCount, sortDisputesByDaysLeft, waitingSummary } from "./inbox";
import { activeOperatorNav, operatorNavFor, operatorTitleFor } from "./nav";
import { penaltySplit } from "./penalty-money";
import { capabilitiesFor, presetOf, removalWarnings, roleTitle, rolesPhrase } from "./roles";
import { roleIntroSentence } from "./role-intro";
import { accessRequestText, readSignInMethod, writeSignInMethod } from "./sign-in";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function approval(overrides: Partial<OperatorApproval> = {}): OperatorApproval {
  return {
    id: "a1",
    action: "account.unblock",
    code: "A-10",
    target: "account_block:blk-1",
    payload: { blockId: "blk-1", body: { reasonCode: "KEY_ROTATED", note: "n" } },
    status: "PENDING",
    requestedBy: "sam@",
    requestedById: "sam",
    approvedBy: null,
    rejectedBy: null,
    createdAt: iso(NOW - 3_600_000),
    decidedAt: null,
    expiresAt: iso(NOW + 20 * 3_600_000),
    ...overrides,
  };
}

function operator(id: string, roles: OperatorRole[], status: OperatorDirectoryEntry["status"] = "ACTIVE"): OperatorDirectoryEntry {
  return {
    id,
    subject: `${id}@`,
    displayName: id.charAt(0).toUpperCase() + id.slice(1),
    walletAddress: null,
    roles,
    authorityLimit: null,
    status,
    email: "",
    lastSeenAt: null,
    createdAt: iso(NOW),
  };
}

describe("the Needs-you groups", () => {
  const lead = { id: "jordan", roles: ["ADJL"] as OperatorRole[] };
  it("splits needs-you, yours and others, and drops expired and decided ones", () => {
    const rows = [
      approval({ id: "needs", expiresAt: iso(NOW + 2 * 3_600_000) }),
      approval({ id: "needs-later" }),
      approval({ id: "mine", requestedById: "jordan" }),
      approval({ id: "other", code: "A-12", action: "operator.add" }),
      approval({ id: "expired", expiresAt: iso(NOW - 1) }),
      approval({ id: "done", status: "APPROVED" }),
    ];
    const groups = groupApprovals(rows, lead, NOW);
    expect(groups.needsYou.map((r) => r.id)).toEqual(["needs", "needs-later"]);
    expect(groups.yours.map((r) => r.id)).toEqual(["mine"]);
    expect(groups.others.map((r) => r.id)).toEqual(["other"]);
  });

  it("counts disputes into Needs you only for whoever can rule (the badge uses the same rule)", () => {
    expect(needsYouCount(1, 3, true)).toBe(4);
    expect(needsYouCount(1, 3, false)).toBe(1);
  });

  it("names every open request 'All waiting', apart from the Needs you count", () => {
    expect(allWaitingLabel(5)).toBe("All waiting · 5");
    expect(allWaitingLabel(0)).toBe("All waiting");
    // Home: every waiting request in one line, split like the Approvals tabs.
    expect(waitingSummary({ needsYou: 2, yours: 1, others: 2 })).toBe("5 requests waiting: 2 for you, 1 from you, 2 for others");
    expect(waitingSummary({ needsYou: 1, yours: 0, others: 3 })).toBe("4 requests waiting: 1 for you, 3 for others");
    expect(waitingSummary({ needsYou: 0, yours: 0, others: 2 })).toBe("2 requests waiting, both for others");
    expect(waitingSummary({ needsYou: 0, yours: 0, others: 4 })).toBe("4 requests waiting, all for others");
    expect(waitingSummary({ needsYou: 0, yours: 1, others: 0 })).toBe("1 request waiting, from you");
    expect(waitingSummary({ needsYou: 0, yours: 0, others: 0 })).toBeNull();
    // The heading's number, explained when it mixes approvals and disputes.
    expect(needsYouBreakdown(2, 2, true)).toBe("2 to approve · 2 to rule");
    expect(needsYouBreakdown(2, 0, true)).toBeNull();
    expect(needsYouBreakdown(0, 3, true)).toBeNull();
    expect(needsYouBreakdown(2, 2, false)).toBeNull();
    expect(needsYouBadgeText(1)).toBe("1 needs you");
    expect(needsYouBadgeText(4)).toBe("4 need you");
  });

  it("names who could approve, never the requester", () => {
    const team = [operator("jordan", ["ADJL"]), operator("riley", ["ADJL", "TRE"]), operator("sam", ["SRE"]), operator("old", ["ADJL"], "REMOVED")];
    expect(eligibleApprovers("A-10", team, "jordan")).toEqual(["Riley"]);
    expect(eligibleApprovers("S-5", team, "sam")).toEqual(["Jordan", "Riley"]);
    expect(eligibleApprovers("Z-1", team, null)).toEqual([]);
  });

  it("says who must approve and what changes", () => {
    expect(approvalNeeds("A-10")).toBe("a second Lead adjudicator");
    expect(approvalNeeds("A-12")).toBe("a second Admin");
    expect(approvalNeeds("S-1")).toBe("a second Adjudicator or Lead adjudicator");
    expect(approvalChanges(approval())).toEqual([{ label: "Account", before: "Blocked", after: "Can use Assay again" }]);
    expect(approvalChanges(approval({ action: "slash.suspend", code: "S-1" }))).toEqual([{ label: "Penalty", before: "Stands", after: "Cancelled" }]);
    expect(approvalTargetId(approval())).toBe("blk-1");
  });
});

describe("dispute urgency", () => {
  it("counts the day, the days left, and goes red from day 20", () => {
    const fresh = disputeUrgency({ disputedAt: iso(NOW - 4 * DAY), expiresAt: iso(NOW + 26 * DAY) }, NOW);
    expect(fresh).toMatchObject({ day: 4, daysLeft: 26, urgent: false, label: "26 days left" });
    const late = disputeUrgency({ disputedAt: iso(NOW - 23 * DAY), expiresAt: iso(NOW + 7 * DAY) }, NOW);
    expect(late).toMatchObject({ day: 23, daysLeft: 7, urgent: true });
    expect(disputeUrgency({ disputedAt: iso(NOW - 30 * DAY), expiresAt: iso(NOW - 1) }, NOW)).toMatchObject({ expired: true, label: "Expired" });
    expect(disputeUrgency({ disputedAt: null, expiresAt: null }, NOW).label).toBe("Expiry unknown");
  });

  it("sorts by days left, unknown last", () => {
    const rows = [
      { requestId: "0xb", disputedAt: iso(NOW - DAY), expiresAt: iso(NOW + 29 * DAY) },
      { requestId: "0xc", disputedAt: null, expiresAt: null },
      { requestId: "0xa", disputedAt: iso(NOW - 25 * DAY), expiresAt: iso(NOW + 5 * DAY) },
    ];
    expect(sortDisputesByDaysLeft(rows).map((r) => r.requestId)).toEqual(["0xa", "0xb", "0xc"]);
  });
});

describe("the health strip", () => {
  const base: PlatformHealth = {
    intentsPerMinute: 1,
    intentsPerMinuteDeltaVsHour: null,
    verificationBacklog: 0,
    verificationBacklogP95AgeSeconds: null,
    falsePositiveRate: 0.01,
    falsePositiveGate: 0.02,
    policiesInShadow: 0,
    policiesTotal: 0,
    stakeLocked: { amount: "0", asset: "x", decimals: 6 },
    providersWithStake: 0,
    openDisputes: 0,
    oldestOpenDisputeAgeSeconds: null,
  };
  it("is all normal below the gate", () => {
    expect(healthIssues(base)).toEqual([]);
  });
  it("names what is red", () => {
    const issues = healthIssues({
      ...base,
      falsePositiveRate: 0.67,
      chainState: [
        { chainId: "eip155:1", paused: true, arbiter: null, slashDelaySeconds: null, blockedCount: 0, indexedBlock: null, headBlock: null, lagSeconds: 300, stale: true, reconciledAt: null },
      ],
    });
    expect(issues.map((i) => i.text)).toEqual(["False-positive rate 67%, gate 2%", "Contracts paused", "Chain indexer 5 min behind"]);
  });
  it("says when it was checked", () => {
    expect(checkedAgo(NOW - 3_000, NOW)).toBe("checked just now");
    expect(checkedAgo(NOW - 31_000, NOW)).toBe("checked 30 s ago");
    expect(checkedAgo(NOW - 125_000, NOW)).toBe("checked 2 min ago");
  });
});

describe("roles in plain words", () => {
  it("names presets and mixes", () => {
    expect(roleTitle(["ADJL"])).toBe("Lead adjudicator");
    expect(roleTitle(["SRE", "SUP"])).toBe("Support / on-call");
    expect(roleTitle(["ADJL", "OPS_ADMIN"])).toBe("Lead adjudicator · Admin");
    expect(presetOf(["TRE"])?.id).toBe("treasury");
    expect(rolesPhrase(["ADJ", "ADJL"])).toBe("Adjudicator or Lead adjudicator");
  });

  it("says what a role can do, from the same tables the screens gate on", () => {
    const lead = capabilitiesFor(["ADJL"]);
    expect(lead.rule && lead.block).toBe(true);
    expect(lead.approves).toContain("lifting account blocks");
    const support = capabilitiesFor(["SUP"]);
    expect(support).toMatchObject({ rule: false, block: false, approves: [], can: [] });
    expect(roleIntroSentence(["ADJL"], 2)).toMatch(/^You are Lead adjudicator: you can approve .*lifting account blocks.*; 2 waiting\.$/);
    expect(roleIntroSentence(["SUP"], 0)).toBe("You are Support. Nothing in the approvals inbox is yours to approve.");
  });

  it("warns when a removal leaves a two-person action without approvers", () => {
    const team = [operator("jordan", ["ADJL"]), operator("riley", ["ADJL"]), operator("dan", ["OPS_ADMIN"])];
    expect(removalWarnings(team, "jordan")).toEqual([
      "Only one other Adjudicator or Lead adjudicator would be left: their own requests for suspensions of upheld penalties and bulk decisions could not be approved.",
      "Only one other Lead adjudicator or Treasury would be left: their own requests for provider compensations could not be approved.",
      "Only one other Lead adjudicator would be left: their own requests for lifting account blocks and on-chain blocks could not be approved.",
    ]);
    expect(removalWarnings(team, "dan")[0]).toBe("Nobody else is Admin: new operators, raised roles and limits and admin removals could no longer be approved.");
    expect(removalWarnings([...team, operator("iris", ["ADJL", "OPS_ADMIN"])], "jordan")).toEqual([]);
  });
});

describe("the operator nav", () => {
  it("hides Arbiter from a role that cannot rule or block on chain", () => {
    expect(operatorNavFor(["SUP"]).map((i) => i.id)).toEqual(["home", "penalties", "blocks", "team", "activity"]);
    expect(operatorNavFor(["ADJL"]).map((i) => i.id)).toContain("arbiter");
  });
  it("finds the active item and title", () => {
    expect(activeOperatorNav("/operator")).toBe("home");
    expect(activeOperatorNav("/operator/approvals")).toBe("home");
    expect(activeOperatorNav("/operator/cases/view")).toBe("penalties");
    expect(activeOperatorNav("/operator/override-log")).toBe("activity");
    expect(operatorTitleFor("/operator/cases/view")).toBe("Penalty");
    expect(operatorTitleFor("/operator/approvals")).toBe("Approvals");
  });
});

// ── The case page ───────────────────────────────────────────────────────────

const USD = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0xabc", decimals: 6 });

function brief(overrides: {
  status?: string;
  chainStatus?: OperatorCaseBrief["chainStatus"];
  executableAt?: string | null;
  disputedAt?: string | null;
  parts?: number;
  /** False for a Solana case; absent (or true) is an EVM case, ruled on chain only. */
  disputeOnChain?: boolean;
}): OperatorCaseBrief {
  const proposedAt = iso(NOW - 2 * DAY);
  return {
    case: {
      proposal: {
        id: "p1",
        status: overrides.status ?? "PROPOSED",
        providerId: "prov",
        bindingId: "b",
        bindingLabel: "b",
        toolId: "t",
        toolName: "t",
        windowId: null,
        windowLabel: null,
        penaltyAmount: USD("28470000"),
        appliedAmount: null,
        clocks: {
          proposedAt,
          notifiedAt: proposedAt,
          acknowledgedAt: null,
          respondByAt: null,
          platformDecisionDueAt: null,
          earliestExecutionAt: overrides.executableAt ?? iso(NOW + DAY),
          chainDisputedAt: overrides.disputedAt ?? null,
          secondsRemaining: null,
          runningClock: "NONE",
          ...(overrides.disputeOnChain === undefined ? {} : { disputeOnChain: overrides.disputeOnChain }),
        },
        disputeId: null,
        outcome: null,
        resolutionKind: null,
        resolvedAt: null,
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
    chainStatus: overrides.chainStatus ?? "PENDING",
    chainExecutableAt: overrides.executableAt === undefined ? iso(NOW + DAY) : overrides.executableAt,
    chainDisputedParts: overrides.parts ?? 0,
  } as OperatorCaseBrief;
}

const fmt = (value: string) => value.slice(0, 16);

describe("where a penalty stands", () => {
  it("reads the on-chain stage", () => {
    expect(caseFacts(brief({}), NOW).stage).toBe("window-open");
    expect(caseFacts(brief({ executableAt: iso(NOW - 1) }), NOW).stage).toBe("executable");
    expect(caseFacts(brief({ chainStatus: "DISPUTED", disputedAt: iso(NOW - DAY), parts: 1 }), NOW)).toMatchObject({
      stage: "disputed",
      disputeExpiresAt: iso(NOW - DAY + 30 * DAY),
    });
    expect(caseFacts(brief({ status: "UPHELD", disputedAt: iso(NOW - 5 * DAY) }), NOW).stage).toBe("upheld");
    expect(caseFacts(brief({ status: "OVERTURNED", chainStatus: "CANCEL_REQUESTED" }), NOW).stage).toBe("cancel-requested");
    expect(caseFacts(brief({ status: "EXECUTED", chainStatus: "EXECUTED" }), NOW).stage).toBe("executed");
    expect(caseFacts(brief({ status: "CANCELLED", chainStatus: "CANCELLED" }), NOW).stage).toBe("cancelled");
    expect(caseFacts(brief({ chainStatus: "NONE" }), NOW).stage).toBe("not-on-chain");
    expect(caseFacts(brief({ status: "UNDER_REVIEW" }), NOW).legacyStatus).toBe(true);
  });

  it("draws the timeline with the window as the current step", () => {
    const b = brief({});
    const steps = caseTimelineSteps(b, caseFacts(b, NOW), { slashDelaySeconds: 259_200, now: NOW });
    expect(steps.map((s) => [s.label, s.state])).toEqual([
      ["Proposed", "done"],
      ["72 h dispute window", "current"],
      ["Disputed → arbiter rules", "upcoming"],
      ["Executed or cancelled", "upcoming"],
    ]);
  });

  it("marks a ruling late from day 20", () => {
    const b = brief({ chainStatus: "DISPUTED", disputedAt: iso(NOW - 21 * DAY), parts: 1 });
    const ruling = caseTimelineSteps(b, caseFacts(b, NOW), { now: NOW }).find((s) => s.id === "ruling");
    // The same "Day N of 30 · X days left" as Home and Arbiter, not a second countdown.
    expect(ruling).toMatchObject({ state: "current", urgent: true, countdown: false });
    expect(ruling?.dateLabel).toBe("9 days left · rule by");
  });
});

describe("the next step for this operator", () => {
  const lead = { roles: ["ADJL"] as OperatorRole[], authorityLimit: null };
  const support = { roles: ["SUP"] as OperatorRole[], authorityLimit: null };
  const sre = { roles: ["SRE"] as OperatorRole[], authorityLimit: USD("0") };

  it("asks an arbiter to rule on a dispute, and tells others who it waits for", () => {
    const b = brief({ chainStatus: "DISPUTED", disputedAt: iso(NOW - DAY), parts: 1 });
    const facts = caseFacts(b, NOW);
    expect(caseNextStep(facts, caseAuthority(b, lead, facts), fmt)).toMatchObject({ kind: "action", action: "rule" });
    expect(caseNextStep(facts, caseAuthority(b, support, facts), fmt)).toMatchObject({
      kind: "waiting",
      title: "Waiting for the arbiter",
      description: expect.stringMatching(/^The ruling is due by /),
    });
  });

  it("offers Suspend quietly while the window is open, and hides it above the authority limit", () => {
    // A Solana case: an EVM one is never suspended (below).
    const b = brief({ disputeOnChain: false });
    const facts = caseFacts(b, NOW);
    expect(caseNextStep(facts, caseAuthority(b, lead, facts), fmt)).toMatchObject({ kind: "waiting", secondary: "suspend" });
    const sreAuthority = caseAuthority(b, sre, facts);
    expect(sreAuthority.suspend.allowed).toBe(false);
    expect(sreAuthority.suspend.reason).toMatch(/authority/);
    expect(caseNextStep(facts, sreAuthority, fmt).secondary).toBeNull();
  });

  it("makes a suspension of an upheld penalty two-person", () => {
    const b = brief({ status: "UPHELD", disputedAt: iso(NOW - 5 * DAY), disputeOnChain: false });
    expect(caseAuthority(b, lead, caseFacts(b, NOW)).suspend).toMatchObject({ allowed: true, twoPerson: true });
  });

  // Review N-2: the backend refuses an S-1 suspension of an EVM case; only the arbiter's cancel stops it.
  it("never offers Suspend on an EVM case", () => {
    const b = brief({});
    const facts = caseFacts(b, NOW);
    const authority = caseAuthority(b, lead, facts);
    expect(authority.suspend.allowed).toBe(false);
    expect(authority.suspend.reason).toMatch(/arbiter's cancel/);
    expect(caseNextStep(facts, authority, fmt).secondary).toBeNull();
  });

  it("asks for the cancel signature when one is waiting", () => {
    const b = brief({ status: "OVERTURNED", chainStatus: "CANCEL_REQUESTED" });
    const facts = caseFacts(b, NOW);
    expect(caseNextStep(facts, caseAuthority(b, lead, facts), fmt)).toMatchObject({ kind: "action", action: "cancel" });
    expect(caseNextStep(facts, caseAuthority(b, support, facts), fmt).kind).toBe("waiting");
  });

  it("closes executed and cancelled penalties", () => {
    const b = brief({ status: "EXECUTED", chainStatus: "EXECUTED" });
    const facts = caseFacts(b, NOW);
    expect(caseNextStep(facts, caseAuthority(b, lead, facts), fmt)).toMatchObject({ kind: "done", title: "Penalty executed" });
    const c = brief({ status: "REVERSED", chainStatus: "EXECUTED" });
    // Executed on chain, then paid back: its own closed stage, not "executed".
    const cf = caseFacts(c, NOW);
    expect(cf.stage).toBe("compensated");
    expect(caseNextStep(cf, caseAuthority(c, lead, cf), fmt)).toMatchObject({ kind: "done", title: "Provider compensated" });
    expect(caseTimelineSteps(c, cf, { now: NOW }).at(-1)).toMatchObject({ label: "Executed, then compensated", state: "done" });
  });

  it("says so when the cancel deadline has passed", () => {
    const b = brief({ status: "OVERTURNED", chainStatus: "CANCEL_REQUESTED", executableAt: iso(Date.now() - 60_000) });
    const facts = caseFacts(b, Date.now());
    expect(caseNextStep(facts, caseAuthority(b, lead, facts), fmt)).toMatchObject({
      kind: "action",
      action: "cancel",
      description: expect.stringMatching(/deadline has passed/),
    });
  });

  it("after suspending a disputed penalty, waits for the arbiter on the dispute's own clock (B1)", () => {
    // Disputed 23 days ago, frozen executable time long past: the record is still Disputed on chain.
    const b = brief({
      status: "OVERTURNED",
      chainStatus: "CANCEL_REQUESTED",
      disputedAt: iso(NOW - 23 * DAY),
      executableAt: iso(NOW - 21 * DAY),
      parts: 1,
    });
    const facts = caseFacts(b, NOW);
    expect(facts.cancel).toEqual({ deadline: iso(NOW + 7 * DAY), ifUnsigned: "expires" });
    const next = caseNextStep(facts, caseAuthority(b, lead, facts), fmt);
    expect(next).toMatchObject({ kind: "action", action: "cancel", title: "Get the cancel signed", until: iso(NOW + 7 * DAY) });
    expect(next.description).not.toMatch(/anyone can execute/);
    expect(next.description).not.toMatch(/deadline has passed/);
    const end = caseTimelineSteps(b, facts, { now: NOW }).at(-1);
    expect(end).toMatchObject({ date: iso(NOW + 7 * DAY), urgent: false, countdown: false });
    expect(end?.dateLabel).toBe("7 days left · sign by");
    expect(cancelDeadlineSentence(facts, fmt)).toMatch(/cannot be executed/);
  });

  it("keeps the executable-time deadline for a cancel on a pending record", () => {
    const b = brief({ status: "OVERTURNED", chainStatus: "CANCEL_REQUESTED", executableAt: iso(NOW + DAY) });
    const facts = caseFacts(b, NOW);
    expect(facts.cancel).toEqual({ deadline: iso(NOW + DAY), ifUnsigned: "executes" });
    expect(cancelDeadlineSentence(facts, fmt)).toMatch(/anyone can execute/);
  });

  it("splits the money by the chain's current terms", () => {
    // One split everywhere: 60% agents, 30% platform, 10% never taken (A6).
    expect(penaltySplit(USD("28470000"), 6000)).toEqual({ agents: USD("17082000"), platform: USD("8541000"), neverTaken: USD("2847000") });
    expect(penaltySplit(USD("1"), 6000)).toEqual({ agents: USD("0"), platform: USD("0"), neverTaken: USD("1") });
    expect(penaltySplit(USD("100"), 8000)).toBeNull();
    expect(penaltySplit(USD("x"), 6000)).toBeNull();
  });
});

describe("block targets", () => {
  const providers = [
    { providerId: "9c1d4f60-3a77-4c18-9b02-6e5a1f2d8b41", legalName: "Helios Data Labs" },
    { providerId: "3f8a2b71-5c04-4d9e-8a16-7b2c9e0d4a53", legalName: "Meridian Index" },
  ];
  it("infers a wallet from 0x and an organization from a name or id", () => {
    const wallet = searchBlockTargets("0x9f3c2b7e1d4a8c05b6e9f2a3d7c1b4e8a0d5f36c", providers);
    expect(wallet).toHaveLength(1);
    expect(pickedTarget(wallet[0]!.id)).toEqual({ kind: "WALLET", subject: "0x9f3c2b7e1d4a8c05b6e9f2a3d7c1b4e8a0d5f36c" });
    expect(searchBlockTargets("meri", providers).map((o) => o.label)).toEqual(["Meridian Index"]);
    const byId = searchBlockTargets("9C1D4F60-3A77-4C18-9B02-6E5A1F2D8B41", providers);
    expect(byId[0]).toMatchObject({ label: "Helios Data Labs" });
    expect(pickedTarget(byId[0]!.id)?.kind).toBe("ORGANIZATION");
    expect(searchBlockTargets("11111111-2222-4333-8444-555555555555", providers)[0]!.label).toBe("Organization 11111111…");
  });
  it("explains a miss", () => {
    expect(noTargetText("dan@acme.com")).toMatch(/email is not available yet/);
    expect(noTargetText("0x12")).toMatch(/40 hex/);
  });
  it("shortens wallets and finds the address for an on-chain block", () => {
    expect(walletLabel("eip155:46630:0x9f3c2b7e1d4a8c05b6e9f2a3d7c1b4e8a0d5f36c")).toMatch(/^Wallet 0x9f3c…f36c$/i);
    expect(evmAddressOf("eip155:1:0x9f3c2b7e1d4a8c05b6e9f2a3d7c1b4e8a0d5f36c")).toBe("0x9f3c2b7e1d4a8c05b6e9f2a3d7c1b4e8a0d5f36c");
    expect(evmAddressOf("solana:x:abc")).toBeNull();
  });
});

describe("activity sentences", () => {
  const entry = (overrides: Partial<OverrideLogEntry>): OverrideLogEntry => ({
    id: "l1",
    createdAt: iso(NOW),
    family: "ACCESS",
    code: "A-9",
    label: "Block account",
    action: "account.block",
    actorSubject: "jordan@",
    approverSubject: null,
    approvalMode: "SINGLE",
    targetType: "account_block",
    targetId: "blk-2",
    organizationId: null,
    reasonCode: "LEAKED_KEY",
    reason: "",
    before: {},
    after: {},
    ticketRef: null,
    breakGlass: false,
    ...overrides,
  });
  const names = { operator: (s: string | null | undefined) => (s === "jordan@" ? "Jordan" : s === "dan@" ? "Dan" : (s ?? "")), target: () => "Wallet 0x9f3C…F36c" };

  it("reads a row as a sentence", () => {
    expect(activityText(activitySentence(entry({}), names))).toBe("Jordan blocked Wallet 0x9f3C…F36c (Leaked key).");
    expect(
      activityText(activitySentence(entry({ code: "A-10", approverSubject: "dan@", reasonCode: "KEY_ROTATED" }), names)),
    ).toBe("Jordan lifted the block on Wallet 0x9f3C…F36c (Key rotated), approved by Dan.");
    const penalty = activitySentence(entry({ code: "S-1", targetType: "slash_proposal", targetId: "p1" }), { ...names, target: () => null });
    // Not yet read: a short id, never the vague "a penalty".
    expect(penalty.target).toBe("penalty p1");
    expect(penalty.href).toBe("/operator/cases/view?id=p1");
    const named = activitySentence(entry({ code: "S-1", targetType: "slash_proposal", targetId: "p1" }), {
      ...names,
      target: () => "Northwind Geo's $28.47 penalty",
    });
    expect(activityText(named)).toBe("Jordan suspended Northwind Geo's $28.47 penalty (Leaked key).");
  });

  it("filters by kind", () => {
    expect(targetTypeOf("blocks")).toBe("account_block");
    expect(targetTypeOf("arbiter")).toBeUndefined();
    expect(isOfKind(entry({ code: "S-13", targetType: "slash_proposal" }), "arbiter")).toBe(true);
    expect(isOfKind(entry({}), "penalties")).toBe(false);
  });
});

describe("arbiter display", () => {
  it("reads durations and amounts", () => {
    expect(durationText(259_200)).toBe("72 h");
    expect(durationText(30 * 86_400)).toBe("30 days");
    expect(durationText(null)).toBe("not reported");
    expect(disputeAmount("eip155:46630", "28470000")).toMatchObject({ amount: "28470000", decimals: 6 });
    expect(disputeAmount("eip155:999999", "1")).toBeNull();
  });
  it("leaves a dispute row type intact", () => {
    const row: Pick<ArbiterDispute, "disputedAt" | "expiresAt"> = { disputedAt: null, expiresAt: iso(NOW + DAY / 2) };
    expect(disputeUrgency(row, NOW).label).toBe("Expires today");
  });
});

describe("team forms", () => {
  it("derives the handle from the name", () => {
    expect(deriveSubject("Noor Hassan")).toBe("noor@");
    expect(deriveSubject("  Zo\u00eb \u00c5lund  ")).toBe("zoe@");
    expect(deriveSubject("\u0110ani Ross")).toBe("dani@");
    expect(deriveSubject("")).toBe("");
  });
  it("reads the limit choice", () => {
    expect(limitInputFromChoice("unlimited", null)).toEqual({ mode: "unbounded", amount: "" });
    expect(limitInputFromChoice("0", "0")).toEqual({ mode: "zero", amount: "" });
    expect(limitInputFromChoice("100", "100000000")).toEqual({ mode: "amount", amount: "100000000" });
  });
});

describe("sign-in", () => {
  it("remembers the last method", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readSignInMethod(storage)).toBe("privy");
    writeSignInMethod(storage, "wallet");
    expect(readSignInMethod(storage)).toBe("wallet");
    expect(readSignInMethod(null)).toBe("privy");
  });
  it("writes the access request", () => {
    expect(accessRequestText("0xAbC")).toBe("Please add 0xAbC as an Assay operator. (Sent from the operator console sign-in.)");
  });
});
