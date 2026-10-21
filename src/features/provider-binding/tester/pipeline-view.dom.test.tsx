// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BindingTestLayer, BindingTestReport } from "@/interfaces";

// The icon set is SVG-as-data-URI components that jsdom cannot build.
vi.mock("@/components/icons", () => ({
  AlertFill: () => null,
  CheckCircle: () => null,
  CloseLine: () => null,
  WarningFill: () => null,
}));

import { TestPipelineView } from "./pipeline-view";

const LAYERS: BindingTestLayer[] = ["REQUEST_MAPPING", "UPSTREAM", "CLASSIFICATION", "RESPONSE_MAPPING", "VERIFICATION"];

function report(warnings: BindingTestReport["warnings"]): BindingTestReport {
  return {
    callId: "c",
    outcome: "PASSED",
    failedLayer: null,
    mappingVersion: 1,
    warnings,
    layers: LAYERS.map((layer) => ({ layer, status: "PASSED", code: null, detail: null, fault: null })),
    request: { method: "GET", url: "https://api.example.com/v1/quote?q=1", headerNames: [], body: null },
    upstream: { status: 200, latencyMs: 120, rawBody: "{}", rawBodyTruncated: false, contentType: "application/json", transportError: null },
    classification: { responseClass: "DATA_RESULT", reason: "OK" },
    mapped: { price: 3 },
    verification: { policySource: "STORED_POLICY", policyId: null, policyVersion: null, stages: [], verdict: "PASS" },
    ranAt: "2026-10-16T00:00:00Z",
  };
}

afterEach(cleanup);

describe("TestPipelineView warnings", () => {
  it("shows an authentication warning next to the success headline", () => {
    render(
      <TestPipelineView
        report={report([{ code: "ACCEPTS_UNSIGNED", message: "Your API answered an unsigned request." }])}
      />,
    );
    expect(screen.getByText("Signature not enforced · Warning (does not block Go live)")).toBeTruthy();
    expect(screen.getByText("Your API answered an unsigned request.")).toBeTruthy();
    expect(screen.getByText(/Test passed/)).toBeTruthy();
  });

  it("titles the other codes", () => {
    render(
      <TestPipelineView
        report={report([
          { code: "ACCEPTS_WITHOUT_CREDENTIALS", message: "a" },
          { code: "NO_AUTHENTICATION", message: "b" },
        ])}
      />,
    );
    expect(screen.getByText(/^API key not enforced/)).toBeTruthy();
    expect(screen.getByText(/^No authentication/)).toBeTruthy();
  });

  it("renders no alert without warnings", () => {
    render(<TestPipelineView report={report([])} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the warning next to the failure headline of a FAILED report", () => {
    const failed = report([{ code: "NO_AUTHENTICATION", message: "Nothing proves a call came from Assay." }]);
    failed.outcome = "FAILED";
    failed.failedLayer = "UPSTREAM";
    failed.layers = failed.layers.map((layer) =>
      layer.layer === "UPSTREAM" ? { ...layer, status: "FAILED", code: "UPSTREAM_ERROR" } : layer,
    );
    render(<TestPipelineView report={failed} />);
    expect(screen.getByText(/^No authentication/)).toBeTruthy();
    expect(screen.getByText("Nothing proves a call came from Assay.")).toBeTruthy();
    expect(screen.getByText(/Test failed/)).toBeTruthy();
  });
});

describe("TestPipelineView raw exchange and details", () => {
  it("lists the header names sent, signature included, and never a value", () => {
    const signed = report([]);
    signed.request = {
      method: "GET",
      url: "https://api.example.com/v1/quote?q=1",
      headerNames: ["accept", "x-assay-call-id", "signature-input", "signature"],
      body: null,
    };
    render(<TestPipelineView report={signed} />);
    expect(
      screen.getByText(/Headers \(values not shown\): accept, x-assay-call-id, signature-input, signature/),
    ).toBeTruthy();
  });

  it("puts the backend's wording behind Details on a failed step", () => {
    const failed = report([]);
    failed.outcome = "FAILED";
    failed.failedLayer = "RESPONSE_MAPPING";
    failed.layers = failed.layers.map((layer) =>
      layer.layer === "RESPONSE_MAPPING"
        ? {
            ...layer,
            status: "FAILED",
            fault: "PLATFORM",
            code: "TOOL_MAPPING_PATH_NOT_FOUND",
            detail: "Mapping selector resolved to nothing: $.markets (at /markets) for binding: ed44c0de-0000-4000-8000-000000000001",
          }
        : layer.layer === "VERIFICATION"
          ? { ...layer, status: "NOT_REACHED" }
          : layer,
    );
    render(<TestPipelineView report={failed} />);
    expect(screen.getByText(/Your answer has no “markets” field/)).toBeTruthy();
    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.getByText("Mapping selector resolved to nothing: $.markets (at /markets)")).toBeTruthy();
    expect(screen.getByText("Fix: the mapping (yours; Advanced mapping)")).toBeTruthy();
    expect(screen.queryByText(/Assay, not you/)).toBeNull();
    expect(document.body.textContent).not.toContain("ed44c0de");
  });
});
