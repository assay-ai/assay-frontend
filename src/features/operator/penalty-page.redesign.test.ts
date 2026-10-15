import { describe, expect, it } from "vitest";

import type { OperatorRole } from "@/interfaces/operator";

import { shortWhyNot } from "./case-flow";
import { breachVerdict } from "./operator-measurement";
import { moneyHeading, stakeReduction } from "./penalty-money";

const USD = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x1", decimals: 6 });

describe("the penalty page's money card", () => {
  it("is 'If upheld' until money moves, then 'Moved'", () => {
    expect(moneyHeading("disputed", "$28.47")).toMatchObject({ title: "If upheld", split: true });
    expect(moneyHeading("window-open", "$28.47").meta).toBe("Reserved in the provider's stake. Nothing has moved yet.");
    expect(moneyHeading("executed", "$3.75")).toMatchObject({ title: "Moved", split: true });
  });

  it("draws no split once nothing will be taken", () => {
    expect(moneyHeading("cancelled", "$7.20")).toMatchObject({ title: "Nothing taken", split: false });
    expect(moneyHeading("compensated", "$4.10")).toMatchObject({ title: "Paid back", split: false });
    expect(moneyHeading("cancel-requested", "$9.10").meta).toMatch(/the reserved \$9\.10 goes back to the provider once the arbiter signs/);
  });

  it("takes agents plus platform from the stake, never the provider's own share", () => {
    expect(stakeReduction(USD("28470000"), 6000)).toEqual(USD("25623000"));
    expect(stakeReduction(USD("28470000"), null)).toBeNull();
    // As drawn: $2.25 + $1.13 of $3.75, the same figures the money card shows.
    expect(stakeReduction(USD("3750000"), 6000, true)).toEqual(USD("3380000"));
  });
});

describe("the measurement's verdict", () => {
  it("leads with the breach in one line", () => {
    expect(
      breachVerdict([
        { key: "observed_rate", value: "12.62%" },
        { key: "effective_threshold", value: "6.81%" },
      ]),
    ).toBe("Breach: 12.62% failed vs 6.81% allowed");
  });

  it("says nothing without both figures", () => {
    expect(breachVerdict([{ key: "observed_rate", value: "12.62%" }])).toBeNull();
  });
});

describe("a refused action in one line", () => {
  const support = { roles: ["SRE", "SUP"] as OperatorRole[], authorityLimit: USD("0") };
  const adjudicator = { roles: ["ADJ"] as OperatorRole[], authorityLimit: USD("100000000") };

  it("names the $0 limit and who to ask", () => {
    expect(shortWhyNot(support, "suspend", USD("28470000"), ["Jordan Blake"])).toBe("Your limit is $0 · Ask Jordan Blake");
  });

  it("names a limit below the penalty", () => {
    expect(shortWhyNot(adjudicator, "suspend", USD("412000000"), null)).toBe("Above your $100.00 limit");
  });

  it("names the role a ruling needs", () => {
    expect(shortWhyNot(support, "rule", null, null)).toMatch(/^Needs /);
  });

  it("is nothing when allowed", () => {
    expect(shortWhyNot(adjudicator, "suspend", USD("28470000"), [])).toBeNull();
  });
});

describe("a dispute nobody ruled on", () => {
  it("reads as expired, not cancelled, on the page and in the list", async () => {
    const { demoResponse } = await import("@/libs/demo/demo-api");
    const { caseFacts, caseNextStep, caseAuthority, caseTimelineSteps } = await import("./case-flow");
    const { rowFromBrief } = await import("./penalty-list");
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
    try {
      const brief = demoResponse("GET", "/operator/cases/93d0e7b5-4c18-4a2f-8e61-7b5c0a9d2e13") as import("@/interfaces/operator").OperatorCaseBrief;
      const facts = caseFacts(brief);
      expect(facts).toMatchObject({ stage: "cancelled", expired: true });
      const lead = { roles: ["ADJL"] as OperatorRole[], authorityLimit: null };
      expect(caseNextStep(facts, caseAuthority(brief, lead, facts), (x) => x).title).toBe("Penalty expired");
      const steps = caseTimelineSteps(brief, facts);
      expect(steps.find((s) => s.id === "ruling")).toMatchObject({ label: "Not ruled in 30 days", state: "skipped" });
      expect(steps.at(-1)?.label).toBe("Expired");
      expect(rowFromBrief(brief, "Quanta Signals").status).toBe("EXPIRED");
    } finally {
      delete process.env.NEXT_PUBLIC_DEMO_CHAINS;
    }
  });
});

describe("round 4: the penalty page tells one story", () => {
  const brief = async (id: string) => {
    const { demoResponse } = await import("@/libs/demo/demo-api");
    process.env.NEXT_PUBLIC_DEMO_CHAINS = "robinhood";
    try {
      return demoResponse("GET", `/operator/cases/${id}`) as import("@/interfaces/operator").OperatorCaseBrief;
    } finally {
      delete process.env.NEXT_PUBLIC_DEMO_CHAINS;
    }
  };

  it("ends the window at the cancel when a penalty is cancelled inside it", async () => {
    const { caseFacts, caseTimelineSteps } = await import("./case-flow");
    const verdant = await brief("6f2a8c41-0b93-4d7e-a5c2-1e9b7d3f0a64");
    const steps = caseTimelineSteps(verdant, caseFacts(verdant));
    const window = steps.find((s) => s.id === "window")!;
    expect(window).toMatchObject({ date: verdant.case.proposal.resolvedAt, dateLabel: "ended early by the cancel" });
    expect(steps.at(-1)).toMatchObject({ label: "Cancelled", date: verdant.case.proposal.resolvedAt });
  });

  it("never marks the window done before it ends while a cancel waits for its signature", async () => {
    const { caseFacts, caseTimelineSteps } = await import("./case-flow");
    const cobalt = await brief("c7a0e5f3-9d21-4b68-a4c9-3e8f1b6d2a07");
    const now = Date.now();
    const facts = caseFacts(cobalt, now);
    expect(facts.stage).toBe("cancel-requested");
    expect(Date.parse(facts.cancel!.deadline!)).toBeGreaterThan(now);
    const steps = caseTimelineSteps(cobalt, facts, { now });
    const window = steps.find((s) => s.id === "window")!;
    expect(window.state).toBe("current");
    expect(window.date).toBeFalsy();
    expect(window.dateLabel).toBe("open until the signing deadline");
    // The signature step carries the one date and the countdown: the window's end.
    expect(steps.at(-1)).toMatchObject({ state: "current", date: facts.executableAt, dateLabel: "sign by", countdown: true });
    // Once that instant has passed, the window is done at it.
    const later = Date.parse(facts.executableAt!) + 60_000;
    expect(caseTimelineSteps(cobalt, caseFacts(cobalt, later), { now: later }).find((s) => s.id === "window")).toMatchObject({
      state: "done",
      date: facts.executableAt,
    });
  });

  it("dates the ruling step once ruled or lapsed", async () => {
    const { caseFacts, caseTimelineSteps } = await import("./case-flow");
    const quanta = await brief("93d0e7b5-4c18-4a2f-8e61-7b5c0a9d2e13");
    const facts = caseFacts(quanta);
    expect(caseTimelineSteps(quanta, facts).find((s) => s.id === "ruling")).toMatchObject({ date: facts.disputeExpiresAt, dateLabel: "lapsed" });
    const lattice = await brief("f1b8d6a2-3e57-4c09-9b14-6a2e0d8c7f35");
    expect(caseTimelineSteps(lattice, caseFacts(lattice)).find((s) => s.id === "ruling")?.date).toBeTruthy();
  });

  it("says why an upheld penalty is executable only later: the timelock from the proposal", async () => {
    const { caseFacts, caseTimelineSteps } = await import("./case-flow");
    const lattice = await brief("f1b8d6a2-3e57-4c09-9b14-6a2e0d8c7f35");
    const facts = caseFacts(lattice);
    expect(facts.stage).toBe("upheld");
    const steps = caseTimelineSteps(lattice, facts, { slashDelaySeconds: 259_200 });
    const upheldAt = Date.parse(steps.find((s) => s.id === "ruling")!.date!);
    // The contract's rule: executable from max(frozen executableAt, uphold), and the frozen one is proposal + 72 h.
    expect(Date.parse(facts.executableAt!)).toBeGreaterThan(upheldAt);
    expect(Date.parse(facts.executableAt!) - Date.parse(lattice.case.proposal.clocks.proposedAt)).toBe(72 * 3_600_000);
    expect(steps.at(-1)).toMatchObject({
      dateLabel: "executable from",
      description: "The 72 h on-chain timelock from the proposal still runs; an uphold never shortens it.",
    });
    const later = Date.parse(facts.executableAt!) + 60_000;
    expect(caseTimelineSteps(lattice, caseFacts(lattice, later), { now: later }).at(-1)?.description).toBeUndefined();
  });

  it("varies the measurement per penalty, and each one is a breach", async () => {
    const { breachVerdict } = await import("./operator-measurement");
    const northwind = await brief("8b3f2e9a-1c74-4d05-b6e2-7f0a9c3d5e18");
    const meridian = await brief("0a6d3b9e-7c42-4e1f-8d05-9b3a6c1e4f78");
    expect(breachVerdict(northwind.case.arithmetic)).not.toBe(breachVerdict(meridian.case.arithmetic));
    for (const b of [northwind, meridian]) {
      expect(breachVerdict(b.case.arithmetic)).toMatch(/^Breach/);
      const failed = Number(/^(\d+) failed/.exec(b.case.arithmetic.find((r) => r.key === "observed_rate")!.expression!)![1]);
      expect(b.case.failuresByRule.reduce((sum, r) => sum + r.count, 0)).toBe(failed);
      expect(b.case.failuresByAgent.reduce((sum, r) => sum + r.count, 0)).toBe(failed);
    }
  });

  it("draws the If-upheld split to the cent of the total", async () => {
    const { displaySplit } = await import("./penalty-money");
    const split = displaySplit(USD("28470000"), 6000)!;
    expect(BigInt(split.agents.amount) + BigInt(split.platform.amount) + BigInt(split.neverTaken.amount)).toBe(BigInt(28470000));
  });
});

describe("round 4: a request already waiting on the penalty", () => {
  const ASKED_NOW = Date.parse("2026-10-16T09:00:00Z");
  const request = {
    action: "slash.compensated",
    requestedBy: "Riley Brooks",
    createdAt: "2026-10-16T03:39:00Z",
    expiresAt: "2026-10-17T03:39:00Z",
    mine: false,
    canApprove: true,
    approvers: ["Jordan Blake", "Iris Park"],
  };

  it("is the next step: approve it when I can", async () => {
    const { pendingRequestStep } = await import("./case-flow");
    expect(pendingRequestStep(request, (x) => x, ASKED_NOW)).toMatchObject({ kind: "action", title: "Approve the pay-back", action: "approve" });
  });

  it("says who it waits for when I cannot", async () => {
    const { pendingRequestStep } = await import("./case-flow");
    const step = pendingRequestStep({ ...request, canApprove: false }, (x) => x, ASKED_NOW);
    expect(step).toMatchObject({ kind: "waiting", title: "Pay-back waiting for approval", secondary: "open-request" });
    expect(step.description).toMatch(/Waiting for Jordan Blake or Iris Park to approve it/);
    expect(pendingRequestStep({ ...request, canApprove: false, mine: true }, (x) => x, ASKED_NOW).title).toBe("Your pay-back is waiting for approval");
  });

  it("says Expired, never 'Lapses <a past time>', once its deadline has gone", async () => {
    const { pendingRequestStep } = await import("./case-flow");
    const after = Date.parse(request.expiresAt) + 60_000;
    const step = pendingRequestStep({ ...request, canApprove: false }, (x) => x, after);
    expect(step).toMatchObject({ kind: "done", title: "Pay-back request expired", action: null, meta: `Expired ${request.expiresAt}.` });
    expect(step.description).not.toMatch(/Waiting for/);
  });

  it("counts as waiting only while live, the same test Approvals uses", async () => {
    const { isLiveApproval } = await import("./inbox");
    expect(isLiveApproval({ status: "PENDING", expiresAt: request.expiresAt }, ASKED_NOW)).toBe(true);
    expect(isLiveApproval({ status: "PENDING", expiresAt: request.expiresAt }, Date.parse(request.expiresAt))).toBe(false);
    expect(isLiveApproval({ status: "APPROVED", expiresAt: request.expiresAt }, ASKED_NOW)).toBe(false);
  });

  it("holds the same ⋯ action back with a reason", async () => {
    const { alreadyWaiting } = await import("./case-flow");
    expect(alreadyWaiting("slash.compensated", ["slash.compensated"])).toBe("A pay-back request is already waiting");
    expect(alreadyWaiting("slash.suspend", ["slash.compensated"])).toBeNull();
  });
});

describe("round 4: ruling from the penalty page", () => {
  it("links to the Arbiter with the sheet named", async () => {
    const { rulingFromLink, rulingHref } = await import("./ruling-link");
    expect(rulingHref("abc", "UPHOLD")).toBe("/operator/arbiter?case=abc&rule=uphold");
    expect(rulingFromLink("cancel")).toBe("CANCEL");
    expect(rulingFromLink("UPHOLD")).toBe("UPHOLD");
    expect(rulingFromLink("other")).toBeNull();
    expect(rulingFromLink(null)).toBeNull();
  });
});

describe("round 5: the Context tab reads time like the rest of the console", () => {
  it("counts every window the Context strip draws, the breached one included", async () => {
    const { priorWindowsLabel } = await import("@/features/provider-slash-case/context");
    expect(priorWindowsLabel(3)).toBe("Last 3 closed windows");
    expect(priorWindowsLabel(1)).toBe("Last 1 closed window");
    expect(priorWindowsLabel(6, true)).toBe("last 6 closed windows");
  });

  it("is local with its zone for operators, UTC for the provider page", async () => {
    const { contextStamp } = await import("@/features/provider-slash-case/context");
    const { zoneLabel } = await import("@/libs/local-time");
    const iso = "2026-09-20T03:06:00Z";
    expect(contextStamp("provider")(iso)).toBe("2026-09-20 03:06 UTC");
    const local = contextStamp("operator")(iso);
    expect(local).not.toMatch(/2026-09-20/);
    expect(local.endsWith(zoneLabel(iso))).toBe(true);
  });
});
