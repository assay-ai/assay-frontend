import { describe, expect, it } from "vitest";

import { ApiError } from "@/libs/ApiClient";
import type { ProviderTool, ProviderToolGate, ProviderToolReview, ProviderToolVersion } from "@/services/provider-tools.service";

import {
  connectHref,
  contractBody,
  contractFormFor,
  doneSteps,
  findingPlace,
  findingText,
  gateRows,
  localNameProblem,
  modelSeenName,
  nameLengthWarning,
  providerToolErrorView,
  providerToolState,
  resumeStep,
  showsNotReviewed,
  suggestLocalName,
  versionRows,
} from "./model";

const review = (over: Partial<ProviderToolReview> = {}): ProviderToolReview => ({
  status: "NONE",
  state: "NOT_SUBMITTED",
  label: "Not reviewed",
  kind: null,
  reviewVersion: null,
  reviewSemver: null,
  note: null,
  submittedAt: null,
  decidedAt: null,
  approvedVersion: null,
  approvedSemver: null,
  ...over,
});

const version = (over: Partial<ProviderToolVersion> = {}): ProviderToolVersion => ({
  version: 1,
  semver: "1.0.0",
  major: 1,
  status: "ACTIVE",
  summary: "Search posts",
  description: "Searches public posts.",
  inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  outputSchema: { type: "object", properties: { posts: { type: "array" } }, required: ["posts"] },
  optionalInputFields: [],
  optionalOutputFields: [],
  examples: [],
  rules: [],
  tier: "UNVERIFIED",
  changelog: null,
  sunsetAt: null,
  publishedAt: "2026-10-01T00:00:00.000Z",
  isCurrent: true,
  approved: false,
  ...over,
});

const tool = (over: Partial<ProviderTool> = {}): ProviderTool => ({
  id: "t1",
  name: "acme__search_posts",
  localName: "search_posts",
  handle: "acme",
  preview: "mcp__acme__acme__search_posts",
  category: "social",
  tags: [],
  visibility: "PRIVATE",
  status: "ACTIVE",
  currentSemver: "1.0.0",
  currentVersion: 1,
  hasDraft: false,
  notReviewed: true,
  review: review(),
  replacementToolId: null,
  replacementName: null,
  removedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  versions: [version()],
  draft: null,
  binding: null,
  mcpUrls: { handle: null },
  quality: {
    windowDays: 30,
    calls: 0,
    schemaFailures: 0,
    schemaPassRate: null,
    rulesJudged: 0,
    rulesFailed: 0,
    rulesPassRate: null,
    slaVerifiedCalls: 0,
    slaFailedCalls: 0,
    slaFailureRate: null,
    disputesDecided: null,
    disputesUpheld: null,
    quality: null,
    maxTier: "VERIFIED",
  },
  earliestSunsetAt: "2027-01-20T00:00:00.000Z",
  takedown: null,
  ...over,
});

describe("tool names", () => {
  it("previews the name exactly as a model sees it", () => {
    expect(modelSeenName("acme", "search_posts")).toBe("mcp__acme__acme__search_posts");
    expect(modelSeenName("marketkit-labs", "x1")).toBe("mcp__marketkit__marketkit-labs__x1");
  });

  it("refuses names the backend refuses, in plain words", () => {
    expect(localNameProblem("acme", "")).toMatch(/Give your tool a name/);
    expect(localNameProblem("acme", "search__posts")).toMatch(/two underscores/);
    expect(localNameProblem("acme", "Search")).toMatch(/lowercase/);
    expect(localNameProblem("acme", "1search")).toMatch(/Start with a letter/);
    expect(localNameProblem("acme", "search-posts")).toMatch(/digits and “_”/);
    expect(localNameProblem("acme", "a".repeat(41))).toMatch(/at most 40/);
    expect(localNameProblem("acme", "search_posts")).toBeNull();
  });

  it("enforces the 48-character full name, and warns before it", () => {
    const handle = "abcdefghijklmnopqrstuvwx"; // 24, the longest handle
    expect(localNameProblem(handle, "a".repeat(23))).toMatch(/49 characters; the most is 48/);
    expect(localNameProblem(handle, "a".repeat(22))).toBeNull();
    expect(nameLengthWarning(handle, "a".repeat(22))).toBe("This is the longest name allowed.");
    expect(nameLengthWarning(handle, "a".repeat(18))).toBe("4 characters left before the limit.");
    expect(nameLengthWarning("acme", "search")).toBeNull();
  });

  it("suggests a name from words", () => {
    expect(suggestLocalName("Search posts!")).toBe("search_posts");
    expect(suggestLocalName("  42 Weather -- now ")).toBe("weather_now");
  });
});

describe("tool states", () => {
  it("a takedown wins over everything", () => {
    expect(providerToolState(tool({ visibility: "LISTED", removedAt: "2026-10-10T00:00:00.000Z", review: review({ state: "LISTED" }) })).label).toBe("Taken down");
  });

  it("names every state the console shows", () => {
    expect(providerToolState(tool({ status: "DRAFT", currentVersion: null, versions: [] })).label).toBe("Draft");
    expect(providerToolState(tool()).label).toBe("Only my team");
    expect(providerToolState(tool({ visibility: "UNLISTED" })).label).toBe("Anyone with the link");
    expect(providerToolState(tool({ review: review({ status: "PENDING", state: "IN_REVIEW" }) })).label).toBe("In review");
    expect(
      providerToolState(tool({ visibility: "LISTED", review: review({ status: "PENDING", state: "CHANGES_IN_REVIEW", label: "Changes in review; v1.0.0 still serving" }) })).detail,
    ).toBe("Changes in review; v1.0.0 still serving.");
    expect(providerToolState(tool({ review: review({ status: "REJECTED", state: "REJECTED", note: "Remove the key input" }) })).label).toBe("Changes requested");
    expect(providerToolState(tool({ visibility: "LISTED", review: review({ status: "APPROVED", state: "LISTED" }) })).label).toBe("Listed");
    expect(providerToolState(tool({ status: "DEPRECATED", replacementName: "search_posts" })).detail).toBe("Agents are pointed to search_posts.");
  });

  it("shows Not reviewed only where others can reach it", () => {
    expect(showsNotReviewed(tool())).toBe(false);
    expect(showsNotReviewed(tool({ visibility: "UNLISTED" }))).toBe(true);
    expect(showsNotReviewed(tool({ visibility: "UNLISTED", notReviewed: false }))).toBe(false);
  });
});

describe("the four steps", () => {
  const passed: ProviderToolGate = { passed: true, requirements: [], screen: [] };
  it("resumes at the first step not done", () => {
    expect(resumeStep(null, null)).toBe("name");
    expect(resumeStep(tool({ currentVersion: null, status: "DRAFT", versions: [] }), null)).toBe("contract");
    expect(resumeStep(tool(), { ...passed, passed: false })).toBe("connect");
    expect(resumeStep(tool(), passed)).toBe("share");
    expect([...doneSteps(tool({ visibility: "UNLISTED" }), passed)]).toEqual(["name", "contract", "connect", "share"]);
  });
});

describe("the publish gate", () => {
  const gate: ProviderToolGate = {
    passed: false,
    requirements: [
      { requirement: "BINDING_PUBLISHED", met: false, code: null, detail: null },
      { requirement: "STAKE_AT_MINIMUM_ON_EVERY_CHAIN", met: false, code: null, detail: "eip155:1 below the minimum" },
      { requirement: "SCHEMA_SCREEN", met: true, code: null, detail: null },
    ],
    screen: [],
  };

  it("says what each check is, and links to the fix", () => {
    const rows = gateRows(gate, tool());
    expect(rows.map((r) => r.label)).toEqual(["Your endpoint is connected and live", "Your stake is at the minimum", "The text passes the safety screen"]);
    expect(rows[0]!.fix).toEqual({ kind: "link", label: "Connect your endpoint", href: connectHref(tool()) });
    expect(rows[1]!.fix).toEqual({ kind: "link", label: "Add stake", href: "/provider/capital?sheet=stake" });
    expect(rows[1]!.detail).toBe("eip155:1 below the minimum");
  });

  it("opens the listing wizard on this tool, and comes back to the flow", () => {
    expect(connectHref(tool())).toBe("/provider/bindings/new?stage=connect&tool=t1&back=%2Fprovider%2Fapis%2Fview%3Fid%3Dt1%26step%3Dconnect");
    expect(connectHref(tool({ binding: { bindingId: "b1", status: "DRAFT", mappingVersion: 1, publishedVersion: null } }), "live")).toBe(
      "/provider/bindings/new?binding=b1&stage=live&back=%2Fprovider%2Fapis%2Fview%3Fid%3Dt1%26step%3Dconnect",
    );
  });
});

describe("schema screen findings", () => {
  it("says where, in words", () => {
    expect(findingPlace("inputSchema/properties/q/description")).toBe("Input q, description");
    expect(findingPlace("outputSchema/properties/posts/items/properties/url")).toBe("Output posts.url");
    expect(findingPlace("examples/1/arguments")).toBe("Example 2, arguments");
    expect(findingPlace("summary")).toBe("Summary");
    expect(findingPlace("rules/0")).toBe("Check 1");
    expect(findingText({ code: "SECRET_INPUT" })).toMatch(/asks the agent for a secret/);
    expect(findingText({ code: "NEW_THING" })).toBe("This does not pass the safety screen.");
  });
});

describe("versions", () => {
  it("lists newest first; only a non-current major's newest version can be deprecated", () => {
    const rows = versionRows(
      tool({
        currentVersion: 3,
        versions: [
          version({ version: 3, semver: "2.0.0", major: 2, isCurrent: true }),
          version({ version: 2, semver: "1.1.0", major: 1, isCurrent: false }),
          version({ version: 1, semver: "1.0.0", major: 1, isCurrent: false }),
        ],
      }),
    );
    expect(rows.map((r) => [r.semver, r.canDeprecate])).toEqual([
      ["2.0.0", false],
      ["1.1.0", true],
      ["1.0.0", false],
    ]);
  });
});

describe("the contract form", () => {
  it("opens on the newest version and builds the body with its checks", () => {
    const form = contractFormFor(tool());
    expect(form.summary).toBe("Search posts");
    const result = contractBody(form, '[{"id":"posts","type":"MIN_ARRAY_LENGTH","path":"$.posts","min":1}]');
    expect(result.body?.rules).toHaveLength(1);
    expect(result.body?.baseVersion).toBe(1);
  });

  it("refuses checks that are not a JSON list", () => {
    expect(contractBody(contractFormFor(tool()), "{").errors.rules).toBe("The checks are not valid JSON.");
    expect(contractBody(contractFormFor(tool()), "{}").errors.rules).toMatch(/JSON list/);
  });

  it("opens a draft against the version it changes", () => {
    const form = contractFormFor(tool({ draft: { ...version({ version: 2, semver: "1.1.0", status: "DRAFT" }), baseSemver: "1.0.0", bump: "MINOR", changes: [], problems: [], screen: [], inReview: false, updatedAt: "2026-10-02T00:00:00.000Z" } }));
    expect(form.baseVersion).toBe(1);
  });
});

describe("errors", () => {
  it("offers the free name the server suggested", () => {
    const view = providerToolErrorView(new ApiError("TOOL_PROVIDER_TOOL_NAME_TAKEN", "taken", 409, "/", { name: "acme__x", suggestion: "x_2" }));
    expect(view).toMatchObject({ suggestion: "x_2", text: "That name is taken. “x_2” is free." });
  });

  it("asks for a public name first", () => {
    expect(providerToolErrorView(new ApiError("TOOL_PROVIDER_TOOL_NOT_ALLOWED", "no", 403, "/", { reason: "NO_HANDLE" })).text).toMatch(/public name/);
  });

  it("marks a gate refusal so the checklist is shown", () => {
    expect(providerToolErrorView(new ApiError("TOOL_PROVIDER_TOOL_GATE_FAILED", "no", 409, "/", { failed: "STAKE" })).gateFailed).toBe(true);
  });
});

describe("imported schemas", () => {
  it("every field an import brings is required or optional", async () => {
    const { optionalFromSchema } = await import("./schema-fields");
    expect(optionalFromSchema({ type: "object", properties: { results: { type: "array" }, total: { type: "integer" } }, required: ["results"] })).toEqual(["total"]);
  });
});
