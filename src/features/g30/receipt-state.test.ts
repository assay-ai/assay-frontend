import { describe, expect, it } from "vitest";

import {
  COLLECTION_STATES,
  chargedCheck,
  chargedHeadline,
  receiptStory,
  receiptTimeline,
  refundableUntil,
  STATE_CARDS,
  canContestRejection,
  deriveReceiptState,
  notChargedStory,
  receiptFlow,
  relevanceReached,
  samplingExplainerCopy,
  toStageChecks,
} from "./receipt-state";
import type { Receipt } from "./wire";

const receipt = (sampling: Receipt["sampling"], listed = "1000") =>
  ({ sampling, listedPrice: { amount: listed, asset: "x", decimals: 6 } }) as Receipt;

describe("samplingExplainerCopy", () => {
  it("says the call was judged every time when the rate is 1 (no sampling paragraph)", () => {
    const copy = samplingExplainerCopy(receipt({ rate: 1, display: "every call" }), "$0.25");
    expect(copy.body).toContain("every call at $0.25");
    expect(copy.body).not.toMatch(/Instead we sample/);
    expect(copy.tail).toBe("");
  });

  it("keeps the design's sampling paragraph for a sampled rate", () => {
    const copy = samplingExplainerCopy(receipt({ rate: 0.008, display: "1 in 125" }), "$0.0010");
    expect(copy.body).toContain("At $0.0010 a call, judging every one would cost more");
    expect(copy.tail).toBeUndefined();
  });

  it("drops the '$0.05 and above are judged on every call' tail on a sampled call at that price", () => {
    // BUG-R2-B1-02: a $0.10 call sampled at 80% printed both sentences.
    const copy = samplingExplainerCopy(receipt({ rate: 0.8, display: "80%" }, "100000"), "$0.10");
    expect(copy.body).toMatch(/Instead we sample/);
    expect(copy.tail).toBe("");
  });

  // BUG-R16-B1-02: "does not apply to this tool" sat right above "runs on every call".
  it("says one thing when the tool declares no relevance judgement", () => {
    const copy = samplingExplainerCopy(
      {
        ...receipt({ rate: 1, display: "every call" }),
        stages: [{ stage: "SEMANTIC", status: "NOT_APPLICABLE" }],
      } as unknown as Receipt,
      "$0.2500",
    );
    expect(copy.body).toMatch(/does not declare a relevance judgement/);
    expect(copy.body).not.toMatch(/runs on every call|Instead we sample/);
    expect(copy.rate).toBe("");
    expect(copy.tail).toBe("");
  });
});

describe("deriveReceiptState — expired intents", () => {
  const base = {
    classification: "REQUEST_ERROR",
    verdict: null,
    chargedPrice: { amount: "0", asset: "x", decimals: 6 },
  };

  it("reports EXPIRED even when the row carries a REQUEST_ERROR classification", () => {
    expect(deriveReceiptState({ ...base, status: "EXPIRED" } as unknown as Receipt)).toBe("EXPIRED");
    expect(deriveReceiptState({ ...base, status: "VOIDED" } as unknown as Receipt)).toBe(
      "REQUEST_ERROR",
    );
  });

  it("explains expiry as not charged with the hold released", () => {
    expect(STATE_CARDS.EXPIRED.sentence).toMatch(/not charged/i);
    expect(STATE_CARDS.EXPIRED.sentence).toMatch(/released/i);
    expect(STATE_CARDS.EXPIRED.sentence).not.toMatch(/malformed/i);
  });
});

describe("canContestRejection — the 'This result was actually fine' block", () => {
  const stages = (...statuses: string[]) =>
    ({ stages: statuses.map((status) => ({ stage: "SCHEMA", status })) }) as unknown as Receipt;

  it("is offered when a check ran and failed", () => {
    expect(canContestRejection(stages("PASSED", "FAILED", "NOT_REACHED"))).toBe(true);
  });

  it("is not offered on a voided receipt where every check is not reached", () => {
    // BUG-R2-B1-02: VOIDED, verdict NOT_CHARGED, nothing ran — no check to call wrong.
    expect(canContestRejection(stages("NOT_REACHED", "NOT_REACHED", "NOT_REACHED"))).toBe(false);
  });

  it("is not offered when no check failed", () => {
    expect(canContestRejection(stages("PASSED", "SKIPPED"))).toBe(false);
    expect(canContestRejection(stages("MISAPPLIED", "UNAVAILABLE"))).toBe(false);
    expect(canContestRejection(stages())).toBe(false);
  });
});

describe("receiptFlow and relevanceReached", () => {
  const money = (amount: string) => ({ amount, asset: "x", decimals: 6 });
  const r = (charged: string, stages: { stage: string; status: string }[] = []) =>
    ({
      listedPrice: money("100000"),
      chargedPrice: money(charged),
      withheld: money(charged === "0" ? "100000" : "0"),
      stages,
    }) as unknown as Receipt;

  it("draws held → check failed → released for a refused call", () => {
    expect(receiptFlow(r("0"), "NOT_CHARGED").map((n) => [n.label, n.amount ?? null])).toEqual([
      ["Held", "$0.10"],
      ["Check failed", null],
      ["Released to you", "$0.10"],
    ]);
  });

  it("draws held → check passed → charged for a charged call that passed", () => {
    const passed = { ...r("100000", [{ stage: "SCHEMA", status: "PASSED" }]), verdict: { status: "PASS" } } as Receipt;
    expect(receiptFlow(passed, "CHARGED").map((n) => n.label)).toEqual(["Held", "Check passed", "Charged"]);
  });

  it("never draws 'Check passed' on a charged call with no check result", () => {
    expect(receiptFlow(r("100000"), "CHARGED").map((n) => n.label)).toEqual(["Held", "Served (not checked)", "Charged"]);
  });

  it("says the relevance stage was reached only when it ran or was sampled out", () => {
    expect(relevanceReached(r("0", [{ stage: "SEMANTIC", status: "NOT_REACHED" }]))).toBe(false);
    expect(relevanceReached(r("0", [{ stage: "SEMANTIC", status: "SKIPPED" }]))).toBe(true);
    expect(relevanceReached(r("0", []))).toBe(false);
  });
});

describe("notChargedStory — one story per not-charged class", () => {
  const money = (amount: string) => ({ amount, asset: "x", decimals: 6 });
  const stage = (name: string, status = "NOT_REACHED") => ({
    stage: name,
    status,
    label: "not reached",
    note: "checks stop at the first failure",
    detail: "checks stop at the first failure",
  });
  const make = (over: Partial<Receipt>): Receipt =>
    ({
      intentId: "i",
      toolId: "t",
      providerId: null,
      classification: null,
      status: "VOIDED",
      listedPrice: money("50000"),
      chargedPrice: money("0"),
      withheld: money("50000"),
      verdict: { status: null },
      stages: ["SCHEMA", "DETERMINISTIC_RULES", "CROSS_CHECK", "SEMANTIC"].map((s) => stage(s)),
      policy: {},
      sampling: {},
      createdAt: "2026-10-13T17:55:23Z",
      expiresAt: "2026-10-13T18:00:23Z",
      updatedAt: "2026-10-13T17:55:24Z",
      ...over,
    }) as Receipt;

  it("REFUNDED with a data result and no verdict is a wrong-format result, shown as a failed shape check", () => {
    const receipt = make({ status: "REFUNDED", classification: "DATA_RESULT" });
    const story = notChargedStory(receipt);
    expect(story.reason).toBe("WRONG_FORMAT");
    expect(story.headline).not.toMatch(/No result recorded/);
    const checks = toStageChecks(receipt);
    expect(checks[0]).toMatchObject({ status: "failed" });
    expect(checks.slice(1).every((c) => c.note === "not run: an earlier check failed" && !c.detail)).toBe(true);
    expect(receiptFlow(receipt, "NOT_CHARGED")[1]?.label).toBe("Wrong result format");
  });

  it("a provider error never says a check failed", () => {
    const receipt = make({ classification: "SYSTEM_ERROR" });
    const story = notChargedStory(receipt);
    expect(story.reason).toBe("PROVIDER_ERROR");
    expect(story.checksSummary).toMatch(/No checks ran/);
    expect(receiptFlow(receipt, "SYSTEM_ERROR")[1]?.label).toBe("Provider error");
    expect(toStageChecks(receipt).every((c) => c.status === "not-reached" && c.note === "not run: no result")).toBe(true);
  });

  it("separates rejected requests, no answer, expiry and failed checks", () => {
    expect(notChargedStory(make({ classification: "REQUEST_ERROR" })).reason).toBe("REQUEST_REJECTED");
    expect(notChargedStory(make({})).reason).toBe("NO_ANSWER");
    expect(notChargedStory(make({ status: "EXPIRED", classification: "DATA_RESULT" })).headline).toMatch(/did not finish in time/);
    expect(notChargedStory(make({ status: "REFUNDED", verdict: { status: "FAIL" } })).reason).toBe("FAILED_CHECKS");
  });

  it("a settled free call is charged, not 'not charged'", () => {
    expect(deriveReceiptState(make({ status: "SETTLED", listedPrice: money("0"), withheld: money("0") }))).toBe("CHARGED");
  });
});

const usd = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x1", decimals: 6 });

function settledReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    intentId: "int_1",
    toolId: "tool",
    providerId: "prv",
    classification: "DATA_RESULT",
    status: "SETTLED",
    listedPrice: usd("2500000"),
    chargedPrice: usd("2500000"),
    withheld: usd("0"),
    verdict: { status: "PASS" },
    stages: [],
    policy: {},
    sampling: {},
    createdAt: "2026-10-16T00:00:00.000Z",
    expiresAt: "2026-10-16T00:05:00.000Z",
    updatedAt: "2026-10-16T00:01:00.000Z",
    ...overrides,
  };
}

describe("deriveReceiptState — collection", () => {
  it("keeps an ordinary settled call CHARGED", () => {
    expect(deriveReceiptState(settledReceipt())).toBe("CHARGED");
    expect(deriveReceiptState(settledReceipt({ forfeited: false, debt: null }))).toBe("CHARGED");
  });

  it("says an open debt is not collected yet, though it is charged", () => {
    expect(deriveReceiptState(settledReceipt({ debt: "OUTSTANDING" }))).toBe("DEBT_OUTSTANDING");
  });

  // Forfeited and written-off calls have chargedPrice 0 AND withheld 0: they
  // are not the guarantee's NOT_CHARGED (which says the checks failed).
  it("does not read a forfeited or written-off call as failed checks", () => {
    const zero = { chargedPrice: usd("0"), withheld: usd("0") };
    expect(deriveReceiptState(settledReceipt({ ...zero, forfeited: true }))).toBe("FORFEITED");
    expect(deriveReceiptState(settledReceipt({ ...zero, debt: "WRITTEN_OFF" }))).toBe("DEBT_WRITTEN_OFF");
    expect(deriveReceiptState(settledReceipt({ ...zero, debt: "VOIDED" }))).toBe("DEBT_VOIDED");
  });

  it("has a card for every collection state", () => {
    for (const state of COLLECTION_STATES) {
      expect(STATE_CARDS[state as keyof typeof STATE_CARDS].sentence.length).toBeGreaterThan(0);
    }
    expect(STATE_CARDS.DEBT_OUTSTANDING.sentence).toMatch(/paid calls are paused/);
    expect(STATE_CARDS.DEBT_WRITTEN_OFF.sentence).toMatch(/provider was not paid/);
    expect(STATE_CARDS.DEBT_WRITTEN_OFF.sentence).toMatch(/Paid calls stay paused until you settle it/);
    expect(STATE_CARDS.DEBT_WRITTEN_OFF.sentence).toMatch(/You still owe it to resume paid calls/);
    expect(STATE_CARDS.DEBT_WRITTEN_OFF.sentence).not.toMatch(/not charged/);
    expect(STATE_CARDS.DEBT_VOIDED.sentence).toMatch(/You were not charged.*provider was not paid/);
    expect(COLLECTION_STATES.has("DEBT_VOIDED")).toBe(true);
  });
});

describe("receiptFlow — collection states", () => {
  it("draws an open or written-off debt as still owed, never released", () => {
    const debt = settledReceipt({ debt: "OUTSTANDING" });
    expect(receiptFlow(debt, "DEBT_OUTSTANDING").map((n) => [n.label, n.amount ?? null])).toEqual([
      ["Held", "$2.50"],
      ["Passed, payment not taken", null],
      ["Still owed by you", "$2.50"],
    ]);
    const off = settledReceipt({ debt: "WRITTEN_OFF", chargedPrice: usd("0") });
    expect(receiptFlow(off, "DEBT_WRITTEN_OFF").at(-1)?.label).toBe("Still owed by you");
  });

  it("draws a forfeited call as released in full, though withheld is zero", () => {
    const forfeited = settledReceipt({ forfeited: true, chargedPrice: usd("0") });
    expect(receiptFlow(forfeited, "FORFEITED").at(-1)).toMatchObject({ label: "Released to you", amount: "$2.50" });
  });
});

/* ------------------------------------------------- one story (P0-2) */

describe("receiptStory — headline, money strip, checks and timeline agree", () => {
  const FOUR = ["SCHEMA", "DETERMINISTIC_RULES", "CROSS_CHECK", "SEMANTIC"];
  const stagesOf = (...statuses: string[]) =>
    FOUR.map((stage, i) => ({
      stage,
      status: statuses[i] ?? statuses[statuses.length - 1],
      passed: (statuses[i] ?? statuses[statuses.length - 1]) === "PASSED",
      note: "checks stop at the first failure",
      detail: "checks stop at the first failure",
    })) as unknown as Receipt["stages"];
  const SETTLED_AT = "2026-10-16T00:00:02.000Z";
  const RELEASED_AT = "2026-10-16T00:00:03.000Z";
  const NOW = Date.parse("2026-10-16T00:30:00.000Z");

  type Row = {
    name: string;
    status: string;
    charged: string;
    verdict: string | null;
    stages: Receipt["stages"];
    settledAt: string | null;
    holdReleasedAt: string | null;
    headline: RegExp | null;
    step: string;
    closing: [string, string] | null;
  };

  const table: Row[] = [
    {
      // The seeded call e17d…0007: SETTLED, rail B, no verification record, so a null verdict,
      // every stage not reached, no settledAt and a released hold.
      name: "SETTLED + null verdict + every stage not reached + hold released",
      status: "SETTLED",
      charged: "20000",
      verdict: null,
      stages: stagesOf("NOT_REACHED"),
      settledAt: null,
      holdReleasedAt: RELEASED_AT,
      headline: /^Charged \$0\.02\. Served; no check result was recorded for this call\.$/,
      step: "Served (not checked)",
      closing: ["Charged", "$0.02"],
    },
    {
      name: "SETTLED + PASS verdict + every stage not reached",
      status: "SETTLED",
      charged: "20000",
      verdict: "PASS",
      stages: stagesOf("NOT_REACHED"),
      settledAt: SETTLED_AT,
      holdReleasedAt: null,
      headline: /Served; no check result was recorded/,
      step: "Served (not checked)",
      closing: ["Charged", "$0.02"],
    },
    {
      name: "SETTLED + null verdict + nothing dated",
      status: "SETTLED",
      charged: "20000",
      verdict: null,
      stages: stagesOf("NOT_REACHED"),
      settledAt: null,
      holdReleasedAt: null,
      headline: /Served; no check result was recorded/,
      step: "Served (not checked)",
      closing: null,
    },
    {
      name: "SETTLED + PASS + checks passed (relevance not sampled)",
      status: "SETTLED",
      charged: "20000",
      verdict: "PASS",
      stages: stagesOf("PASSED", "PASSED", "PASSED", "SKIPPED"),
      settledAt: SETTLED_AT,
      holdReleasedAt: null,
      headline: /^Charged \$0\.02\. (?!Served)/,
      step: "Check passed",
      closing: ["Charged", "$0.02"],
    },
    {
      name: "SETTLED + PASS + charged, closed by holdReleasedAt",
      status: "SETTLED",
      charged: "20000",
      verdict: "PASS",
      stages: stagesOf("PASSED"),
      settledAt: null,
      holdReleasedAt: RELEASED_AT,
      headline: /^Charged \$0\.02\./,
      step: "Check passed",
      closing: ["Charged", "$0.02"],
    },
    {
      name: "REFUNDED + FAIL",
      status: "REFUNDED",
      charged: "0",
      verdict: "FAIL",
      stages: stagesOf("PASSED", "FAILED", "NOT_REACHED"),
      settledAt: null,
      holdReleasedAt: RELEASED_AT,
      headline: null,
      step: "Check failed",
      closing: ["Hold released", "not charged"],
    },
    {
      name: "EXPIRED + no verdict",
      status: "EXPIRED",
      charged: "0",
      verdict: null,
      stages: stagesOf("NOT_REACHED"),
      settledAt: null,
      holdReleasedAt: RELEASED_AT,
      headline: null,
      step: "Did not finish in time",
      closing: ["Did not finish in time, hold released", "not charged"],
    },
  ];

  for (const row of table) {
    it(row.name, () => {
      const receipt = settledReceipt({
        status: row.status,
        listedPrice: usd("20000"),
        chargedPrice: usd(row.charged),
        withheld: usd(row.charged === "0" ? "20000" : "0"),
        verdict: { status: row.verdict } as Receipt["verdict"],
        stages: row.stages,
        settledAt: row.settledAt,
        holdReleasedAt: row.holdReleasedAt,
      });
      const story = receiptStory(receipt, undefined, { now: NOW });
      if (row.headline) expect(story.chargedHeadline).toMatch(row.headline);
      else expect(story.chargedHeadline).toBeNull();
      expect(story.flow[1]?.label).toBe(row.step);

      const closing = story.timeline.slice(2).find((r) => r.label !== "Result checked") ?? null;
      expect(closing ? [closing.label, closing.meta] : null).toEqual(row.closing);

      // The one contradiction this table exists for.
      if (row.charged !== "0") {
        expect(story.flow.map((n) => n.label)).toContain("Charged");
        expect(story.timeline.map((r) => r.meta)).not.toContain("not charged");
      }
      if (chargedCheck(receipt) !== "PASSED") {
        expect(story.flow.map((n) => n.label)).not.toContain("Check passed");
        expect(story.chargedHeadline ?? "").not.toMatch(/No result recorded/);
      }
    });
  }

  it("says 'Check passed' only for a pass verdict or a stage that passed", () => {
    expect(chargedCheck({ verdict: { status: "PASS" }, stages: stagesOf("PASSED") } as Receipt)).toBe("PASSED");
    expect(chargedCheck({ verdict: { status: "DEGRADED" }, stages: stagesOf("PASSED", "NOT_REACHED") } as Receipt)).toBe("PASSED");
    expect(chargedCheck({ verdict: { status: "DEGRADED" }, stages: stagesOf("FAILED", "NOT_REACHED") } as Receipt)).toBe("CHECKED");
    // The stages decide first: a tick in the checks panel never sits beside "no check result".
    expect(chargedCheck({ verdict: { status: null }, stages: stagesOf("PASSED") } as unknown as Receipt)).toBe("PASSED");
    expect(chargedCheck({ verdict: { status: null }, stages: stagesOf("NOT_REACHED") } as unknown as Receipt)).toBe("UNCHECKED");
    expect(chargedCheck({ verdict: { status: "PASS" }, stages: stagesOf("NOT_REACHED", "NOT_REACHED", "NOT_REACHED", "SKIPPED") } as Receipt)).toBe("UNCHECKED");
  });

  it("keeps the headline of a call that passed as presentVerdict words it", () => {
    const receipt = settledReceipt({ stages: stagesOf("PASSED") });
    expect(chargedHeadline(receipt)).not.toMatch(/Served; no check/);
  });
});

describe("receiptTimeline — the 1-hour hold", () => {
  const SETTLED = "2026-10-16T00:00:02.000Z";
  const INSIDE = Date.parse("2026-10-16T00:18:00.000Z");
  const AFTER = Date.parse("2026-10-16T03:00:00.000Z");
  const receipt = settledReceipt({
    listedPrice: usd("50000"),
    chargedPrice: usd("50000"),
    stages: [{ stage: "SCHEMA", status: "PASSED", passed: true }] as unknown as Receipt["stages"],
    settledAt: SETTLED,
    disputeWindowEndsAt: "2026-10-16T01:00:02.000Z",
    collectableAt: "2026-10-16T01:00:03.000Z",
    disputeFilingClosesAt: "2026-10-23T00:00:02.000Z",
  });
  const labels = (rows: { label: string }[]) => rows.map((r) => r.label);

  it("inside the hold: refundable until the hour ends, then it goes to the provider", () => {
    const rows = receiptTimeline(receipt, "CHARGED", { now: INSIDE });
    expect(labels(rows)).toEqual([
      "Call made",
      "Money held",
      "Charged",
      "Refundable until then",
      "Goes to the provider after the hold",
    ]);
    expect(rows[3]?.meta).toBe("report a bad result for a full refund");
    expect(rows.at(-1)?.meta).toBe("$0.05");
    expect(refundableUntil(receipt, INSIDE)).toMatch(/^Refundable until .*01:00 UTC$/);
  });

  it("after the hold: the hour ended and the payment was released, never asserted 'Paid'", () => {
    const rows = receiptTimeline(receipt, "CHARGED", { now: AFTER });
    expect(labels(rows).slice(-2)).toEqual(["Refundable hour ended", "Released to the provider"]);
    expect(labels(rows).join(" ")).not.toMatch(/Paid to provider/);
    expect(refundableUntil(receipt, AFTER)).toBeNull();
  });

  // B2 review I1: collection waits while a report is open.
  it("with a report open past collectableAt: held for the report, not released or paid", () => {
    const rows = receiptTimeline(receipt, "CHARGED", { now: AFTER, report: "open" });
    expect(labels(rows)).toContain("Held for your report until it is decided");
    expect(labels(rows).join(" ")).not.toMatch(/Released to the provider|Paid to provider/);
    expect(rows.find((r) => r.label === "Refundable hour ended")?.meta).toBe("you reported it");
  });

  // Re-review R2: an open report without the guarantee ("closed" here) does not stop collection.
  it("with a report not covered by the guarantee past collectableAt: released, and you reported it", () => {
    const rows = receiptTimeline(receipt, "CHARGED", { now: AFTER, report: "closed" });
    expect(labels(rows).slice(-2)).toEqual(["Refundable hour ended", "Released to the provider"]);
    expect(rows.find((r) => r.label === "Refundable hour ended")?.meta).toBe("you reported it");
    expect(labels(rows)).not.toContain("Held for your report until it is decided");
  });

  // B2 review I2: no refund promise on a call that cannot be reported, or already was.
  it("on a call that cannot be reported: 'Hold ends', no promise", () => {
    const own = { ...receipt, disputeFilingClosesAt: null };
    const inside = receiptTimeline(own, "CHARGED", { now: INSIDE });
    expect(labels(inside)).toContain("Hold ends");
    expect(inside.map((r) => r.meta).join(" ")).not.toMatch(/report|refund/);
    expect(labels(receiptTimeline(own, "CHARGED", { now: AFTER }))).toContain("Hold ended");
  });

  it("on a call already reported: says so instead of inviting a report", () => {
    const rows = receiptTimeline(receipt, "CHARGED", { now: INSIDE, report: "closed" });
    expect(rows.find((r) => r.label === "Refundable until then")?.meta).toBe("you reported it");
  });

  it("draws no hold on a call that was not charged", () => {
    const refunded = settledReceipt({ status: "REFUNDED", chargedPrice: usd("0"), holdReleasedAt: SETTLED, collectableAt: null, disputeWindowEndsAt: null });
    expect(labels(receiptTimeline(refunded, "NOT_CHARGED")).join(" ")).not.toMatch(/provider|Refundable/);
  });

  it("uses a debt's own closing row when one is given", () => {
    const rows = receiptTimeline(settledReceipt({ settledAt: SETTLED }), "DEBT_OUTSTANDING", {
      collectionClosing: { at: SETTLED, label: "Payment not taken", meta: "$2.50 owed", tone: "primary" },
    });
    expect(rows.at(-1)).toMatchObject({ label: "Payment not taken", meta: "$2.50 owed" });
  });
});

describe("toStageChecks — a check that does not apply", () => {
  it("says 'does not apply' once, not 'not reached' plus the same sentence twice", () => {
    const receipt = settledReceipt({
      stages: [
        { stage: "SCHEMA", status: "PASSED", passed: true, note: "runs on every call" },
        {
          stage: "SEMANTIC",
          status: "NOT_APPLICABLE",
          passed: false,
          note: "this check does not apply to this tool",
          detail: "This check does not apply to this tool.",
        },
      ] as unknown as Receipt["stages"],
    });
    const semantic = toStageChecks(receipt).find((c) => c.id === "SEMANTIC");
    expect(semantic).toMatchObject({ status: "not-applicable" });
    expect(semantic?.note).toBeUndefined();
    expect(semantic?.detail).toBeUndefined();
    expect(relevanceReached(receipt)).toBe(false);
  });
});
