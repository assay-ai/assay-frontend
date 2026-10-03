/**
 * ⚠️ THIS IS NOT LIVE DATA. ⚠️
 *
 * The catalogue screen ("Catalogue and demand") is the only public provider
 * screen with **no backing endpoint at all**. Every row below is transcribed verbatim
 * from the design canvas — the seven rows R0–R6 of the catalogue frame — and is
 * therefore fiction. Nothing on `/catalogue` reflects the running system.
 *
 * Why there is no endpoint (checked against the API's OpenAPI document on
 * 2026-08-21, all 62 paths):
 *
 * - There is **no catalogue controller**. Nothing enumerates tools. The closest
 *   thing to a tool identity anywhere in the API is `toolId`, a bare UUID with
 *   no name, no description and no cross-organization aggregate.
 * - Every non-trivial path is **organization-scoped** (`/providers/me/*`,
 *   `/tool-calls`, `/verdicts`, `/receipts`) and requires a bearer token. The catalogue screen
 *   is public and pre-registration: the reader has no session by definition, so
 *   even a scoped stand-in (the trick `explore.service.ts` uses on the buyer
 *   side — discovering providers from the caller's own `/tool-calls` feed) is
 *   unavailable here.
 * - The only unauthenticated paths are `/health`, `/diagnostics/errors/{domain}`,
 *   `/demo/ping` and the `_examples` `/posts` scaffold.
 *
 * What would be needed to make this screen real — one endpoint:
 *
 *   GET /api/v1/catalogue   (public, unauthenticated, no org scope)
 *   → [{ toolName, paidCalls30d, freeCalls30d, bindingCount,
 *        priceRange: { min: Money, max: Money } | null,
 *        observedFailRange: { min: number, max: number } | null,
 *        firstPartyShare: number | null }]
 *
 * plus, upstream of it, a tool *name* on `toolId`. The row for a tool with demand
 * and no binding (`transcribe_audio` here) is the whole point of the screen, so
 * the endpoint must enumerate tools that have a schema and **zero** bindings,
 * which no current table join can produce.
 *
 * Do not "wire this up" by pointing it at a provider-scoped endpoint. Delete
 * this file when the endpoint above exists.
 *
 * Money note: the design prints price ranges and rates as pre-formatted display
 * strings, and there is no `Money` object anywhere in the chain, so `formatMoney`
 * has nothing to format. These strings are copy, not amounts.
 */

export interface CatalogueDemandRow {
  /** Stable row key — the tool name, because no tool id exists. */
  id: string;
  tool: string;
  paidCalls30d: string;
  freeCalls30d: string;
  bindings: string;
  priceRange: string;
  observedFail: string;
  firstParty: string;
}

/** Verbatim from the design's catalogue rows R0–R6. Fiction. */
export const CATALOGUE_DEMAND_FIXTURE: CatalogueDemandRow[] = [
  {
    id: "scrape_url",
    tool: "scrape_url",
    paidCalls30d: "4.42M",
    freeCalls30d: "1.10M",
    bindings: "6",
    priceRange: "$0.0020 – $0.0035",
    observedFail: "2.3% – 3.1%",
    firstParty: "0%",
  },
  {
    id: "search_web",
    tool: "search_web",
    paidCalls30d: "2.18M",
    freeCalls30d: "0.94M",
    bindings: "11",
    priceRange: "$0.0080 – $0.0120",
    observedFail: "1.9% – 8.4%",
    firstParty: "0%",
  },
  {
    id: "get_token_price",
    tool: "get_token_price",
    paidCalls30d: "1.86M",
    freeCalls30d: "0.42M",
    bindings: "4",
    priceRange: "$0.0008 – $0.0015",
    observedFail: "0.6% – 1.4%",
    firstParty: "12%",
  },
  {
    id: "query_blockchain",
    tool: "query_blockchain",
    paidCalls30d: "0.94M",
    freeCalls30d: "0.11M",
    bindings: "3",
    priceRange: "$0.0015 – $0.0025",
    observedFail: "0.3% – 0.9%",
    firstParty: "0%",
  },
  {
    id: "ais_lookup",
    tool: "ais_lookup",
    paidCalls30d: "0.21M",
    freeCalls30d: "0.04M",
    bindings: "1",
    priceRange: "$0.0200",
    observedFail: "2.1%",
    firstParty: "0%",
  },
  {
    id: "deep_research",
    tool: "deep_research",
    paidCalls30d: "0.004M",
    freeCalls30d: "0",
    bindings: "2",
    priceRange: "$2.00 – $2.50",
    observedFail: "2.6% – 3.4%",
    firstParty: "0%",
  },
  {
    id: "transcribe_audio",
    tool: "transcribe_audio",
    paidCalls30d: "—",
    freeCalls30d: "—",
    bindings: "0",
    priceRange: "no provider serves this yet",
    observedFail: "—",
    firstParty: "—",
  },
];
