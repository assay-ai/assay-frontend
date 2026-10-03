import { describe, expect, it } from "vitest";

import { depositSentNotice } from "./deposit-sent";

describe("depositSentNotice", () => {
  const EVM = "eip155:46630";
  const HASH = "0x95ba22671838ec5b3d54985f6e95b66d4644b32089c7a09c780d0bd2b35c2ae6";

  it("says the deposit was sent and is still confirming, with the amount and a short reference", () => {
    const notice = depositSentNotice({ amount: "$5.00", chainId: EVM, reference: HASH });
    expect(notice.message).toBe("Deposit of $5.00 sent");
    expect(notice.description).toContain("confirming on chain");
    expect(notice.description).toContain("0x95ba…2ae6");
  });

  it("does not invent a reference when the settle returned none", () => {
    const notice = depositSentNotice({ amount: "$5.00", chainId: EVM, reference: null });
    expect(notice.description).not.toContain("…");
    expect(notice.description).toContain("confirming on chain");
  });

  it("keeps the first-deposit limits reminder the result box used to carry", () => {
    const notice = depositSentNotice({ amount: "$5.00", chainId: EVM, reference: HASH });
    expect(notice.limitsHref).toBe("/funding/escrow/limits");
  });
});
