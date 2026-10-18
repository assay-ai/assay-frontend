import { describe, expect, it } from "vitest";

import {
  humanize,
  plain,
  plainAuditAction,
  plainDecision,
  plainError,
  plainEvent,
  plainRule,
  windowLabel,
} from "./plain-language";

describe("humanize (the fallback)", () => {
  it.each([
    ["MIN_ARRAY_LENGTH", "Min array length"],
    ["slash_proposal.suspended", "Slash proposal suspended"],
    ["passThreshold", "Pass threshold"],
    ["VALID_URL", "Valid URL"],
    ["mcp-endpoint", "MCP endpoint"],
  ])("%s → %s", (key, expected) => {
    expect(humanize(key)).toBe(expected);
  });

  it("is empty for nothing", () => {
    expect(humanize(undefined)).toBe("");
  });
});

describe("rules", () => {
  it("uses parameters when given", () => {
    expect(plainRule("MIN_ARRAY_LENGTH", { min: 3 })).toBe("Returns at least 3 results");
    expect(plainRule("MIN_ARRAY_LENGTH")).toBe("Returns at least one result");
    expect(plainRule("REQUIRED_FIELDS", { fields: ["title", "url"] })).toBe("Every result includes “title” and “url”");
    expect(plainRule("FRESHNESS", { maxAgeMs: 86_400_000 })).toBe("Data is no older than 24 hours");
    expect(plainRule("VALUE_RANGE", { min: 0, max: 1 })).toBe("Values fall between 0 and 1");
  });

  it("names the deciding clause of a verdict", () => {
    expect(plainDecision("quorum_failures_at_least")).toBe("Enough checks failed to decide the result");
    expect(plain("quorum_votes_below")).toBe("Too few checks ran to judge fully");
  });

  it("names windows", () => {
    expect(windowLabel("w_4482")).toBe("Window 4482");
    expect(plain("w_12")).toBe("Window 12");
  });
});

describe("errors", () => {
  it("knows codes with and without their module prefix", () => {
    expect(plainError("MCP_SPEND_LIMIT_EXCEEDED")).toBe("This call would go over your spend limit.");
    expect(plainError("SPEND_LIMIT_EXCEEDED")).toBe("This call would go over your spend limit.");
    expect(plainError("PAYMENT_VOUCHER_ADMISSION_PAUSED")).toMatch(/^Paid calls are paused/);
    expect(plainError("UNBONDING_NOT_MATURED")).toMatch(/still unlocking/);
    expect(plainError("OPERATOR_AUTHORITY_EXCEEDED")).toMatch(/above your approval limit/);
  });

  it("knows the credential and mapping hardening codes", () => {
    expect(plainError("PROVIDER_RESERVED_MAPPING_HEADER")).toBe(
      "Headers starting with x-assay- are set by Assay. Remove this header from your mapping.",
    );
    expect(plainError("PROVIDER_CREDENTIAL_ORIGIN_LIVE")).toBe(
      "Your live tool uses these headers. Publish a new address first, then remove them.",
    );
  });

  it("knows the credentials-required-for-auth-mode code", () => {
    expect(plainError("PROVIDER_CREDENTIALS_REQUIRED_FOR_AUTH_MODE")).toBe(
      "Add your API key headers for the live address first, then switch to API key.",
    );
  });

  it("never shows an unknown code as the sentence", () => {
    const sentence = plainError("SOMETHING_NOBODY_KNOWS");
    expect(sentence).not.toContain("SOMETHING");
    expect(plainError(null)).toBe("Something went wrong. Try again.");
  });
});

describe("actions and events", () => {
  it("reads audit actions as phrases", () => {
    expect(plainAuditAction("credential.revoked")).toBe("Agent key revoked");
    expect(plainAuditAction("brand.new_thing")).toBe("Brand new thing");
  });

  it("reuses the notification catalogue for events", () => {
    expect(plainEvent("balance.low")).toBe("Balance is low");
  });
});

describe("plain (any key)", () => {
  it.each([
    ["MIN_ARRAY_LENGTH", "Returns at least one result"],
    ["DATA_RESULT", "The provider returned data"],
    ["SETTLED", "Charged"],
    ["stale_timestamp", "The data was older than allowed"],
    ["STAKE_BELOW_MINIMUM", "The provider's stake is below the minimum"],
    ["SPEND_LIMIT_EXCEEDED", "This call would go over your spend limit"],
    ["NOT_A_KNOWN_KEY", "Not a known key"],
  ])("%s → %s", (key, expected) => {
    expect(plain(key)).toBe(expected);
  });
});
