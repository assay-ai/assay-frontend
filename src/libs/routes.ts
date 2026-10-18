/**
 * Every app URL that names a record.
 *
 * The app is a static export, so a route cannot have a dynamic segment whose
 * values are only known at run time (`/receipts/[intentId]` would need every
 * intent id at build time). The record id rides in the query string instead,
 * on a fixed path, and this module is the one place that knows the shape —
 * build links with it, never by hand.
 */

function withQuery(path: string, params: Record<string, string>): string {
  return `${path}?${new URLSearchParams(params).toString()}`;
}

function under(base: string, sub?: string): string {
  return sub ? `${base}/${sub}` : base;
}

export const routes = {
  receipt: (intentId: string) => withQuery("/receipts/view", { id: intentId }),
  approval: (approvalId: string) => withQuery("/approvals/view", { id: approvalId }),
  exploreProvider: (providerId: string) => withQuery("/explore/providers/view", { id: providerId }),
  /** The signed-in tool list, opened at one tool. */
  exploreTool: (toolId: string) => withQuery("/explore", { tool: toolId }),
  /** The public (signed-out) tool page. Takes a tool id, or a tool name for old links. */
  publicTool: (toolIdOrName: string) => withQuery("/catalogue/view", { tool: toolIdOrName }),
  /** The public (signed-out) provider page. */
  publicProvider: (providerId: string) => withQuery("/catalogue/provider", { id: providerId }),
  /** The Calls list, optionally filtered: status is all | charged | not-charged | free. */
  calls: (filters: { status?: string; tool?: string; agent?: string; reason?: string } = {}) => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => Boolean(v))) as Record<string, string>;
    return Object.keys(params).length > 0 ? withQuery("/spend/calls", params) : "/spend/calls";
  },
  /** Reports: every call this organization reported as a bad result (route keeps "disputes"). */
  disputes: () => "/spend/disputes",
  operatorCase: (proposalId: string) => withQuery("/operator/cases/view", { id: proposalId }),
  operatorTool: (toolId: string, fromRequest?: string) =>
    withQuery("/operator/tools/view", fromRequest ? { id: toolId, from: fromRequest } : { id: toolId }),
  /** A provider's penalty case: the Penalties page with its "Why?" drawer open. */
  providerCase: (proposalId: string) => withQuery("/provider/penalties", { case: proposalId }),
  toolRequest: (requestId: string) => withQuery("/provider/tool-requests/view", { id: requestId }),
  /** A binding screen: `sub` is the path below the binding, e.g. "configuration/pricing". */
  binding: (bindingId: string, sub?: string) =>
    withQuery(under("/provider/bindings/view", sub), { binding: bindingId }),
  /**
   * The listing wizard (1 Tool · 2 Connect & test · 3 Go live). Without a
   * binding it starts at stage 1; with one it resumes that draft.
   */
  bindingWizard: (bindingId?: string, stage?: "tool" | "connect" | "live") => {
    const params: Record<string, string> = {};
    if (bindingId) params.binding = bindingId;
    if (stage) params.stage = stage;
    return Object.keys(params).length ? withQuery("/provider/bindings/new", params) : "/provider/bindings/new";
  },
  /** The penalties page, optionally on a tab ("needs-action" | "disputed" | "closed"). */
  penalties: (tab?: "needs-action" | "disputed" | "closed") =>
    tab ? withQuery("/provider/penalties", { tab }) : "/provider/penalties",
  /** One penalty's "Why?" drawer, by its Assay proposal id or on-chain request id. */
  penalty: (id: string) => withQuery("/provider/penalties", { case: id }),
  /** The Stake page; `sheet` opens the stake or withdraw sheet on arrival. */
  stake: (sheet?: "stake" | "withdraw") => (sheet ? withQuery("/provider/capital", { sheet }) : "/provider/capital"),
  /** "Publish your own API": one provider tool, optionally opened on a step of its flow. */
  providerApi: (toolId: string, step?: "name" | "contract" | "connect" | "share") =>
    withQuery("/provider/apis/view", step ? { id: toolId, step } : { id: toolId }),
  /** A buyer's dispute over a call it reported: its status timeline. */
  callDispute: (disputeId: string) => withQuery("/spend/disputes/view", { id: disputeId }),
  /** A dispute over a call this provider served: reply within the window. */
  providerCallDispute: (disputeId: string) => withQuery("/provider/call-disputes/view", { id: disputeId }),
  /** The operator's review of a provider tool. */
  operatorReview: (toolId: string) => withQuery("/operator/tools/reviews/view", { id: toolId }),
  /** The operator's view of a buyer's dispute over a call. */
  operatorCallDispute: (disputeId: string) => withQuery("/operator/disputes/view", { id: disputeId }),
  /** A verdict screen of a binding: `sub` is e.g. "evidence". */
  verdict: (bindingId: string, verdictId: string, sub?: string) =>
    withQuery(under("/provider/bindings/view/verdicts/view", sub), {
      binding: bindingId,
      verdict: verdictId,
    }),
};

/** The path part of a link built here, for comparing against `usePathname()`. */
export function pathOf(href: string): string {
  return href.split("?")[0]!;
}
