import { describe, expect, it } from "vitest";

import {
  STATE_CARDS,
  canContestRejection,
  deriveReceiptState,
  receiptFlow,
  relevanceReached,
  samplingExplainerCopy,
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

  it("draws held → check passed → charged for a charged call", () => {
    expect(receiptFlow(r("100000"), "CHARGED").map((n) => n.label)).toEqual(["Held", "Check passed", "Charged"]);
  });

  it("says the relevance stage was reached only when it ran or was sampled out", () => {
    expect(relevanceReached(r("0", [{ stage: "SEMANTIC", status: "NOT_REACHED" }]))).toBe(false);
    expect(relevanceReached(r("0", [{ stage: "SEMANTIC", status: "SKIPPED" }]))).toBe(true);
    expect(relevanceReached(r("0", []))).toBe(false);
  });
});
