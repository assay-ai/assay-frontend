import { describe, expect, it } from "vitest";

import { retentionHoursRemaining, retentionLabel } from "./format";

// BUG-R2-V3-01: judged 10 Oct 03:07, sealed 11 Oct 06:10, read 13 Oct 15:00.
const CREATED = "2026-10-10T03:07:00.000Z";
const EXPIRES = "2026-10-14T06:10:00.000Z";
const NOW = Date.parse("2026-10-13T15:00:00.000Z");

describe("retention — counted from the body's own expiry", () => {
  it("shows the hours the evidence page will honour, not created + 72h", () => {
    expect(retentionLabel("RAW", CREATED, NOW, EXPIRES)).toBe("available 16h");
    expect(retentionHoursRemaining("RAW", CREATED, NOW, EXPIRES)).toBeCloseTo(15.17, 1);
  });

  it("falls back to created + 72h when the wire carries no expiry", () => {
    expect(retentionLabel("RAW", CREATED, NOW)).toBe("expiring");
    expect(retentionLabel("RAW", CREATED, NOW, null)).toBe("expiring");
  });

  it("keeps the non-RAW states as they were", () => {
    expect(retentionLabel("DIGESTED", CREATED, NOW, EXPIRES)).toBe("hashes only");
    expect(retentionHoursRemaining("DIGESTED", CREATED, NOW, EXPIRES)).toBeNull();
  });
});
