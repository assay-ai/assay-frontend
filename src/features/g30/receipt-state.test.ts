import { describe, expect, it } from "vitest";

import {
  COLLECTION_STATES,
  STATE_CARDS,
  canContestRejection,
  deriveReceiptState,
  samplingExplainerCopy,
} from "./receipt-state";
import type { Receipt } from "./wire";

const receipt = (sampling: Receipt["sampling"], listed = "1000") =>
  ({ sampling, listedPrice: { amount: listed, asset: "x", decimals: 6 } }) as Receipt;

describe("samplingExplainerCopy", () => {
  it("says the call was judged every time when the rate is 1 (no sampling paragraph)", () => {
    const copy = samplingExplainerCopy(receipt({ rate: 1, display: "every call" }), "$0.2500");
    expect(copy.body).toContain("every call at $0.2500");
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
    const copy = samplingExplainerCopy(receipt({ rate: 0.8, display: "80%" }, "100000"), "$0.1000");
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
    expect(STATE_CARDS.DEBT_VOIDED.sentence).toMatch(/You were not charged.*provider was not paid/);
    expect(COLLECTION_STATES.has("DEBT_VOIDED")).toBe(true);
  });
});
