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
  operatorCase: (proposalId: string) => withQuery("/operator/cases/view", { id: proposalId }),
  providerCase: (proposalId: string) => withQuery("/provider/cases/view", { id: proposalId }),
  dispute: (disputeId: string) => withQuery("/provider/disputes/view", { id: disputeId }),
  toolRequest: (requestId: string) => withQuery("/provider/tool-requests/view", { id: requestId }),
  /** A binding screen: `sub` is the path below the binding, e.g. "configuration/pricing". */
  binding: (bindingId: string, sub?: string) =>
    withQuery(under("/provider/bindings/view", sub), { binding: bindingId }),
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
