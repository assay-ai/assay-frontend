import { describe, expect, it } from "vitest";

import { STATUS_CHIPS } from "./status-chip";

describe("STATUS_CHIPS (operator redesign C5)", () => {
  it("draws disputed amber and waiting neutral, so neither reads as success", () => {
    expect(STATUS_CHIPS.disputed.tone).toBe("warning");
    expect(STATUS_CHIPS.waiting.tone).toBe("neutral");
    expect(STATUS_CHIPS["needs-you"].tone).toBe("danger");
  });

  it("has the waiting-for-signature state, not in Disputed's amber", () => {
    expect(STATUS_CHIPS["waiting-signature"]).toMatchObject({ label: "Waiting for signature", tone: "info" });
    expect(STATUS_CHIPS["waiting-signature"].tone).not.toBe(STATUS_CHIPS.disputed.tone);
  });

  it("draws Executed as a final state, not in the red of Penalty upheld", () => {
    expect(STATUS_CHIPS.executed.tone).toBe("ink");
    expect(STATUS_CHIPS.upheld.tone).toBe("danger");
  });

  it("gives the scanned-for states an icon", () => {
    for (const key of ["needs-you", "waiting", "blocked", "done", "disputed", "rejected", "withdrawn", "expired", "waiting-signature", "executed"] as const) {
      expect(STATUS_CHIPS[key]).toHaveProperty("icon");
    }
  });
});
