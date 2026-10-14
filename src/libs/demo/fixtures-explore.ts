import type { CursorPage } from "@/interfaces";
import type {
  CatalogueChainStake,
  CatalogueMoney,
  CatalogueProvider,
  CatalogueProviderDetail,
  CatalogueProviderTool,
  CatalogueQuality,
  CatalogueTool,
} from "@/services/catalogue.service";
import type {
  ProviderVerification,
  ProviderVerificationCheck,
  ProviderVerificationResponse,
} from "@/services/explore.service";
import type { CatalogueTool as ToolCatalogueEntry, ToolTier } from "@/services/tools.service";

import { DEMO_ASSET, DEMO_BUYER_ACCOUNT, DEMO_CHAIN_ID, minutesAgo, money } from "./fixtures";
import type { DemoFixture } from "./fixtures";

/**
 * DEMO ONLY — see `demo-api.ts` for the rules. **The marketplace surface.**
 *
 * What a visitor is shown when they open `/explore/providers`,
 * `/explore/providers/view?id=`, `/explore/tools` and `/connect` on a deployment
 * whose catalogue tables are empty: a market with depth, priced in a single
 * settlement asset on Robinhood Chain testnet (`eip155:46630`).
 *
 * ## Everything here is derived, nothing is typed twice
 *
 * Two tables are written by hand — {@link PROVIDERS} and {@link TOOLS} — and
 * every figure a screen draws is computed from them. A tool's `providerCount`
 * is the length of its offer list; a provider's `toolIds` is the set of tools
 * that name them; `fromPrice` is the cheapest of the offers actually listed and
 * the quote is the dearest. So a reader who adds the cards up cannot catch us,
 * and an edit to one price cannot leave a stale total behind somewhere else.
 *
 * The same rule covers identity: `/explore/providers/view?id=` answers for exactly
 * the ids the list shows, by looking the id up out of the path. An id that is
 * **not** ours returns `undefined`, which the demo layer reads as "leave the
 * real outcome alone" — so a genuine 404 still reaches the screen and still
 * says "No provider under that id" rather than inventing a provider for any
 * string somebody types into the URL bar.
 *
 * ## Absent stays absent
 *
 * `use-catalogue.ts` and `format.ts` are emphatic that three fields mean *we do
 * not know* rather than *none*, and the stage set does not quietly resolve them:
 *
 *  - **Quanta Signals has `quality: null`** — registered, staked, never
 *    measured. The card reads "not measured", which is what a young provider
 *    honestly looks like.
 *  - **Verdant Atlas has an EMPTY `stake` list** — a chain nobody could read,
 *    drawn as "—". Not `$0.00`, which would be a much stronger claim.
 *  - **`transcribe_audio` has no binding at all** — zero providers, no price,
 *    `routable: false`. It is the row the public catalogue screen is built
 *    around: demand with no supply is the most interesting thing on a market.
 *
 * ## Two things this file deliberately does not fabricate
 *
 *  - **p95 latency.** No field on this surface carries it (`providers-view.tsx`
 *    says so in its own header, and `/spend` prints a hard-coded dash), so
 *    there is nowhere to put one that a screen would read.
 *  - **The buyer's own traffic.** `yourCalls`, "your spend" and "not charged"
 *    are folded from `GET /tool-calls`, which is the buyer surface's fixture to
 *    own, not this one's. Those columns read zero here, which is exactly right
 *    for an account that has not called anything yet.
 */

/* -------------------------------------------------------------------------- */
/* Money, quality and the derivations over them                               */
/* -------------------------------------------------------------------------- */

/*
  **Nothing below reads an imported constant at module-evaluation time**, and
  the tables further down therefore hold plain strings rather than `Money`.

  `fixtures.ts` imports this file and this file imports `fixtures.ts` back for
  `money()`, `DEMO_ASSET` and `DEMO_CHAIN_ID` — a cycle, and one that resolves
  in the wrong order: this module is a dependency of that one, so it is
  evaluated FIRST and `DEMO_ASSET` is still in its temporal dead zone while
  these lines run. A `const` built eagerly out of it throws
  "Cannot access 'DEMO_ASSET' before initialization" at import, which takes out
  the whole client bundle rather than one screen. Function declarations are
  hoisted and safe; the rule is simply that every one of them is called from
  inside a fixture's `body()`, long after both modules have finished loading.
*/

/**
 * A price on the wire: minor units, a scale, and the CAIP-19 asset it is
 * denominated in. `money()` does the minor-unit conversion; the `currency`
 * label it also returns is dropped, because `Money` on this API carries an
 * `asset` and never a currency code.
 */
function usd(major: string): CatalogueMoney {
  const { amount, decimals } = money(major);
  return { amount, asset: DEMO_ASSET, decimals };
}

/** Bonded stake on the one chain this demo settles on. */
function bonded(major: string): CatalogueChainStake {
  return { chainId: DEMO_CHAIN_ID, ...usd(major) };
}

/** Compared as minor units through BigInt — money never becomes a JS number. */
function cheapest(prices: readonly CatalogueMoney[]): CatalogueMoney | null {
  return prices.reduce<CatalogueMoney | null>(
    (best, price) => (best === null || BigInt(price.amount) < BigInt(best.amount) ? price : best),
    null,
  );
}

/**
 * The **dearest** offer, which is what a call is held for: the router quotes
 * the priciest eligible binding so the hold still covers whichever provider a
 * failover lands on. See `CatalogueTool.price`.
 */
function dearest(prices: readonly CatalogueMoney[]): CatalogueMoney | null {
  return prices.reduce<CatalogueMoney | null>(
    (worst, price) => (worst === null || BigInt(price.amount) > BigInt(worst.amount) ? price : worst),
    null,
  );
}

/**
 * The rate is divided, never typed: 100% of four calls and 95% of sixteen
 * thousand are different claims, and a hand-written rate that disagrees with
 * its own denominator would be the one figure on the card nobody can check.
 */
function measured(calls: number, failed: number): CatalogueQuality {
  return { rate: (calls - failed) / calls, measuredCalls: calls, failedCalls: failed };
}

/** Days, as the ISO strings `verifiedAt` and `lastUsedAt` are sorted on. */
function daysAgo(days: number): string {
  return minutesAgo(days * 24 * 60);
}

/* -------------------------------------------------------------------------- */
/* The market: eight providers                                                */
/* -------------------------------------------------------------------------- */

interface DemoProvider {
  /** A uuid, because `providers.id` is a uuid column and every route takes it. */
  readonly providerId: string;
  readonly legalName: string;
  /** Identity checked — never a statement about the quality of their answers. */
  readonly verified: boolean;
  readonly verifiedDaysAgo: number | null;
  readonly tier: "NEW" | "ESTABLISHED" | "TRUSTED";
  /**
   * Bonded stake in major units, one entry per chain — and **an empty list
   * means unreadable**, never nothing at stake. Strings, not `Money`: see the
   * note above `usd()` on why nothing here may be built eagerly.
   */
  readonly stake: readonly string[];
  /** Null until a window has closed. Rendered "not measured", never as zero. */
  readonly quality: CatalogueQuality | null;
  /** Shown only inside the identity checks, where an address belongs. */
  readonly payoutAddress: string;
  readonly domain: string;
}

const PROVIDERS: readonly DemoProvider[] = [
  {
    providerId: "9c1d4f60-3a77-4c18-9b02-6e5a1f2d8b41",
    legalName: "Helios Data Labs",
    verified: true,
    verifiedDaysAgo: 62,
    tier: "TRUSTED",
    stake: ["4200.00"],
    quality: measured(18_420, 212),
    payoutAddress: "0xA13f7C2e9B4d05F16c8A3e7D9014B25fE6c3A870",
    domain: "heliosdata.example",
  },
  {
    providerId: "3f8a2b71-5c04-4d9e-8a16-7b2c9e0d4a53",
    legalName: "Meridian Index",
    verified: true,
    verifiedDaysAgo: 48,
    tier: "TRUSTED",
    stake: ["3150.00"],
    quality: measured(12_880, 205),
    payoutAddress: "0xC72b1E845aD9370F2c6B48e1D905A73fC81e44B6",
    domain: "meridianindex.example",
  },
  {
    providerId: "b7e04c25-9d13-4a6f-bc80-1e5f3a7d9c62",
    legalName: "Northwind Geo",
    verified: true,
    verifiedDaysAgo: 31,
    tier: "ESTABLISHED",
    stake: ["1800.00"],
    quality: measured(7_640, 126),
    payoutAddress: "0x4E9d02A7b165C83fD70e5142aB93c6F08D1a7e35",
    domain: "northwindgeo.example",
  },
  {
    providerId: "5a2c9e18-7f46-4b03-9d51-8c6e2a4f7b09",
    legalName: "Tidewater Markets",
    verified: true,
    verifiedDaysAgo: 19,
    tier: "ESTABLISHED",
    stake: ["2450.00"],
    quality: measured(9_310, 331),
    payoutAddress: "0x8B05fE7a3C19d4062Ba7e18F35c90D6427bA1c9E",
    domain: "tidewatermarkets.example",
  },
  {
    providerId: "e41b7d93-2a58-4f60-b7c9-3d80f5a1e6c4",
    legalName: "Cobalt Street Data",
    verified: false,
    verifiedDaysAgo: null,
    tier: "ESTABLISHED",
    stake: ["950.00"],
    quality: measured(4_120, 96),
    payoutAddress: "0x2fD6a05C7e394B18cA0f7D2653e9017bB48cF3a1",
    domain: "cobaltstreet.data",
  },
  {
    /* Registered and staked this week. Nothing has closed a window, so quality
       is null and the card says "not measured" instead of inventing 100%. */
    providerId: "17d6c0a4-8b39-4e52-a1f7-59c2b8e3d07f",
    legalName: "Quanta Signals",
    verified: false,
    verifiedDaysAgo: null,
    tier: "NEW",
    stake: ["500.00"],
    quality: null,
    payoutAddress: "0x6c31B9e0d47A5F82301eC7b46d8905fA2e13C07d",
    domain: "quantasignals.ai",
  },
  {
    /* The stake source could not read this provider's account. An EMPTY list —
       the card draws "—", which is "we could not say", not "nothing staked". */
    providerId: "c9f35a82-6014-4d7b-8e93-2a1c7f06b5d8",
    legalName: "Verdant Atlas",
    verified: true,
    verifiedDaysAgo: 8,
    tier: "ESTABLISHED",
    stake: [],
    quality: measured(5_205, 88),
    payoutAddress: "0xF08a4B21c9e7D5360a1B8fE72C094d3671eA5b82",
    domain: "verdantatlas.org",
  },
  {
    providerId: "48e1b60c-d573-4a92-bf08-6c3d95e12a7b",
    legalName: "Lattice Retrieval",
    verified: false,
    verifiedDaysAgo: null,
    tier: "NEW",
    stake: ["600.00"],
    quality: measured(1_240, 57),
    payoutAddress: "0x9A7c08E3b14D62f50Ce81a97D4306bB25f0e7C43",
    domain: "latticeretrieval.example",
  },
];

const PROVIDER_BY_ID = new Map(PROVIDERS.map((provider) => [provider.providerId, provider]));

/* -------------------------------------------------------------------------- */
/* The market: eleven tools, and who offers each at what price                */
/* -------------------------------------------------------------------------- */

interface DemoOffer {
  readonly providerId: string;
  /** Major units, as a person writes them. Converted once, by `usd()`. */
  readonly price: string;
}

interface DemoTool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tier: ToolTier;
  /** `PricingMode` on the binding this row is folded from. Null when nothing is listed. */
  readonly pricingMode: "PAID" | "FREEMIUM" | "FREE" | null;
  readonly offers: readonly DemoOffer[];
  /** Set only where `offers` is empty — the router's own words for why. */
  readonly unroutableReason?: string;
}

/**
 * The six tools with uuids from the dev catalogue seed carry their **real** ids
 * and names, so that a receipt or a log line
 * from a real call still joins to the row a visitor is looking at. The rest are
 * demo-only ids for tools this deployment has never seeded.
 */
const TOOLS: readonly DemoTool[] = [
  {
    id: "06399979-f8b8-4c9e-a9b1-bd2a5924d442",
    name: "get_weather",
    description:
      "Current temperature at a latitude/longitude, from a meteorological forecast model. Use for present conditions at a known point, not for forecasts and not for place names.",
    tier: "VERIFIED",
    pricingMode: "PAID",
    offers: [
      { providerId: "9c1d4f60-3a77-4c18-9b02-6e5a1f2d8b41", price: "0.0020" },
      { providerId: "b7e04c25-9d13-4a6f-bc80-1e5f3a7d9c62", price: "0.0018" },
      { providerId: "17d6c0a4-8b39-4e52-a1f7-59c2b8e3d07f", price: "0.0015" },
    ],
  },
  {
    id: "ad39dccc-aff2-54c1-b383-62e0ff392570",
    name: "geocode_place",
    description:
      "Resolve a place name to coordinates. Returns the best matches, each with latitude, longitude and country. Not a reverse geocoder and not an address validator.",
    tier: "VERIFIED",
    pricingMode: "PAID",
    offers: [
      { providerId: "b7e04c25-9d13-4a6f-bc80-1e5f3a7d9c62", price: "0.0012" },
      { providerId: "9c1d4f60-3a77-4c18-9b02-6e5a1f2d8b41", price: "0.0016" },
    ],
  },
  {
    id: "a4b9882a-9bc1-4d64-807a-27c0b93daf0a",
    name: "get_usd_eur_rate",
    description:
      "The latest USD to EUR reference exchange rate published by the European Central Bank, with the date it was published for. Not a tradeable quote, and not intraday.",
    tier: "UNVERIFIED",
    pricingMode: "PAID",
    offers: [
      { providerId: "3f8a2b71-5c04-4d9e-8a16-7b2c9e0d4a53", price: "0.0008" },
      { providerId: "5a2c9e18-7f46-4b03-9d51-8c6e2a4f7b09", price: "0.0010" },
    ],
  },
  {
    id: "d0f8062b-79ab-5517-b1c8-39481c885e7a",
    name: "get_token_market",
    description:
      "Current USD market data for one or more crypto assets by id — price, 24h change, market capitalisation and the timestamp the figures were read at.",
    tier: "VERIFIED",
    pricingMode: "PAID",
    offers: [
      { providerId: "3f8a2b71-5c04-4d9e-8a16-7b2c9e0d4a53", price: "0.0025" },
      { providerId: "5a2c9e18-7f46-4b03-9d51-8c6e2a4f7b09", price: "0.0030" },
      { providerId: "17d6c0a4-8b39-4e52-a1f7-59c2b8e3d07f", price: "0.0022" },
    ],
  },
  {
    id: "abae704e-0a56-5674-9074-6c7bfc25fad1",
    name: "extract_page_text",
    description:
      "Fetch a public web page and return its main text with the navigation and boilerplate removed, plus the title and the canonical URL it resolved to.",
    tier: "VERIFIED",
    pricingMode: "PAID",
    offers: [
      { providerId: "e41b7d93-2a58-4f60-b7c9-3d80f5a1e6c4", price: "0.0035" },
      { providerId: "48e1b60c-d573-4a92-bf08-6c3d95e12a7b", price: "0.0028" },
      { providerId: "c9f35a82-6014-4d7b-8e93-2a1c7f06b5d8", price: "0.0040" },
    ],
  },
  {
    id: "8fa77325-86d3-5e4a-8c6f-6ec85ccf0b33",
    name: "search_wikipedia",
    description:
      "Search English Wikipedia and return the best-matching articles with a short extract and the canonical URL of each.",
    tier: "VERIFIED",
    /* The one freemium row: a daily free allowance, then a price per call. */
    pricingMode: "FREEMIUM",
    offers: [
      { providerId: "c9f35a82-6014-4d7b-8e93-2a1c7f06b5d8", price: "0.0009" },
      { providerId: "48e1b60c-d573-4a92-bf08-6c3d95e12a7b", price: "0.0007" },
    ],
  },
  {
    id: "2b7f9c41-0e63-4d8a-9f52-7a1c4e6b03d9",
    name: "search_web",
    description:
      "General web search. Returns ranked results with a title, a URL and a snippet for each, deduplicated across domains.",
    tier: "VERIFIED",
    pricingMode: "PAID",
    offers: [
      { providerId: "e41b7d93-2a58-4f60-b7c9-3d80f5a1e6c4", price: "0.0080" },
      { providerId: "48e1b60c-d573-4a92-bf08-6c3d95e12a7b", price: "0.0095" },
      { providerId: "c9f35a82-6014-4d7b-8e93-2a1c7f06b5d8", price: "0.0120" },
      { providerId: "9c1d4f60-3a77-4c18-9b02-6e5a1f2d8b41", price: "0.0110" },
    ],
  },
  {
    id: "6d93a05e-4c81-4b27-a0e6-5f92b7c18d34",
    name: "scrape_url",
    description:
      "Render a URL and return its content as markdown, with the images and links kept. Handles client-rendered pages that a plain fetch returns empty.",
    tier: "VERIFIED",
    pricingMode: "PAID",
    offers: [
      { providerId: "e41b7d93-2a58-4f60-b7c9-3d80f5a1e6c4", price: "0.0020" },
      { providerId: "48e1b60c-d573-4a92-bf08-6c3d95e12a7b", price: "0.0026" },
    ],
  },
  {
    id: "f0a52c37-91b6-4e08-bd41-3c7e6a95f218",
    name: "summarize_document",
    description:
      "Summarise a document supplied as text or as a URL, at a requested length, with the passages each claim was drawn from.",
    tier: "VERIFIED",
    pricingMode: "PAID",
    offers: [
      { providerId: "3f8a2b71-5c04-4d9e-8a16-7b2c9e0d4a53", price: "0.0450" },
      { providerId: "17d6c0a4-8b39-4e52-a1f7-59c2b8e3d07f", price: "0.0380" },
    ],
  },
  {
    id: "84c1e70b-5a29-4f36-9e8d-2b40c6f7a915",
    name: "deep_research",
    description:
      "A multi-step research run over the open web. Returns a written answer with every source it read, and the queries it ran to find them.",
    tier: "GUARANTEED",
    pricingMode: "PAID",
    offers: [
      { providerId: "9c1d4f60-3a77-4c18-9b02-6e5a1f2d8b41", price: "1.2000" },
      { providerId: "3f8a2b71-5c04-4d9e-8a16-7b2c9e0d4a53", price: "2.0000" },
    ],
  },
  {
    /* Demand, and no supply. The schema exists; nobody has published a binding
       against it, so there is no price to quote and nothing to route to. This
       row is the point of the market screen, not an oversight. */
    id: "7e26d3f9-1c84-4a50-b6f3-9d017c48e2ab",
    name: "transcribe_audio",
    description:
      "Transcribe an audio file to text with per-segment timestamps. A schema exists and has demand recorded against it — the first provider to list it takes all of it.",
    tier: "UNVERIFIED",
    pricingMode: null,
    offers: [],
    unroutableReason: "no provider has published an active binding for this tool",
  },
];

/* -------------------------------------------------------------------------- */
/* Derived rows — one source of truth above, every figure computed from it    */
/* -------------------------------------------------------------------------- */

/** Every offer a provider has listed, as `(tool, price)` pairs. */
function offersOf(providerId: string): { tool: DemoTool; price: CatalogueMoney }[] {
  return TOOLS.flatMap((tool) =>
    tool.offers
      .filter((offer) => offer.providerId === providerId)
      .map((offer) => ({ tool, price: usd(offer.price) })),
  );
}

/**
 * `settlementChains` is stated on every row, including the unserved one: this
 * deployment settles on exactly one chain, and that is as true of a tool nobody
 * lists as of one three providers compete over. With the buyer holding a
 * balance on the same chain, `settlementReach` answers `reachable` and no row
 * draws the "Settles elsewhere" caveat.
 */
function toolRow(tool: DemoTool): CatalogueTool {
  const prices = tool.offers.map((offer) => usd(offer.price));
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    tier: tool.tier,
    providerCount: tool.offers.length,
    fromPrice: cheapest(prices),
    price: dearest(prices),
    pricingMode: tool.pricingMode,
    routable: tool.offers.length > 0,
    unroutableReason: tool.unroutableReason ?? null,
    settlementChains: [DEMO_CHAIN_ID],
  };
}

function providerRow(provider: DemoProvider): CatalogueProvider {
  const offers = offersOf(provider.providerId);
  return {
    providerId: provider.providerId,
    legalName: provider.legalName,
    verified: provider.verified,
    verifiedAt: provider.verifiedDaysAgo === null ? null : daysAgo(provider.verifiedDaysAgo),
    tier: provider.tier,
    toolIds: offers.map((offer) => offer.tool.id),
    /** One active binding per tool listed — the demo has no paused bindings. */
    activeBindings: offers.length,
    fromPrice: cheapest(offers.map((offer) => offer.price)),
    stake: provider.stake.map(bonded),
    quality: provider.quality,
  };
}

function providerTools(provider: DemoProvider): CatalogueProviderTool[] {
  return offersOf(provider.providerId).map(({ tool, price }) => ({
    toolId: tool.id,
    name: tool.name,
    pricingMode: tool.pricingMode ?? "PAID",
    price,
  }));
}

function providerDetail(provider: DemoProvider): CatalogueProviderDetail {
  return { ...providerRow(provider), tools: providerTools(provider) };
}

/**
 * The identity answer — and **only** identity. `verified` says somebody checked
 * who this company is; it is not a judgement about their answers, and the
 * unverified providers here are deliberately not the worst ones on quality.
 */
function verification(provider: DemoProvider): ProviderVerification {
  if (!provider.verified) {
    return {
      verified: false,
      verifiedBy: null,
      verifiedAt: null,
      method: null,
      checks: [],
      expiresAt: null,
      evidenceUrl: null,
    };
  }

  const checks: ProviderVerificationCheck[] = [
    { check: "Domain control", result: "PASS", note: `DNS TXT record on ${provider.domain}` },
    { check: "Company registration", result: "PASS", note: "registered entity, filing on record" },
    {
      check: "Payout address proof",
      result: "PASS",
      note: `signature from ${provider.payoutAddress}`,
    },
    {
      check: "Data licence",
      result: "NOT_CHECKED",
      note: "outside the identity check — the provider publishes their own terms",
    },
  ];

  return {
    verified: true,
    verifiedBy: "Assay compliance",
    verifiedAt: daysAgo(provider.verifiedDaysAgo ?? 0),
    method: "DOMAIN_CONTROL",
    checks,
    expiresAt: null,
    evidenceUrl: null,
  };
}

/** The last path segment before a known suffix — how a per-id fixture answers. */
function idFromPath(path: string, index: number): string {
  return decodeURIComponent(path.split("/")[index] ?? "");
}

/* -------------------------------------------------------------------------- */
/* /connect — the one credential the first-run screen reads                   */
/* -------------------------------------------------------------------------- */

interface DemoAgent {
  agentId: string;
  label: string;
  agentAccount: string;
}

interface DemoCredential {
  id: string;
  name: string;
  /** The clear-text prefix. The secret itself is shown once, at creation, never here. */
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** A function, not a constant — `DEMO_BUYER_ACCOUNT` is in its TDZ up here. */
function demoAgent(): DemoAgent {
  return {
    agentId: "5b8e1c02-7a34-4d96-8f10-c6e3b92d7f45",
    label: "research-agent",
    agentAccount: DEMO_BUYER_ACCOUNT,
  };
}

function page<T>(items: T[]): CursorPage<T> {
  return { items, pageInfo: { nextCursor: null, hasMore: false } };
}

/* -------------------------------------------------------------------------- */

export const EXPLORE_FIXTURES: readonly DemoFixture[] = [
  /* The market itself. */
  {
    method: "GET",
    match: "/catalogue/providers",
    body: () => ({ providers: PROVIDERS.map(providerRow) }),
  },
  {
    method: "GET",
    match: "/catalogue/tools",
    body: () => ({ tools: TOOLS.map(toolRow) }),
  },
  /*
    Listed after the exact path above, though the anchored pattern could not
    match it: `/catalogue/providers/{id}` requires a segment after the slash.

    `undefined` for an id we do not serve — the demo layer reads that as "leave
    the real outcome alone", so an unknown id keeps its real 404 and the screen
    keeps its "No provider under that id" state instead of us minting a
    provider for whatever somebody pastes into the URL.
  */
  {
    method: "GET",
    match: /^\/catalogue\/providers\/[^/]+$/,
    body: (path) => {
      const provider = PROVIDER_BY_ID.get(idFromPath(path, 3));
      return provider === undefined ? undefined : providerDetail(provider);
    },
  },
  /*
    Identity, which gates the whole of `/explore/providers/view?id=`: the page draws
    its empty state when this call fails, whatever the catalogue says.

    `me` is excluded explicitly. Nothing calls `/providers/me/verification`
    today, but this pattern sits ahead of the provider-console fixtures, and a
    stage set that answers the console's own "who am I" call would be a very
    confusing thing to debug during a demo.
  */
  {
    method: "GET",
    match: /^\/providers\/(?!me(?:\/|$))[^/]+\/verification$/,
    body: (path): ProviderVerificationResponse | undefined => {
      const provider = PROVIDER_BY_ID.get(idFromPath(path, 2));
      if (provider === undefined) return undefined;
      return {
        providerId: provider.providerId,
        legalName: provider.legalName,
        verification: verification(provider),
      };
    },
  },
  /*
    `GET /tools` is the buyer-side name index: `toolId` → the name a person
    recognises, used by every screen that would otherwise print a bare uuid.
    Same eleven tools, minus the market figures, so a name never disagrees with
    the catalogue row it came from.
  */
  {
    method: "GET",
    match: "/tools",
    body: () => ({
      tools: TOOLS.map(
        (tool): ToolCatalogueEntry => ({
          id: tool.id,
          name: tool.name,
          description: tool.description,
          tier: tool.tier,
        }),
      ),
    }),
  },
  /*
    `/connect` needs an agent and one live credential, or its "Confirm it is
    live" row — the only place in the product that answers "did my config
    actually work?" — can only say there is nothing to check.

    These two paths are shared with the buyer surface (`/agents`). The fixture
    table is first-match-wins and the buyer entries are listed ahead of these,
    so if that file grows its own agent, it wins and nothing here changes.
  */
  {
    method: "GET",
    match: "/agents",
    body: () => page([demoAgent()]),
  },
  {
    method: "GET",
    match: /^\/agents\/[^/]+\/credentials$/,
    body: () =>
      page<DemoCredential>([
        {
          id: "9f2a1c74-6b08-4e35-a9d7-21c4f0b6e83a",
          name: "demo-laptop",
          prefix: "x402_pk_7c41",
          lastUsedAt: minutesAgo(3),
          revokedAt: null,
          createdAt: daysAgo(6),
        },
      ]),
  },
];
