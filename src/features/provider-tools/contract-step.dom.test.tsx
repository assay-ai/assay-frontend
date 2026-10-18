// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";
import type { ProviderTool } from "@/services/provider-tools.service";

const service = vi.hoisted(() => ({
  saveProviderToolDraft: vi.fn(),
  publishProviderToolVersion: vi.fn(),
  discardProviderToolDraft: vi.fn(),
  withdrawProviderToolReview: vi.fn(),
}));
vi.mock("@/services/provider-tools.service", () => service);

import { ContractStep } from "./contract-step";

const version = {
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
};

const tool = {
  id: "t1",
  name: "acme__search_posts",
  localName: "search_posts",
  handle: "acme",
  visibility: "UNLISTED",
  status: "ACTIVE",
  currentSemver: "1.0.0",
  currentVersion: 1,
  hasDraft: false,
  notReviewed: true,
  review: { status: "NONE", state: "NOT_SUBMITTED", label: "", kind: null, reviewVersion: null, reviewSemver: null, note: null, submittedAt: null, decidedAt: null, approvedVersion: null, approvedSemver: null },
  updatedAt: "2026-10-02T00:00:00.000Z",
  versions: [version],
  draft: null,
} as unknown as ProviderTool;

const saved = { ...tool, hasDraft: true, draft: { ...version, version: 2, semver: "1.1.0", status: "DRAFT", isCurrent: false, publishedAt: null, baseSemver: "1.0.0", bump: "MINOR", changes: [], problems: [], screen: [], inReview: false } } as unknown as ProviderTool;

function mount(onStep = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ContractStep tool={tool} onStep={onStep} />
    </QueryClientProvider>,
  );
  return onStep;
}

function editSummary() {
  fireEvent.change(screen.getByLabelText(/^Summary/), { target: { value: "Search public posts by keyword" } });
}

const publishButton = () => screen.getByRole("button", { name: /^Publish v/ });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("step 2: publish", () => {
  it("saves the unsaved form first, then publishes the draft that came back", async () => {
    service.saveProviderToolDraft.mockResolvedValue(saved);
    service.publishProviderToolVersion.mockResolvedValue({ ...tool, currentSemver: "1.1.0" });
    mount();
    editSummary();
    fireEvent.click(publishButton());
    await waitFor(() => expect(service.publishProviderToolVersion).toHaveBeenCalledWith("t1", 2));
    expect(service.saveProviderToolDraft).toHaveBeenCalledWith("t1", expect.objectContaining({ summary: "Search public posts by keyword", baseVersion: 1 }));
    expect(service.saveProviderToolDraft.mock.invocationCallOrder[0]).toBeLessThan(service.publishProviderToolVersion.mock.invocationCallOrder[0]!);
  });

  it("goes to step 3 when the publish checks refuse it", async () => {
    service.saveProviderToolDraft.mockResolvedValue(saved);
    service.publishProviderToolVersion.mockRejectedValue(new ApiError("TOOL_PROVIDER_TOOL_GATE_FAILED", "no", 409, "/", { failed: "STAKE" }));
    const onStep = mount();
    editSummary();
    fireEvent.click(publishButton());
    await waitFor(() => expect(onStep).toHaveBeenCalledWith("connect"));
  });
});
