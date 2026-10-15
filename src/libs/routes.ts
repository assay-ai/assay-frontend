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
  operatorCase: (proposalId: string) => withQuery("/operator/cases/view", { id: proposalId }),
  providerCase: (proposalId: string) => withQuery("/provider/cases/view", { id: proposalId }),
  dispute: (disputeId: string) => withQuery("/provider/disputes/view", { id: disputeId }),
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
