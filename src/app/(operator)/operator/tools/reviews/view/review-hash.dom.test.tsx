// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OperatorSessionContext } from "@/features/operator/session-context";
import type { OperatorIdentity } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import type { ReviewDetail } from "@/services/operator-provider-tools.service";

const service = vi.hoisted(() => ({ getProviderToolReview: vi.fn(), decideProviderToolReview: vi.fn(), takedownProviderTool: vi.fn() }));
vi.mock("@/services/operator-provider-tools.service", () => service);
vi.mock("@/hooks/useSearchParam", () => ({ useSearchParam: () => "t1" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/operator/tools/reviews/view" }));

import OperatorReviewPage from "./page";

window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function detail(hash: string): ReviewDetail {
  return {
    tool: {
      id: "t1",
      name: "acme__search_posts",
      localName: "search_posts",
      handle: "acme",
      preview: "",
      category: "social",
      tags: [],
      visibility: "UNLISTED",
      status: "ACTIVE",
      currentSemver: "1.0.0",
      currentVersion: 1,
      hasDraft: false,
      notReviewed: true,
      review: { status: "PENDING", state: "IN_REVIEW", label: "In review", kind: "FIRST", reviewVersion: 1, reviewSemver: "1.0.0", note: null, submittedAt: "2026-10-18T00:00:00.000Z", decidedAt: null, approvedVersion: null, approvedSemver: null },
      replacementToolId: null,
      replacementName: null,
      removedAt: null,
      createdAt: "2026-10-17T00:00:00.000Z",
      updatedAt: "2026-10-18T00:00:00.000Z",
      versions: [],
      draft: null,
      binding: null,
      mcpUrls: { handle: null },
      quality: {} as ReviewDetail["tool"]["quality"],
      earliestSunsetAt: "2027-01-20T00:00:00.000Z",
    },
    kind: "FIRST",
    pending: true,
    contentHash: hash,
    covered: [],
    changes: [],
    checklist: [{ item: "NO_SECRET_INPUTS", automated: "PASS", detail: "", findings: [] }],
    gate: { passed: true, requirements: [], screen: [] },
  };
}

const me: OperatorIdentity = { id: "op-1", subject: "riley@", displayName: "Riley", walletAddress: null, roles: ["ADJL"], authorityLimit: null, status: "ACTIVE" };

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OperatorSessionContext.Provider value={me}>
        <OperatorReviewPage />
      </OperatorSessionContext.Provider>
    </QueryClientProvider>,
  );
  return client;
}

const approveButton = () => screen.getByRole("button", { name: /^Approve/ }) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a review is decided for the content read", () => {
  it("blocks the decision when the content changes, and sends the new hash once it is read", async () => {
    service.getProviderToolReview.mockResolvedValue(detail(HASH_A));
    service.decideProviderToolReview.mockResolvedValue({ toolId: "t1", decision: "APPROVE", kind: "FIRST", approvedVersion: 1 });
    const client = mount();
    fireEvent.click(await screen.findByLabelText("Approve for the catalogue"));
    expect(approveButton().disabled).toBe(false);

    // The provider changed it; the poll brings the new hash.
    service.getProviderToolReview.mockResolvedValue(detail(HASH_B));
    await act(() => client.refetchQueries({ queryKey: ["operator", "review", "t1"] }));
    expect(await screen.findByTestId("review-stale")).toBeTruthy();
    expect(approveButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /read the new content/ }));
    await waitFor(() => expect(screen.queryByTestId("review-stale")).toBeNull());
    expect(approveButton().disabled).toBe(false);
    fireEvent.click(approveButton());
    await waitFor(() => expect(service.decideProviderToolReview).toHaveBeenCalled());
    expect(service.decideProviderToolReview.mock.calls[0]![1]).toMatchObject({ decision: "APPROVE", contentHash: HASH_B });
  });

  it("a TOOL_REVIEW_STALE refusal reloads the review instead of deciding", async () => {
    service.getProviderToolReview.mockResolvedValue(detail(HASH_A));
    service.decideProviderToolReview.mockRejectedValue(new ApiError("TOOL_REVIEW_STALE", "stale", 409, "/operator/reviews/t1", { contentHash: HASH_B }));
    mount();
    fireEvent.click(await screen.findByLabelText("Approve for the catalogue"));
    const reads = service.getProviderToolReview.mock.calls.length;
    service.getProviderToolReview.mockResolvedValue(detail(HASH_B));
    fireEvent.click(approveButton());
    expect(await screen.findByText(/changed what is under review after you opened it/)).toBeTruthy();
    await waitFor(() => expect(service.getProviderToolReview.mock.calls.length).toBeGreaterThan(reads));
    expect(await screen.findByTestId("review-stale")).toBeTruthy();
  });
});
