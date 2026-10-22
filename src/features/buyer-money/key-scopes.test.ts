import { describe, expect, it } from "vitest";

import { createKeyBody, keyChoiceSummary, keyExpiry, keyMayPay, scopesFor, scopesText } from "./key-scopes";

const NOW = Date.parse("2026-10-22T00:00:00.000Z");
const DAY = 86_400_000;

describe("key presets", () => {
  it("Agent is call, pay and read activity; reports only when ticked", () => {
    expect(scopesFor("agent")).toEqual(["tools:call", "payments", "activity:read"]);
    expect(scopesFor("agent", true)).toEqual(["tools:call", "payments", "activity:read", "reports:write"]);
  });

  it("Free calls only can never pay; Read only can neither call nor report", () => {
    expect(scopesFor("free")).toEqual(["tools:call"]);
    expect(scopesFor("free", true)).toEqual(["tools:call", "reports:write"]);
    expect(scopesFor("read")).toEqual(["activity:read"]);
    expect(scopesFor("read", true)).toEqual(["activity:read"]);
  });

  it("the body: Agent for 90 days by default; a chosen expiry otherwise", () => {
    expect(createKeyBody("Key 1", {}, NOW)).toEqual({
      name: "Key 1",
      scopes: ["tools:call", "payments", "activity:read"],
      expiresAt: new Date(NOW + 90 * DAY).toISOString(),
    });
    expect(createKeyBody("CI", { preset: "read", days: 30 }, NOW).expiresAt).toBe(new Date(NOW + 30 * DAY).toISOString());
    expect(createKeyBody("CI", { days: 365 }, NOW).expiresAt).toBe(new Date(NOW + 365 * DAY).toISOString());
  });
});

describe("a key's scopes and expiry in words", () => {
  it("names only scopes the API grants", () => {
    expect(scopesText(["tools:call", "payments", "activity:read"])).toBe("Calls tools · pays · reads activity");
    expect(scopesText(["payments"])).toBe("Can do nothing");
    expect(scopesText(["something:else"])).toBe("Can do nothing");
    expect(scopesText(null)).toBe("Can do nothing");
  });

  it("may pay only with payments and tools:call", () => {
    expect(keyMayPay(["tools:call", "payments"])).toBe(true);
    expect(keyMayPay(["payments"])).toBe(false);
    expect(keyMayPay(["tools:call"])).toBe(false);
    expect(keyMayPay([])).toBe(false);
  });

  it("expires soon within 7 days", () => {
    expect(keyExpiry(new Date(NOW + 8 * DAY).toISOString(), NOW)?.soon).toBe(false);
    expect(keyExpiry(new Date(NOW + 7 * DAY).toISOString(), NOW)?.soon).toBe(true);
    expect(keyExpiry("not a date", NOW)).toBeNull();
  });
});

describe("keyChoiceSummary", () => {
  it("names the preset, reports when ticked (never on Read only), and the expiry", () => {
    expect(keyChoiceSummary("agent", false, 90)).toBe("Agent · expires in 90 days");
    expect(keyChoiceSummary("free", true, 365)).toBe("Free calls only · can report · expires in 1 year");
    expect(keyChoiceSummary("read", true, 30)).toBe("Read only · expires in 30 days");
  });
});
