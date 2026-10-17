import type { CatalogueProvider, CatalogueProviderDetail, CatalogueTool } from "@/services/catalogue.service";
import type {
  PublicNotCharged,
  PublicNotChargedCall,
  PublicProvider,
  PublicProviderDetail,
  PublicTool,
} from "@/services/public-explorer.service";

import { DEMO_NOW_MS } from "./demo-clock";
import { demoCategoryOf, EXPLORE_FIXTURES } from "./fixtures-explore";
import type { DemoFixture } from "./fixtures";

/**
 * DEMO ONLY — the public Explorer (`/catalogue`): `GET /public/catalogue/*`,
 * and `GET /public/not-charged`.
 *
 * Derived from the signed-in catalogue fixtures (`fixtures-explore.ts`) by the
 * same field allowlist the backend's public DTOs apply, so the public page and
 * `/explore` always describe one market.
 */

function signedIn<T>(path: string): T | undefined {
  const fixture = EXPLORE_FIXTURES.find((f) =>
    f.method === "GET" && (f.match instanceof RegExp ? f.match.test(path) : f.match === path),
  );
  return fixture?.body(path, {}) as T | undefined;
}

function publicProvider(row: CatalogueProvider): PublicProvider {
  return {
    providerId: row.providerId,
    name: row.legalName,
    verified: row.verified,
    tier: row.tier,
    toolIds: row.toolIds,
    fromPrice: row.fromPrice,
    stake: row.stake,
    quality: row.quality,
  };
}

function publicTool(row: CatalogueTool): PublicTool {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tier: row.tier,
    providerCount: row.providerCount,
    fromPrice: row.fromPrice,
    price: row.price,
    pricingMode: row.pricingMode,
    routable: row.routable,
    settlementChains: row.routable ? (row.settlementChains ?? null) : null,
    freeCallsPerDay: row.freeCallsPerDay ?? null,
    paidBindings: row.paidBindings ?? 0,
    category: demoCategoryOf(row.name),
  };
}

function utcDay(daysAgo: number): string {
  const d = new Date(DEMO_NOW_MS - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

const REASON_TEXT: Record<string, [string, PublicNotChargedCall["bucket"]]> = {
  FAILED_CHECK: ["The result failed our check, so the buyer got the held amount back.", "FAILED_VERIFICATION"],
  PROVIDER_ERROR: [
    "The provider returned an error instead of a result, so the call was not charged.",
    "PROVIDER_OR_PLATFORM_ERROR",
  ],
  EXPIRED: ["The call did not finish in time, so the held amount was released.", "PROVIDER_OR_PLATFORM_ERROR"],
  NOT_COLLECTED: ["Payment for this call was not collected, so the buyer was not charged.", "PROVIDER_OR_PLATFORM_ERROR"],
};

/**
 * The recent feed: tool, the provider that SERVED the call, reason, days ago.
 * Spread over most paid tools, so a tool page (public or signed in) has its
 * own rows rather than an empty record next to a busy platform-wide one.
 */
const RECENT: readonly [tool: string, provider: string, reason: keyof typeof REASON_TEXT, daysAgo: number][] = [
  ["get_weather", "Northwind Geo", "FAILED_CHECK", 1],
  ["search_web", "Helios Data Labs", "FAILED_CHECK", 1],
  // The demo provider's paid tool: a row of its own, so its public page and the signed-in tool detail are not
  // empty. It fits the backend rules (`PublicNotChargedService`): a day old, and its rows stand for at least
  // five eligible buyers. Its FREE chain-activity has no paid calls, and fx-rates' are under the buyer floor.
  ["market-quote", "Harborlight Data Ltd", "FAILED_CHECK", 1],
  ["get_weather", "Helios Data Labs", "PROVIDER_ERROR", 2],
  ["extract_page_text", "Cobalt Street Data", "FAILED_CHECK", 2],
  ["geocode_place", "Northwind Geo", "FAILED_CHECK", 3],
  ["search_web", "Verdant Atlas", "FAILED_CHECK", 3],
  ["get_usd_eur_rate", "Meridian Index", "PROVIDER_ERROR", 3],
  ["get_token_market", "Tidewater Markets", "FAILED_CHECK", 4],
  ["get_weather", "Quanta Signals", "EXPIRED", 4],
  ["search_wikipedia", "Lattice Retrieval", "FAILED_CHECK", 5],
  ["search_web", "Cobalt Street Data", "NOT_COLLECTED", 5],
  ["scrape_url", "Cobalt Street Data", "FAILED_CHECK", 5],
  ["summarize_document", "Quanta Signals", "FAILED_CHECK", 6],
  ["deep_research", "Helios Data Labs", "EXPIRED", 6],
  ["get_weather", "Northwind Geo", "FAILED_CHECK", 6],
];

/**
 * The not-charged calls that did not fail the check, by reason, as counted.
 * The wire carries them the way the server does: a reason is named only when
 * enough buyers stand behind it, and named counts are rounded down to tens; the
 * rare reasons and every rounding remainder make up the grouped rest.
 */
const OTHER_REASONS: readonly { reason: string; calls: number; named: boolean }[] = [
  { reason: "PROVIDER_ERROR", calls: 34, named: true },
  { reason: "EXPIRED", calls: 27, named: true },
  { reason: "NOT_COLLECTED", calls: 13, named: true },
  { reason: "REQUEST_REJECTED", calls: 7, named: false },
  { reason: "NO_USABLE_RESULT", calls: 5, named: false },
  { reason: "OUT_OF_SCOPE", calls: 3, named: false },
];
const FAILED_CHECK_CALLS = 241;

function notCharged(): PublicNotCharged {
  const tools = signedIn<{ tools: CatalogueTool[] }>("/catalogue/tools")?.tools ?? [];
  const providers = signedIn<{ providers: CatalogueProvider[] }>("/catalogue/providers")?.providers ?? [];
  // By name or by id: the demo provider's own tools have slug ids and display names ("market-quote", "Market quote").
  const byName = new Map(tools.flatMap((t) => [[t.name, t] as const, [t.id, t] as const]));
  const byLegalName = new Map(providers.map((p) => [p.legalName, p]));

  // A call's amount is the price of the provider that served it (the backend's
  // `price`); the held maximum applies only when no provider served it.
  const servedPrice = (providerId: string, toolId: string) =>
    signedIn<CatalogueProviderDetail>(`/catalogue/providers/${providerId}`)?.tools.find((t) => t.toolId === toolId)
      ?.price;

  const recent: PublicNotChargedCall[] = RECENT.flatMap(([name, providerName, reason, ago]) => {
    const tool = byName.get(name);
    const provider = byLegalName.get(providerName);
    if (!tool || !provider || !provider.toolIds.includes(tool.id)) return [];
    const price = servedPrice(provider.providerId, tool.id) ?? tool.price;
    if (!price) return [];
    const [reasonText, bucket] = REASON_TEXT[reason];
    return [{ toolId: tool.id, toolName: tool.name, providerName, price, reason, reasonText, bucket, day: utcDay(ago) }];
  });

  const named = OTHER_REASONS.filter((r) => r.named).map((r) => ({
    reason: r.reason,
    calls: Math.floor(r.calls / 10) * 10,
  }));
  const rest = OTHER_REASONS.reduce((sum, r) => sum + r.calls, 0);
  const asset = recent[0]?.price;
  return {
    windowDays: 30,
    since: `${utcDay(30)}T00:00:00.000Z`,
    until: `${utcDay(0)}T00:00:00.000Z`,
    minBuyers: 5,
    withheldForPrivacy: true,
    totals: {
      callsChecked: 18_420,
      callsNotCharged: FAILED_CHECK_CALLS + rest,
      callsFailedCheck: FAILED_CHECK_CALLS,
      amountNotCharged: asset ? [{ amount: "1874000", asset: asset.asset, decimals: asset.decimals }] : [],
      notChargedByReason: named,
      callsNotChargedOther: rest - named.reduce((sum, r) => sum + r.calls, 0),
    },
    recent,
  };
}

export const PUBLIC_FIXTURES: readonly DemoFixture[] = [
  {
    method: "GET",
    match: "/public/catalogue/tools",
    body: () => ({
      tools: (signedIn<{ tools: CatalogueTool[] }>("/catalogue/tools")?.tools ?? []).map(publicTool),
    }),
  },
  {
    method: "GET",
    match: "/public/catalogue/providers",
    body: () => ({
      providers: (signedIn<{ providers: CatalogueProvider[] }>("/catalogue/providers")?.providers ?? []).map(
        publicProvider,
      ),
    }),
  },
  {
    method: "GET",
    match: /^\/public\/catalogue\/providers\/[^/]+$/,
    body: (path): PublicProviderDetail | undefined => {
      const id = path.split("/").pop() ?? "";
      const detail = signedIn<CatalogueProviderDetail>(`/catalogue/providers/${id}`);
      if (!detail) return undefined;
      return {
        ...publicProvider(detail),
        tools: detail.tools.map((tool) => ({
          toolId: tool.toolId,
          name: tool.name,
          pricingMode: tool.pricingMode,
          price: tool.price,
          freeCallsPerAgentPerDay: tool.freeCallsPerAgentPerDay ?? null,
        })),
      };
    },
  },
  {
    method: "GET",
    match: "/public/not-charged",
    body: () => notCharged(),
  },
];
