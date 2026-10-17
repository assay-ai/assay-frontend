import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { MajorChoice } from "./contract-terms";
import { ContractTermsPanel } from "./contract-terms-panel";

const V2: MajorChoice = { major: 2, version: 3, semver: "2.0.0", status: "ACTIVE", sunsetAt: null, current: true, optionalOutputs: ["uv_index"], optionalInputs: ["units"] };
const V1: MajorChoice = { major: 1, version: 2, semver: "1.1.0", status: "DEPRECATED", sunsetAt: "2027-02-01T00:00:00.000Z", current: false, optionalOutputs: ["uv_index"], optionalInputs: [] };

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const render = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("ContractTermsPanel", () => {
  it("lists each version with where it stands, and the extra fields of the versions ticked", () => {
    const out = text(render(<ContractTermsPanel choices={[V2, V1]} terms={{ majors: [1], provides: ["uv_index"], supports: [] }} changed={false} onChange={() => {}} />));
    expect(out).toContain("Contract versions you serve");
    expect(out).toContain("v2 (2.0.0) Current: what agents get by default");
    expect(out).toContain("v1 (1.1.0) Stops on Feb 1, 2027 (UTC)");
    expect(out).toContain("Extra fields you return");
    expect(out).not.toContain("Extra inputs you accept");
    expect(out).toContain("v1 stops on Feb 1, 2027 (UTC). Add v2, check the mapping and run a test to keep serving calls.");
  });

  it("says a change needs a new test and publish", () => {
    const out = text(render(<ContractTermsPanel choices={[V2, V1]} terms={{ majors: [1, 2], provides: [], supports: ["units"] }} changed onChange={() => {}} />));
    expect(out).toContain("Extra inputs you accept");
    expect(out).toContain("Run a new test for each version, then publish again.");
  });

  it("shows nothing for a tool with one version and no extra fields", () => {
    const one = { ...V2, optionalOutputs: [], optionalInputs: [] };
    expect(render(<ContractTermsPanel choices={[one]} terms={{ majors: [2], provides: [], supports: [] }} changed={false} onChange={() => {}} />)).toBe("");
  });

  it("asks for at least one version", () => {
    const out = text(render(<ContractTermsPanel choices={[V2, V1]} terms={{ majors: [], provides: [], supports: [] }} changed onChange={() => {}} />));
    expect(out).toContain("Pick at least one version to serve.");
  });
});
