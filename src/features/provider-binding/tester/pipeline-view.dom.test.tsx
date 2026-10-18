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
    expect(screen.getByText("Signature not enforced")).toBeTruthy();
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
    expect(screen.getByText("API key not enforced")).toBeTruthy();
    expect(screen.getByText("No authentication")).toBeTruthy();
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
    expect(screen.getByText("No authentication")).toBeTruthy();
    expect(screen.getByText("Nothing proves a call came from Assay.")).toBeTruthy();
    expect(screen.getByText(/Test failed/)).toBeTruthy();
  });
});
