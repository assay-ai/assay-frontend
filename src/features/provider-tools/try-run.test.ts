import { describe, expect, it } from "vitest";

import { ApiError } from "@/libs/ApiClient";
import type { ProviderToolTryResult } from "@/services/provider-tools.service";

import { headerNamesLine, looksLikeCredential, operationsIn, parseHeaderLines, resultLine, tryBody, tryErrorView, warningText } from "./try-run";

describe("try errors", () => {
  it("lists the problems, and never says saved", () => {
    const view = tryErrorView(new ApiError("TOOL_PROVIDER_TOOL_INVALID", "x", 400, "/", { problems: ["the curl command has no URL"] }));
    expect(view).toEqual({ text: "The test could not run:", problems: ["The curl command has no URL."], operations: [] });
  });

  it("turns a several-operations refusal into a pick list of real operationIds", () => {
    const problem = "name the operation to try (operationId); there are: searchPosts, getPost, GET /health";
    expect(operationsIn([problem])).toEqual(["searchPosts", "getPost"]);
    expect(tryErrorView(new ApiError("TOOL_PROVIDER_TOOL_INVALID", "x", 400, "/", { problems: [problem] }))).toMatchObject({ operations: ["searchPosts", "getPost"], problems: [] });
  });
});

// BUG-PRV-SETUP-01: an oversized paste is a 413 with its own sentence, not "something went wrong".
describe("an oversized try", () => {
  it("says it is too large", () => {
    expect(tryErrorView(new ApiError("PAYLOAD_TOO_LARGE", "The request body is too large.", 413)).text).toBe(
      "This is too large to try. Paste a shorter command or document, or only the operation you want to list.",
    );
  });
});

describe("try requests", () => {
  it("sends a curl as is, and an OpenAPI with the operation and test-only headers", () => {
    expect(tryBody("curl https://a.example/x")).toEqual({ curl: "curl https://a.example/x" });
    expect(tryBody("openapi: 3.0.0", { operationId: "searchPosts", headers: "Authorization: Bearer abc\nnot a header" })).toEqual({
      openapi: "openapi: 3.0.0",
      operationId: "searchPosts",
      headers: { Authorization: "Bearer abc" },
    });
    expect(parseHeaderLines("X-Api-Key: k1\nbad")).toEqual({ "X-Api-Key": "k1" });
  });

  it("spots a credential in what was pasted", () => {
    expect(looksLikeCredential("curl -H 'Authorization: Bearer abcdefgh123' https://a")).toBe(true);
    expect(looksLikeCredential("curl https://a.example/x?q=1")).toBe(false);
  });
});

describe("try results", () => {
  const result: ProviderToolTryResult = {
    source: "CURL",
    ran: true,
    passed: true,
    ranAt: "2026-10-18T10:00:00.000Z",
    request: { method: "GET", url: "https://a.example/x", headerNames: ["authorization"] },
    upstream: { status: 200, latencyMs: 90, contentType: "application/json", bodyKind: "JSON", body: {}, transportError: null },
    inferred: { endpoint: "https://a.example/x", inputSchema: {}, outputSchema: null, examples: [], requestMapping: {}, responseMapping: null, operationId: null },
    warnings: [],
  };

  it("say what happened in words, header names only", () => {
    expect(resultLine(result)).toBe("GET https://a.example/x answered 200 in 90 ms.");
    expect(resultLine({ ...result, upstream: { ...result.upstream!, transportError: { kind: "CONNECTION_REFUSED", detail: null } } })).toBe("No answer: connection refused.");
    expect(headerNamesLine(result)).toBe("Sent with the headers authorization (values not shown).");
  });

  it("explain every warning, falling back to the server's own words", () => {
    expect(warningText({ code: "UNSIGNED_FOREIGN_ORIGIN", detail: "" })).toMatch(/without Assay's request signature/);
    expect(warningText({ code: "NEW_ONE", detail: "As the server says." })).toBe("As the server says.");
  });
});
