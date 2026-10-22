import { describe, expect, it } from "vitest";

import {
  humanize,
  knowsError,
  plain,
  plainApiError,
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
    expect(plainError("ACCOUNT_DELEGATE_BIND_CONFLICT")).toMatch(/^Another payment key was set up for this key at the same moment/);
    expect(plainError("ACCOUNT_CREDENTIAL_NOT_FOUND")).toBe("This key is no longer on this agent. Reload the page.");
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

  it.each([
    "CREDENTIAL_IN_QUERY",
    "SECRET_IN_MAPPING",
    "INVALID_CREDENTIAL_HEADERS",
    "CREDENTIAL_ORIGIN_MISMATCH",
    "CREDENTIAL_VAULT_UNAVAILABLE",
    "ENDPOINT_PORT_NOT_SUPPORTED",
    "RESERVED_MAPPING_HEADER",
    "CREDENTIAL_ORIGIN_LIVE",
    "CREDENTIALS_REQUIRED_FOR_AUTH_MODE",
    "CREDENTIAL_VAULT_NOT_CONFIGURED",
  ])("gives %s its own sentence, bare and PROVIDER_-prefixed", (code) => {
    const generic = plainError("NOT_A_REAL_CODE_XYZ");
    expect(knowsError(code)).toBe(true);
    expect(plainError(code)).not.toBe(generic);
    expect(plainError(`PROVIDER_${code}`)).toBe(plainError(code));
  });

  it("knows the credentials-required-for-auth-mode code", () => {
    expect(plainError("PROVIDER_CREDENTIALS_REQUIRED_FOR_AUTH_MODE")).toBe(
      "Add your API key headers for the live address first, then switch to API key.",
    );
  });

  it("says a vault that is not set up is a storage problem, and that nothing was stored", () => {
    expect(plainError("PROVIDER_CREDENTIAL_VAULT_NOT_CONFIGURED", 503)).toBe(
      "Key storage isn't set up on this server, so headers can't be saved. Nothing was stored. Tell Assay support.",
    );
  });

  it("gives an unknown 5xx a status-aware sentence instead of the generic one", () => {
    const generic = plainError("SOMETHING_NOBODY_KNOWS");
    expect(plainError("SOMETHING_NOBODY_KNOWS", 503)).toBe(
      "This part of Assay is unavailable right now (HTTP 503). Try again in a few minutes; if it keeps happening, tell Assay support.",
    );
    expect(plainError("SOMETHING_NOBODY_KNOWS", 500)).toMatch(/^Something failed on Assay's side \(HTTP 500\)/);
    expect(plainError("SOMETHING_NOBODY_KNOWS", 502)).toMatch(/HTTP 502/);
    expect(plainError("SOMETHING_NOBODY_KNOWS", 500)).not.toBe(generic);
    // A known code keeps its own sentence; a 4xx keeps the generic one.
    expect(plainError("PROVIDER_CREDENTIAL_VAULT_UNAVAILABLE", 503)).toBe(plainError("CREDENTIAL_VAULT_UNAVAILABLE"));
    expect(plainError("SOMETHING_NOBODY_KNOWS", 400)).toBe(generic);
    expect(plainError(null, 503)).toMatch(/HTTP 503/);
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
    expect(plainAuditAction("agent.renamed")).toBe("Agent renamed");
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

// The group-3 backend codes get a sentence of their own, not the generic one.
describe("plainError for the group-3 codes", () => {
  it.each([
    ["PAYLOAD_TOO_LARGE", "This is too large to send. Make it shorter and try again."],
    ["ACCOUNT_AGENT_NOT_FOUND", "This agent was not found in your account. It may have been deleted."],
    ["PROVIDER_STAKE_INSUFFICIENT_BONDED", "That is more than your staked amount. Enter at most what is staked."],
    ["PROVIDER_STAKE_NOTHING_WITHDRAWABLE", "Nothing is ready to withdraw yet: unstaked money can be withdrawn once its waiting period ends."],
    ["PROVIDER_TOO_MANY_MAPPING_HEADERS", "This mapping has too many headers. Remove some and try again."],
    ["TOOLSET_ORGANIZATION_NOT_FOUND", "No organization has this id. Check it and try again."],
    ["PAYMENT_ESCROW_NOT_OPEN", "Open your escrow first."],
  ])("%s", (code, sentence) => {
    expect(plainError(code, 409)).toBe(sentence);
  });
});

describe("plainApiError", () => {
  // BUG-X-02: a blocked organization reads "Your account is blocked", another party's block does not.
  it("says the account is blocked in the backend's wording for the caller's own organization", () => {
    expect(plainApiError({ code: "ACCOUNT_BLOCKED", status: 403, message: "Your account is blocked by Assay; contact support" })).toBe(
      "Your account is blocked by Assay. Contact support.",
    );
    expect(plainApiError({ code: "ACCOUNT_BLOCKED", status: 403, message: "This account is blocked (payee); contact support" })).toBe(
      "This account is blocked. Contact support.",
    );
    expect(plainApiError({ code: "AUTH_ORGANIZATION_SUSPENDED", status: 403 })).toBe("Your account is blocked by Assay. Contact support.");
  });

  // Review M5: the blocked role decides when the body carries it; the sentence is the fallback.
  it("prefers the refusal's role to its wording", () => {
    expect(plainApiError({ code: "ACCOUNT_BLOCKED", status: 403, message: "anything", context: { role: "ORGANIZATION" } })).toBe(
      "Your account is blocked by Assay. Contact support.",
    );
    expect(plainApiError({ code: "ACCOUNT_BLOCKED", status: 403, message: "Your account is blocked by Assay", context: { role: "PAYEE" } })).toBe(
      "This account is blocked. Contact support.",
    );
  });

  it("names the wait of a 429", () => {
    expect(plainApiError({ code: "TOO_MANY_REQUESTS", status: 429, retryAfterSeconds: 26 })).toBe("Too many requests. Try again in 26 s.");
  });
  it("names the seconds still left of a 429's wait at the given instant", () => {
    const retryAt = Date.parse("2026-10-21T00:00:30Z");
    expect(plainApiError({ code: "TOO_MANY_REQUESTS", status: 429, retryAfterSeconds: 30, retryAt }, Date.parse("2026-10-21T00:00:12Z"))).toBe(
      "Too many requests. Try again in 18 s.",
    );
  });
  it("falls back to the fixed sentence without a wait", () => {
    expect(plainApiError({ code: "TOO_MANY_REQUESTS", status: 429 })).toBe(plainError("TOO_MANY_REQUESTS"));
  });
  it("is plainError for other codes", () => {
    expect(plainApiError({ code: "SPEND_LIMIT_EXCEEDED", status: 402 })).toBe(plainError("SPEND_LIMIT_EXCEEDED"));
    expect(plainApiError({ code: "WEIRD", status: 503 })).toBe(plainError("WEIRD", 503));
  });
});
