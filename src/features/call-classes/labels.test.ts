import { describe, expect, it } from "vitest";

import { CLASS_ORDER } from "./csv";
import { classLabel, reasonLabel, responseClassText } from "./labels";

describe("call class labels (BUG-R5-03)", () => {
  it("names every class the tables draw in plain language", () => {
    for (const name of CLASS_ORDER) {
      expect(classLabel(name)).not.toBe(name);
      expect(classLabel(name)).not.toMatch(/[A-Z]_[A-Z]/);
    }
    expect(classLabel("PAID_UNCREDITED")).toBe("Failed our checks");
  });

  it("shows a class it does not know as it is, rather than hiding it", () => {
    expect(classLabel("SOMETHING_NEW")).toBe("SOMETHING_NEW");
  });

  it("names the response classes on a receipt", () => {
    expect(responseClassText("DATA_RESULT")).toBe("Data returned · DATA_RESULT");
    expect(responseClassText("LATER_CLASS")).toBe("LATER_CLASS");
  });

  it("puts the settlement path's sentences in user words", () => {
    expect(reasonLabel("verification: judged and refunded by the worker")).toBe(
      "Failed our checks — the buyer was refunded"
    );
    expect(reasonLabel("mcp: provider outcome was not a DATA_RESULT")).not.toContain("DATA_RESULT");
  });

  it("names the cause of a forfeited voucher", () => {
    expect(classLabel("PROVIDER_FORFEITED")).toBe("Forfeited by you");
    expect(reasonLabel("provider_forfeit:ProviderBelowMinimumStake")).toBe(
      "Forfeited — your stake was below the minimum"
    );
    expect(reasonLabel("provider_forfeit:PayeeBlockedOnChain")).toContain("blocked on chain");
    expect(reasonLabel("provider_forfeit:SomethingElse")).toBe("Forfeited — SomethingElse");
  });

  it("names buyer debt and uncollected calls, never as owed by the platform", () => {
    expect(classLabel("PAID_BUYER_DEBT")).toBe("Passed, waiting on the buyer");
    expect(classLabel("PAID_UNCOLLECTED")).toBe("Passed, never collected");
    const debt = reasonLabel("buyer_debt:DelegateIsRevoked");
    expect(debt).toContain("the agent key that signed it was revoked");
    expect(debt).toContain("once the buyer settles it");
    expect(reasonLabel("buyer_debt:unknown")).toContain("the reason was not recorded");
    expect(reasonLabel("uncollected:VoucherExpired")).toMatch(/^Never collected.*the buyer still owes it; you are paid if they settle$/);
    expect(reasonLabel("voided:FAIL")).toMatch(/did not pass our checks — voided: not paid, and nobody owes it$/);
    for (const reason of ["buyer_debt:X", "uncollected:X", "voided:X"]) {
      expect(reasonLabel(reason)).not.toMatch(/owed by the platform|platform owes/);
    }
  });

  it("leaves a reason it does not know untouched", () => {
    expect(reasonLabel("settled, no credit written")).toBe("settled, no credit written");
  });
});
