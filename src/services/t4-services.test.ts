import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  `@/services/api` and `@/services/operator-api` are mocked at the module
  boundary: what is under test is the request each function composes (path,
  query and body), and how a two-person route's 202 is read.
*/
const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const patch = vi.fn();
const del = vi.fn();
const opGet = vi.fn();
const opPost = vi.fn();
const opPostWithStatus = vi.fn();

vi.mock("@/services/api", () => ({
  api: {
    get: (...args: unknown[]) => get(...args) as unknown,
    post: (...args: unknown[]) => post(...args) as unknown,
    put: (...args: unknown[]) => put(...args) as unknown,
    patch: (...args: unknown[]) => patch(...args) as unknown,
    delete: (...args: unknown[]) => del(...args) as unknown,
  },
}));
vi.mock("@/services/operator-api", () => ({
  operatorApi: {
    get: (...args: unknown[]) => opGet(...args) as unknown,
    post: (...args: unknown[]) => opPost(...args) as unknown,
    postWithStatus: (...args: unknown[]) => opPostWithStatus(...args) as unknown,
  },
}));

const tools = await import("@/services/provider-tools.service");
const disputes = await import("@/services/call-disputes.service");
const opTools = await import("@/services/operator-provider-tools.service");
const opDisputes = await import("@/services/operator-call-disputes.service");

beforeEach(() => {
  for (const fn of [get, post, put, patch, del, opGet, opPost, opPostWithStatus]) fn.mockReset();
});

describe("provider tools", () => {
  it("lists with a limit and a cursor", async () => {
    get.mockResolvedValue({ items: [], pageInfo: {} });
    await tools.listProviderTools({ cursor: "c1" });
    expect(get).toHaveBeenCalledWith("/provider/tools", { limit: 50, cursor: "c1" });
  });

  it("creates, saves, publishes, shares and submits on the documented routes", async () => {
    post.mockResolvedValue({});
    const contract = { summary: "s", description: "d", inputSchema: { type: "object" }, outputSchema: { type: "object" } };
    await tools.createProviderTool({ ...contract, name: "search_posts", category: "social" });
    expect(post).toHaveBeenLastCalledWith("/provider/tools", expect.objectContaining({ name: "search_posts", category: "social" }));
    await tools.saveProviderToolDraft("t 1", contract);
    expect(post).toHaveBeenLastCalledWith("/provider/tools/t%201/versions", contract);
    await tools.publishProviderToolVersion("t1", 3);
    expect(post).toHaveBeenLastCalledWith("/provider/tools/t1/versions/3/publish");
    await tools.shareProviderToolUnlisted("t1");
    expect(post).toHaveBeenLastCalledWith("/provider/tools/t1/publish", { visibility: "UNLISTED" });
    await tools.submitProviderToolReview("t1");
    expect(post).toHaveBeenLastCalledWith("/provider/tools/t1/review");
    await tools.withdrawProviderToolReview("t1");
    expect(post).toHaveBeenLastCalledWith("/provider/tools/t1/review/withdraw");
    await tools.deprecateProviderToolMajor("t1", 2, "2027-02-01T00:00:00.000Z");
    expect(post).toHaveBeenLastCalledWith("/provider/tools/t1/versions/2/deprecate", { sunsetAt: "2027-02-01T00:00:00.000Z" });
    await tools.deprecateProviderToolMajor("t1", 2, "2027-02-01T00:00:00.000Z", "std-1");
    expect(post).toHaveBeenLastCalledWith("/provider/tools/t1/versions/2/deprecate", { sunsetAt: "2027-02-01T00:00:00.000Z", replacementToolId: "std-1" });
  });

  it("reads the gate, discards the draft and sets the replacement", async () => {
    get.mockResolvedValue({ passed: false, requirements: [], screen: [] });
    await tools.getProviderToolGate("t1");
    expect(get).toHaveBeenCalledWith("/provider/tools/t1/publish-check");
    del.mockResolvedValue({});
    await tools.discardProviderToolDraft("t1");
    expect(del).toHaveBeenCalledWith("/provider/tools/t1/versions/draft");
    put.mockResolvedValue({});
    await tools.setProviderToolReplacement("t1", null);
    expect(put).toHaveBeenCalledWith("/provider/tools/t1/replacement", { replacementToolId: null });
  });

  it("unpublishes, and tries a curl or an OpenAPI operation", async () => {
    post.mockResolvedValue({});
    await tools.unpublishProviderTool("t 1");
    expect(post).toHaveBeenLastCalledWith("/provider/tools/t%201/unpublish");
    await tools.tryProviderTool({ openapi: "openapi: 3.0.0", operationId: "getPost", headers: { Authorization: "Bearer k" } });
    expect(post).toHaveBeenLastCalledWith("/provider/tools/try", { openapi: "openapi: 3.0.0", operationId: "getPost", headers: { Authorization: "Bearer k" } });
  });

  it("dismisses an invitation by its two ids", async () => {
    post.mockResolvedValue(undefined);
    await tools.dismissPromotionInvitation("std", "src");
    expect(post).toHaveBeenCalledWith("/provider/tools/invitations/std/src/dismiss");
  });
});

describe("call disputes", () => {
  it("files a report on the payment intent", async () => {
    post.mockResolvedValue({});
    await disputes.fileCallDispute({ subjectType: "PAYMENT_INTENT", subjectId: "i1", reason: "WRONG_DATA", note: "x" });
    expect(post).toHaveBeenCalledWith("/call-disputes", { subjectType: "PAYMENT_INTENT", subjectId: "i1", reason: "WRONG_DATA", note: "x" });
  });

  it("joins states with commas and filters by intent", async () => {
    get.mockResolvedValue({ items: [], pageInfo: {} });
    await disputes.listCallDisputes({ state: ["OPEN", "UPHELD"], intentId: "i1" });
    expect(get).toHaveBeenCalledWith("/call-disputes", { limit: 25, state: "OPEN,UPHELD", intentId: "i1" });
  });

  it("reads and answers the provider's side", async () => {
    get.mockResolvedValue({ items: [], pageInfo: {} });
    await disputes.listProviderCallDisputes({ state: ["OPEN"] });
    expect(get).toHaveBeenCalledWith("/providers/me/call-disputes", { limit: 25, state: "OPEN" });
    post.mockResolvedValue({});
    await disputes.respondToCallDispute("d1", "We checked it.");
    expect(post).toHaveBeenCalledWith("/providers/me/call-disputes/d1/respond", { response: "We checked it." });
  });

  it("withdraws", async () => {
    post.mockResolvedValue({});
    await disputes.withdrawCallDispute("d1");
    expect(post).toHaveBeenCalledWith("/call-disputes/d1/withdraw");
  });
});

describe("operator: provider tool review and takedown", () => {
  it("lists the pending queue and sends the decision with the hash read", async () => {
    opGet.mockResolvedValue([]);
    await opTools.listProviderToolReviews();
    expect(opGet).toHaveBeenCalledWith("/operator/reviews", { pending: true });
    opPost.mockResolvedValue({});
    const body = { decision: "APPROVE" as const, contentHash: "a".repeat(64), reasonCode: "APPROVED" as const, tier: "VERIFIED" as const };
    await opTools.decideProviderToolReview("t1", body);
    expect(opPost).toHaveBeenCalledWith("/operator/reviews/t1", body);
  });

  it("takes a tool down, and reads a lifted takedown's 202 as queued", async () => {
    opPost.mockResolvedValue({});
    const body = { reasonCode: "IMPERSONATION", note: "Pretends to be another company." };
    const takedown = { ...body, publicReasonCode: "IMPERSONATION" as const, publicNote: "Contact support to restore it." };
    await opTools.takedownProviderTool("t1", takedown);
    expect(opPost).toHaveBeenCalledWith("/operator/tools/t1/takedown", takedown);
    opPostWithStatus.mockResolvedValue({ status: 202, data: { approvalId: "ap1", status: "PENDING" } });
    const answer = await opTools.revertCutoff("c1", body);
    expect(opPostWithStatus).toHaveBeenCalledWith("/operator/cutoffs/c1/revert", body);
    expect(answer.kind).toBe("queued");
  });

  it("drafts a promotion and invites", async () => {
    opPost.mockResolvedValue({ tool: { id: "s1", name: "search_posts" }, invites: [] });
    await opTools.draftPromotion({ sourceToolId: "t1", name: "search_posts", inviteToolIds: ["t2"] });
    expect(opPost).toHaveBeenCalledWith("/operator/promotions", { sourceToolId: "t1", name: "search_posts", inviteToolIds: ["t2"] });
    await opTools.invitePromotion("s1", ["t3"]);
    expect(opPost).toHaveBeenLastCalledWith("/operator/promotions/s1/invites", { toolIds: ["t3"] });
  });
});

describe("operator: call disputes", () => {
  it("lists open disputes, flagged buyers only on request", async () => {
    opGet.mockResolvedValue({ items: [], pageInfo: {} });
    await opDisputes.listOperatorCallDisputes({ state: ["OPEN"], flaggedOnly: true, order: "ASC", cursor: "c1" });
    expect(opGet).toHaveBeenCalledWith("/operator/call-disputes", { limit: 50, state: "OPEN", flaggedOnly: true, order: "ASC", cursor: "c1" });
  });

  it("returns the decision, or the approval it waits on", async () => {
    opPostWithStatus.mockResolvedValue({ status: 200, data: { id: "d1", state: "UPHELD" } });
    const done = await opDisputes.decideOperatorCallDispute("d1", { decision: "UPHOLD", note: "The answer was empty." });
    expect(opPostWithStatus).toHaveBeenCalledWith("/operator/call-disputes/d1/decide", { decision: "UPHOLD", note: "The answer was empty." });
    expect(done).toEqual({ kind: "done", result: { id: "d1", state: "UPHELD" } });
    opPostWithStatus.mockResolvedValue({ status: 202, data: { approvalId: "ap2", status: "PENDING" } });
    const queued = await opDisputes.decideOperatorCallDispute("d1", { decision: "UPHOLD", note: "The answer was empty." });
    expect(queued.kind).toBe("queued");
  });
});
