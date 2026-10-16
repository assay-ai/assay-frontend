import { describe, expect, it } from "vitest";

import { demoDebtSigned, markDemoDebtsSigned, parseDebtVariant } from "./demo-debts";
import "./fixtures";
import { demoDebts } from "./fixtures-buyer";

describe("demo debt pictures", () => {
  it("reads only the known variants", () => {
    expect(parseDebtVariant("many")).toBe("many");
    expect(parseDebtVariant("written-off")).toBe("written-off");
    expect(parseDebtVariant("bogus")).toBeNull();
    expect(parseDebtVariant(null)).toBeNull();
  });

  it("serves one open debt by default, and shows a debt signed in the demo as being collected", () => {
    const [open] = demoDebts();
    expect(open.state).toBe("OPEN");
    markDemoDebtsSigned([open.intentId]);
    expect(demoDebtSigned(open.intentId)).toBe(true);
    const [after] = demoDebts();
    expect(after.state).toBe("REPLACING");
    expect(after.replacedAt).not.toBeNull();
  });
});
