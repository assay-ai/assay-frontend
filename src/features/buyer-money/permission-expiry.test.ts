import { describe, expect, it } from "vitest";

import { permissionExpiry } from "./permission-expiry";

const NOW = Date.parse("2026-10-16T12:00:00Z");
const at = (iso: string) => ({ status: "ACTIVE" as const, validUntil: iso });

describe("permissionExpiry", () => {
  it("warns within seven days, saying how long is left", () => {
    expect(permissionExpiry(at("2026-10-19T13:00:00Z"), NOW)?.label).toBe("in 3 days");
    expect(permissionExpiry(at("2026-10-17T13:00:00Z"), NOW)?.label).toBe("in 1 day");
    expect(permissionExpiry(at("2026-10-16T20:00:00Z"), NOW)?.label).toBe("within a day");
    expect(permissionExpiry(at("2026-10-23T11:00:00Z"), NOW)?.daysLeft).toBe(6);
  });

  it("says nothing when it is far off, over, inactive or unreadable", () => {
    expect(permissionExpiry(at("2026-11-10T12:00:00Z"), NOW)).toBeNull();
    expect(permissionExpiry(at("2026-10-15T12:00:00Z"), NOW)).toBeNull();
    expect(permissionExpiry({ status: "EXPIRED", validUntil: "2026-10-18T12:00:00Z" }, NOW)).toBeNull();
    expect(permissionExpiry(at("not a date"), NOW)).toBeNull();
    expect(permissionExpiry(null, NOW)).toBeNull();
  });
});
