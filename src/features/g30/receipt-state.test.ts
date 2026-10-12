import { describe, expect, it } from "vitest";

import { STATE_CARDS, deriveReceiptState, samplingExplainerCopy } from "./receipt-state";
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
