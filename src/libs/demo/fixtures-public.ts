import type { CatalogueProvider, CatalogueProviderDetail, CatalogueTool } from "@/services/catalogue.service";
import type {
  PublicNotCharged,
  PublicNotChargedCall,
  PublicProvider,
  PublicProviderDetail,
  PublicTool,
} from "@/services/public-explorer.service";

import { DEMO_NOW_MS } from "./demo-clock";
import { EXPLORE_FIXTURES } from "./fixtures-explore";
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
  };
}

function utcDay(daysAgo: number): string {
  const d = new Date(DEMO_NOW_MS - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function notCharged(): PublicNotCharged {
  const tools = signedIn<{ tools: CatalogueTool[] }>("/catalogue/tools")?.tools ?? [];
  const providers = signedIn<{ providers: CatalogueProvider[] }>("/catalogue/providers")?.providers ?? [];
  const byName = new Map(tools.map((t) => [t.name, t]));
  const providerOf = (toolId: string) =>
    providers.find((p) => p.toolIds.includes(toolId))?.legalName ?? "A listed provider";

  const rows: [string, string, string, PublicNotChargedCall["bucket"], number][] = [
    ["get_weather", "FAILED_CHECK", "The result failed our check, so the buyer got the held amount back.", "FAILED_VERIFICATION", 1],
    ["search_web", "FAILED_CHECK", "The result failed our check, so the buyer got the held amount back.", "FAILED_VERIFICATION", 1],
    ["get_weather", "PROVIDER_ERROR", "The provider returned an error instead of a result, so the call was not charged.", "PROVIDER_OR_PLATFORM_ERROR", 2],
    ["search_web", "FAILED_CHECK", "The result failed our check, so the buyer got the held amount back.", "FAILED_VERIFICATION", 3],
    ["get_weather", "EXPIRED", "The call did not finish in time, so the held amount was released.", "PROVIDER_OR_PLATFORM_ERROR", 4],
    ["get_weather", "FAILED_CHECK", "The result failed our check, so the buyer got the held amount back.", "FAILED_VERIFICATION", 6],
  ];
  const recent: PublicNotChargedCall[] = rows.flatMap(([name, reason, reasonText, bucket, ago]) => {
    const tool = byName.get(name) ?? tools.find((t) => t.routable);
    if (!tool || !tool.price) return [];
    return [
      {
        toolId: tool.id,
        toolName: tool.name,
        providerName: providerOf(tool.id),
        price: tool.price,
        reason,
        reasonText,
        bucket,
        day: utcDay(ago),
      },
    ];
  });
  const asset = recent[0]?.price;
  return {
    windowDays: 30,
    since: `${utcDay(30)}T00:00:00.000Z`,
    until: `${utcDay(0)}T00:00:00.000Z`,
    minBuyers: 5,
    withheldForPrivacy: true,
    totals: {
      callsChecked: 18_420,
      callsNotCharged: 312,
      callsFailedCheck: 241,
      amountNotCharged: asset ? [{ amount: "1874000", asset: asset.asset, decimals: asset.decimals }] : [],
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
