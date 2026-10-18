import { describe, expect, it } from "vitest";

import type { BindingTestLayer, BindingTestLayerResult, BindingTestReport } from "@/interfaces";

import { isEmptyResult, testGate, testPipeline } from "./pipeline";

const MAPPING = "the mapping (yours; Advanced mapping)";

const LAYERS: BindingTestLayer[] = ["REQUEST_MAPPING", "UPSTREAM", "CLASSIFICATION", "RESPONSE_MAPPING", "VERIFICATION"];

function report(overrides: Partial<Record<BindingTestLayer, Partial<BindingTestLayerResult>>> = {}, extra: Partial<BindingTestReport> = {}): BindingTestReport {
  return {
    callId: "c",
    outcome: "PASSED",
    failedLayer: null,
    mappingVersion: 1,
    warnings: [],
    layers: LAYERS.map((layer) => ({ layer, status: "PASSED", code: null, detail: null, fault: null, ...overrides[layer] })),
    request: { method: "GET", url: "https://api.example.com/v1/quote?q=1", headerNames: [], body: null },
    upstream: { status: 200, latencyMs: 120, rawBody: "{}", rawBodyTruncated: false, contentType: "application/json", transportError: null },
    classification: { responseClass: "DATA_RESULT", reason: "OK" },
    mapped: { price: 3 },
    verification: { policySource: "STORED_POLICY", policyId: null, policyVersion: null, stages: [], verdict: "PASS" },
    ranAt: "2026-10-16T00:00:00Z",
    ...extra,
  };
}

describe("testPipeline", () => {
  it("passes four steps on a green run", () => {
    const pipeline = testPipeline(report());
    expect(pipeline.steps.map((step) => step.status)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(pipeline.steps[0]!.sentence).toBe("GET api.example.com/v1/quote");
    expect(pipeline.failed).toBeNull();
    expect(pipeline.emptyResult).toBe(false);
  });

  it("blames the test input for a null value in the request", () => {
    const pipeline = testPipeline(
      report({ REQUEST_MAPPING: { status: "FAILED", code: "TOOL_MAPPING_NULL_VALUE" }, UPSTREAM: { status: "NOT_REACHED" } }, { outcome: "FAILED" }),
    );
    expect(pipeline.failed?.id).toBe("request");
    expect(pipeline.failed?.fault).toBe("your test input");
    expect(pipeline.steps[1]!.status).toBe("skipped");
  });

  it("blames the API for a 500 and the input for a 400", () => {
    const fiveHundred = testPipeline(
      report({ UPSTREAM: { status: "FAILED" } }, { outcome: "FAILED", upstream: { status: 500, latencyMs: 4, rawBody: null, rawBodyTruncated: false, contentType: null, transportError: null } }),
    );
    expect(fiveHundred.failed?.fault).toBe("your API");
    const badInput = testPipeline(
      report({ CLASSIFICATION: { status: "FAILED" } }, { outcome: "FAILED", classification: { responseClass: "REQUEST_ERROR", reason: "BAD" } }),
    );
    expect(badInput.failed?.fault).toBe("your test input");
  });

  it("blames the mapping when the output cannot be read", () => {
    const pipeline = testPipeline(report({ RESPONSE_MAPPING: { status: "FAILED" } }, { outcome: "FAILED" }));
    expect(pipeline.failed?.fault).toBe(MAPPING);
  });

  describe("fault table: whose fix it is (D wizard P1)", () => {
    const UUID = "ed44c0de-0000-4000-8000-000000000001";

    it("PLATFORM at Request built is the provider's own mapping, not Assay", () => {
      const pipeline = testPipeline(
        report(
          {
            REQUEST_MAPPING: {
              status: "FAILED",
              fault: "PLATFORM",
              code: "TOOL_MAPPING_PATH_NOT_FOUND",
              detail: `Mapping selector resolved to nothing: $.vsCurrency (at /query/vsCurrency) for binding: ${UUID}`,
            },
            UPSTREAM: { status: "NOT_REACHED" },
          },
          { outcome: "FAILED", request: null },
        ),
      );
      expect(pipeline.failed?.id).toBe("request");
      // The chip agrees with the sentence: the input is missing a value.
      expect(pipeline.failed?.fault).toBe("your test input");
      expect(pipeline.failed?.fault).not.toMatch(/Assay/);
      expect(pipeline.failed?.sentence).toBe(
        "Your test input has no “vsCurrency”, and the request needs it. Fill it in, or tick “may be missing” for it under Advanced mapping.",
      );
      // Internals stay behind "Details", and never carry the listing's id.
      expect(pipeline.failed?.details).toBe("Mapping selector resolved to nothing: $.vsCurrency (at /query/vsCurrency)");
      expect(JSON.stringify(pipeline)).not.toContain(UUID);
    });

    it("PLATFORM at Output mapped names the missing field in the provider's answer", () => {
      const pipeline = testPipeline(
        report(
          {
            RESPONSE_MAPPING: {
              status: "FAILED",
              fault: "PLATFORM",
              code: "TOOL_MAPPING_PATH_NOT_FOUND",
              detail: `Mapping selector resolved to nothing: $.markets (at /markets) for binding: ${UUID}`,
            },
            VERIFICATION: { status: "NOT_REACHED" },
          },
          { outcome: "FAILED" },
        ),
      );
      expect(pipeline.failed?.id).toBe("mapped");
      expect(pipeline.failed?.fault).toBe(MAPPING);
      expect(pipeline.failed?.sentence).toBe(
        "Your answer has no “markets” field. Change your API, or map another field under Advanced mapping.",
      );
      expect(pipeline.failed?.fault).not.toMatch(/Assay/);
    });

    it("a type mismatch reads plainly, with the raw detail kept", () => {
      const pipeline = testPipeline(
        report(
          {
            RESPONSE_MAPPING: {
              status: "FAILED",
              fault: "PROVIDER",
              code: "TOOL_MAPPING_TYPE_MISMATCH",
              detail: "Type mismatch at /markets: expected array, got object",
            },
          },
          { outcome: "FAILED" },
        ),
      );
      expect(pipeline.failed?.sentence).toBe("“markets” has the wrong type: the tool expects array, your answer gave object.");
      expect(pipeline.failed?.details).toBe("Type mismatch at /markets: expected array, got object");
      expect(pipeline.failed?.fault).toBe(MAPPING);
    });

    it("a 404 is a wrong address or path, not bad test input", () => {
      const pipeline = testPipeline(
        report(
          { CLASSIFICATION: { status: "FAILED", code: "REQUEST_REJECTED" } },
          {
            outcome: "FAILED",
            classification: { responseClass: "REQUEST_ERROR", reason: "REQUEST_REJECTED" },
            upstream: { status: 404, latencyMs: 9, rawBody: "", rawBodyTruncated: false, contentType: null, transportError: null },
          },
        ),
      );
      expect(pipeline.failed?.fault).toBe("the address or path");
      expect(pipeline.failed?.sentence).toBe(
        "Your API answered HTTP 404: nothing at this address. Check the address, and the path under Advanced mapping.",
      );
    });

    it("a 401 or 403 is the Authentication setting", () => {
      const pipeline = testPipeline(
        report(
          { CLASSIFICATION: { status: "FAILED" } },
          {
            outcome: "FAILED",
            classification: { responseClass: "REQUEST_ERROR", reason: "REQUEST_REJECTED" },
            upstream: { status: 401, latencyMs: 9, rawBody: "", rawBodyTruncated: false, contentType: null, transportError: null },
          },
        ),
      );
      expect(pipeline.failed?.fault).toBe("Authentication");
    });

    it("a call Assay could not prepare is Assay's, and says the API was not called", () => {
      const pipeline = testPipeline(
        report(
          { UPSTREAM: { status: "FAILED", code: "PLATFORM_UNAVAILABLE", detail: "request signing failed" } },
          {
            outcome: "FAILED",
            upstream: {
              status: 0,
              latencyMs: 1,
              rawBody: null,
              rawBodyTruncated: false,
              contentType: null,
              transportError: { kind: "PLATFORM_UNAVAILABLE", detail: "request signing failed" },
            },
          },
        ),
      );
      expect(pipeline.failed?.fault).toBe("Assay, not you");
      expect(pipeline.failed?.sentence).toMatch(/Your API wasn't called/);
    });

    it("headers over the 8 KiB cap are the provider's own headers, not Assay", () => {
      const pipeline = testPipeline(
        report(
          { UPSTREAM: { status: "FAILED", code: "PLATFORM_UNAVAILABLE", detail: "outbound request headers exceed 8 KiB" } },
          {
            outcome: "FAILED",
            upstream: {
              status: 0,
              latencyMs: 1,
              rawBody: null,
              rawBodyTruncated: false,
              contentType: null,
              transportError: { kind: "PLATFORM_UNAVAILABLE", detail: "outbound request headers exceed 8 KiB" },
            },
          },
        ),
      );
      expect(pipeline.failed?.fault).toBe("your headers");
      expect(pipeline.failed?.sentence).toMatch(/^Your headers are too large \(over 8 KiB together\)/);
      expect(pipeline.failed?.sentence).not.toMatch(/Try again/);
    });

    it("missing API key headers point at Authentication", () => {
      const pipeline = testPipeline(
        report(
          { UPSTREAM: { status: "FAILED", code: "PLATFORM_UNAVAILABLE", detail: "credentials missing for this address" } },
          {
            outcome: "FAILED",
            upstream: {
              status: 0,
              latencyMs: 1,
              rawBody: null,
              rawBodyTruncated: false,
              contentType: null,
              transportError: { kind: "PLATFORM_UNAVAILABLE", detail: "credentials missing for this address" },
            },
          },
        ),
      );
      expect(pipeline.failed?.fault).toBe("Authentication");
    });
  });

  it("names failing checks in plain words", () => {
    const pipeline = testPipeline(
      report({ VERIFICATION: { status: "FAILED" } }, {
        outcome: "FAILED",
        verification: {
          policySource: "STORED_POLICY",
          policyId: null,
          policyVersion: null,
          verdict: "FAIL",
          stages: [
            {
              stage: "DETERMINISTIC_RULES",
              status: "FAILED",
              code: null,
              detail: null,
              score: 0,
              rules: [{ ruleId: "r", type: "NO_DUPLICATES", outcome: "FAILED", weight: 1, code: null, detail: null, pointer: null }],
            },
          ],
        },
      }),
    );
    expect(pipeline.steps[3]!.sentence).toBe("Failed: No result appears twice.");
    expect(pipeline.steps[3]!.sentence).not.toMatch(/NO_DUPLICATES/);
  });

  it("warns when an empty result passed every check", () => {
    const pipeline = testPipeline(report({}, { mapped: { results: [] } }));
    expect(pipeline.emptyResult).toBe(true);
    expect(pipeline.steps[3]!.sentence).toBe("Empty result: all checks skipped.");
    expect(pipeline.steps[3]!.status).toBe("warn");
  });
});

describe("isEmptyResult", () => {
  it("treats nested emptiness as empty", () => {
    expect(isEmptyResult(null)).toBe(true);
    expect(isEmptyResult({ a: [], b: "" })).toBe(true);
    expect(isEmptyResult({ a: 0 })).toBe(false);
    expect(isEmptyResult([1])).toBe(false);
  });
});

describe("testGate", () => {
  it("does not let an empty-result pass through without an acknowledgement", () => {
    const empty = { passed: true, emptyResult: true };
    expect(testGate(empty, { stale: false, emptyAcknowledged: false })).toEqual({ passed: false, needsEmptyAck: true });
    expect(testGate(empty, { stale: false, emptyAcknowledged: true })).toEqual({ passed: true, needsEmptyAck: true });
  });

  it("passes a real pass, and never a stale or failed run", () => {
    expect(testGate({ passed: true, emptyResult: false }, { stale: false, emptyAcknowledged: false }).passed).toBe(true);
    expect(testGate({ passed: true, emptyResult: false }, { stale: true, emptyAcknowledged: false }).passed).toBe(false);
    expect(testGate({ passed: false, emptyResult: true }, { stale: false, emptyAcknowledged: true })).toEqual({
      passed: false,
      needsEmptyAck: false,
    });
  });
});
