import { describe, expect, it } from "vitest";

import { WITHDRAWAL_COPY } from "./withdrawal-copy";

/**
 * BUG-R2-D1-01: the gateway refuses every paid call while a withdrawal request
 * stands (`PAYMENT_WITHDRAWAL_PENDING`), and the page said "your calls keep
 * being paid". The copy has to state the pause before and after the request.
 */
describe("withdrawal copy", () => {
  it("says before requesting that agent payments stop until completed or cancelled", () => {
    expect(WITHDRAWAL_COPY.beforeRequest).toMatch(/agent payments stop/i);
    expect(WITHDRAWAL_COPY.beforeRequest).toMatch(/claim/i);
    expect(WITHDRAWAL_COPY.beforeRequest).toMatch(/cancel/i);
  });

  it("says while a request is pending that agent payments are stopped", () => {
    expect(WITHDRAWAL_COPY.whilePending).toMatch(/agent payments are stopped/i);
    expect(WITHDRAWAL_COPY.whilePending).toMatch(/claim/i);
    expect(WITHDRAWAL_COPY.whilePending).toMatch(/cancel/i);
  });

  it("never claims calls keep being paid or served", () => {
    for (const sentence of Object.values(WITHDRAWAL_COPY)) {
      expect(sentence).not.toMatch(/keep being paid|keeps serving calls/i);
    }
  });
});
