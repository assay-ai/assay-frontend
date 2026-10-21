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
 * **`null` is "not known", never "settles nowhere".** `GET /catalogue/tools`
 * sends `settlementChains: null` when nothing is routable (the backend's
 * `CatalogueToolDto` says so in as many words), and an older API omits the
 * field. Both are `unknown` here, exactly like an empty list.
 */
export type SettlementReach =
  | { readonly kind: "unknown" }
  | { readonly kind: "reachable" }
  | { readonly kind: "unreachable"; readonly toolChains: readonly string[] };

export function settlementReach(
  toolChains: readonly string[] | null | undefined,
  buyerChains: readonly string[],
): SettlementReach {
  /*
    `!toolChains` covers `null` (the backend's "not known") and `undefined`;
    `.length === 0` is still needed because an array is always truthy, and
    that exact fold shipped in `providers-view.tsx:112` and threw inside
    decimal.js. Here it would silently mark every tool reachable instead.
  */
  if (!toolChains || toolChains.length === 0) return { kind: "unknown" };
  if (buyerChains.length === 0) return { kind: "unknown" };
  const reachable = toolChains.some((chain) => buyerChains.includes(chain));
  return reachable ? { kind: "reachable" } : { kind: "unreachable", toolChains };
}
