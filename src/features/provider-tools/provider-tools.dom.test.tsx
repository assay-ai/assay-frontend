import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ProviderTool, ProviderToolGate } from "@/services/provider-tools.service";

import { NameStep } from "./name-step";
import { ShareStep } from "./share-steps";
import { GateChecklist, ProviderToolChips, VersionHistory } from "./ui";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/provider/apis/view", useSearchParams: () => new URLSearchParams() }));

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

function render(node: React.ReactNode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

const base: ProviderTool = {
  id: "t1",
  name: "acme__search_posts",
  localName: "search_posts",
  handle: "acme",
  preview: "mcp__acme__acme__search_posts",
  category: "social",
  tags: ["posts"],
  visibility: "UNLISTED",
  status: "ACTIVE",
  currentSemver: "1.0.0",
  currentVersion: 1,
  hasDraft: false,
  notReviewed: true,
  review: { status: "NONE", state: "NOT_SUBMITTED", label: "Not reviewed", kind: null, reviewVersion: null, reviewSemver: null, note: null, submittedAt: null, decidedAt: null, approvedVersion: null, approvedSemver: null },
  replacementToolId: null,
  replacementName: null,
  removedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  versions: [
    {
      version: 1,
      semver: "1.0.0",
      major: 1,
      status: "ACTIVE",
      summary: "Search posts",
      description: "",
      inputSchema: {},
      outputSchema: {},
      optionalInputFields: [],
      optionalOutputFields: [],
      examples: [],
      rules: [],
      tier: "UNVERIFIED",
      changelog: "First version",
      sunsetAt: null,
      publishedAt: "2026-10-01T12:00:00.000Z",
      isCurrent: true,
      approved: false,
    },
  ],
  draft: null,
  binding: { bindingId: "b1", status: "ACTIVE", mappingVersion: 1, publishedVersion: 1 },
  mcpUrls: { handle: null },
  quality: { windowDays: 30, calls: 0, schemaFailures: 0, schemaPassRate: null, rulesJudged: 0, rulesFailed: 0, rulesPassRate: null, slaVerifiedCalls: 0, slaFailedCalls: 0, slaFailureRate: null, disputesDecided: null, disputesUpheld: null, quality: null, maxTier: "VERIFIED" },
};

const failing: ProviderToolGate = {
  passed: false,
  requirements: [
    { requirement: "TESTER_PASSED", met: true, code: null, detail: null },
    { requirement: "PAYOUT_ACCOUNT", met: false, code: null, detail: null },
  ],
  screen: [{ version: 1, semver: "1.0.0", findings: [{ code: "INSTRUCTION_PATTERN", location: "inputSchema/properties/q/description", detail: "\"ignore previous\"" }] }],
};

describe("the state chips", () => {
  it("say who can use it, and Not reviewed", () => {
    const html = text(render(<ProviderToolChips tool={base} />));
    expect(html).toContain("Anyone with the link");
    expect(html).toContain("Not reviewed");
  });
});

describe("the publish gate", () => {
  it("lists every check, what to fix and where, and the safety screen's findings", () => {
    const html = render(<GateChecklist gate={failing} tool={base} onStep={() => undefined} />);
    const words = text(html);
    expect(words).toContain("1 of 2 checks to fix before others can use it");
    expect(words).toContain("The test passed : done");
    expect(words).toContain("A payout wallet is set : not yet");
    expect(html).toContain('href="/provider/setup?step=wallet"');
    expect(words).toContain("Input q, description:");
    expect(words).toContain("reads like an instruction to a model");
  });
});

describe("versions", () => {
  it("show the one agents get, and the changelog", () => {
    const words = text(render(<VersionHistory tool={base} />));
    expect(words).toContain("v1.0.0");
    expect(words).toContain("Agents get this one");
    expect(words).toContain("First version");
  });
});

describe("step 1 on a saved tool", () => {
  it("previews the name as a model sees it", () => {
    const words = text(render(<NameStep tool={base} onContinue={() => undefined} />));
    expect(words).toContain("acme__search_posts");
    expect(words).toContain("mcp__acme__acme__search_posts");
    expect(words).toContain("29 of 64 characters");
  });
});

describe("step 4", () => {
  it("starts at where it stands, and says when a check still fails", () => {
    expect(text(render(<ShareStep tool={{ ...base, visibility: "PRIVATE" }} gate={failing} onStep={() => undefined} />))).toContain("Only my team (now)");
    const words = text(render(<ShareStep tool={base} gate={failing} onStep={() => undefined} />));
    expect(words).toContain("Anyone with the link (now)");
    expect(words).toContain("Some checks are not met yet.");
  });

  it("shows the reviewer's note on a rejected tool, with a way to fix it", () => {
    const tool = { ...base, review: { ...base.review, status: "REJECTED" as const, state: "REJECTED" as const, note: "Remove the api_key input." } };
    const words = text(render(<ShareStep tool={tool} gate={{ ...failing, passed: true }} onStep={() => undefined} />));
    expect(words).toContain("Changes requested");
    expect(words).toContain("Remove the api_key input.");
    expect(words).toContain("Resubmit for review");
  });
});
