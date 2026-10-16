import { describe, expect, it } from "vitest";

import { freeFirstHint } from "./free-first";

/**
 * Free first, then paid. A provider choosing FREE or FREEMIUM must be told that
 * its free tier is used first even when the tool also has PAID providers — the
 * opposite of what the platform did before, when one PAID binding made the
 * whole tool paid.
 */
describe("freeFirstHint", () => {
  it("tells a FREE or FREEMIUM binding its free tier is used before any paid provider", () => {
    for (const mode of ["FREE", "FREEMIUM"] as const) {
      const hint = freeFirstHint(mode);
      expect(hint).toMatch(/first, before any paid provider/);
    }
  });

  it("says a FREEMIUM binding charges its price past the free calls", () => {
    expect(freeFirstHint("FREEMIUM")).toMatch(/then your price applies/);
  });

  it("stays one short sentence", () => {
    for (const mode of ["FREE", "FREEMIUM"] as const) expect(freeFirstHint(mode)!.length).toBeLessThan(90);
  });

  it("says nothing for a PAID binding", () => {
    expect(freeFirstHint("PAID")).toBeNull();
  });
});
