/**
 * Whether the buyer can pay for this tool at all.
 *
 * **A tool the buyer cannot reach is marked, never hidden.** Hiding it makes
 * the platform look like it lacks the tool, which is a much worse thing to
 * believe than "I need to fund another chain" — and the fix for the second one
 * is a link.
 *
 * Both `unknown` arms are deliberate and neither is a stub: absence of
 * information is not evidence of unreachability, and a caveat that appears on
 * every row is a caveat nobody reads.
 *
 * **Nothing populates the tool's chains today.** `GET /catalogue/tools` has no
 * `settlementChains` field — the backend publishes `assay/settlementChains` on
 * the MCP `tools/list` surface, which is a different surface with a different
 * consumer. So every row is `unknown` on this deployment and the caveat is
 * never drawn. That is the honest state of it, and it is recorded rather than
 * dressed up: the seam is one field on the backend's `CatalogueToolDto`.
 */
export type SettlementReach =
  | { readonly kind: "unknown" }
  | { readonly kind: "reachable" }
  | { readonly kind: "unreachable"; readonly toolChains: readonly string[] };

export function settlementReach(
  toolChains: readonly string[] | undefined,
  buyerChains: readonly string[],
): SettlementReach {
  /*
    `.length === 0`, not `!toolChains` — an array is always truthy, and that
    exact fold shipped in `providers-view.tsx:112` and threw inside decimal.js.
    Here it would silently mark every tool reachable instead.
  */
  if (toolChains === undefined || toolChains.length === 0) return { kind: "unknown" };
  if (buyerChains.length === 0) return { kind: "unknown" };
  const reachable = toolChains.some((chain) => buyerChains.includes(chain));
  return reachable ? { kind: "reachable" } : { kind: "unreachable", toolChains };
}
