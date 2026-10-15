import { describe, expect, it } from "vitest";

import { freeFirstHint } from "./free-first";

/**
 * Free first, then paid. A provider choosing FREE or FREEMIUM must be told that
 * its free tier is used first even when the tool also has PAID providers — the
 * opposite of what the platform did before, when one PAID binding made the
 * whole tool paid.
 */
describe("freeFirstHint", () => {
  it("tells a FREE or FREEMIUM binding its free tier is used first beside paid providers", () => {
    for (const mode of ["FREE", "FREEMIUM"] as const) {
      const hint = freeFirstHint(mode);
      expect(hint).toMatch(/used first/);
      expect(hint).toMatch(/paid providers/);
    }
  });

  it("says a FREE binding never takes a paid call, and a FREEMIUM one does past the quota", () => {
    expect(freeFirstHint("FREE")).toMatch(/never takes a paid call/);
    expect(freeFirstHint("FREEMIUM")).toMatch(/then paid calls/);
  });

  it("says nothing for a PAID binding", () => {
    expect(freeFirstHint("PAID")).toBeNull();
  });
});
