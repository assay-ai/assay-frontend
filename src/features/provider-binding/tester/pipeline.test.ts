import { describe, expect, it } from "vitest";

import type { BindingTestLayer, BindingTestLayerResult, BindingTestReport } from "@/interfaces";

import { isEmptyResult, testGate, testPipeline } from "./pipeline";

const LAYERS: BindingTestLayer[] = ["REQUEST_MAPPING", "UPSTREAM", "CLASSIFICATION", "RESPONSE_MAPPING", "VERIFICATION"];

function report(overrides: Partial<Record<BindingTestLayer, Partial<BindingTestLayerResult>>> = {}, extra: Partial<BindingTestReport> = {}): BindingTestReport {
  return {
    callId: "c",
    outcome: "PASSED",
    failedLayer: null,
    mappingVersion: 1,
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
    expect(pipeline.failed?.fault).toBe("the mapping");
  });

  it("lets the layer's own fault win", () => {
    const pipeline = testPipeline(report({ UPSTREAM: { status: "FAILED", fault: "PLATFORM" } }, { outcome: "FAILED" }));
    expect(pipeline.failed?.fault).toBe("Assay, not you");
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
