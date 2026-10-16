import {
  DEMO_PENALTY_AMOUNTS,
  DEMO_PENALTY_PROPOSALS,
  DEMO_PENALTY_SUBJECTS,
  demoPenaltyTime,
} from "./demo-penalties";
import {
  DEMO_ASSET,
  DEMO_CHAIN_ID,
  justNow,
  minutesAgo,
  money,
  type DemoFixture,
} from "./fixtures";

/**
 * DEMO ONLY — see `demo-api.ts` for the rules. The provider surface.
 *
 * One provider, on Robinhood Chain testnet (`eip155:46630`, EVM, USDG at 6
 * decimals) and on nothing else. Every chain-scoped field below — the stake,
 * the payout enrolment, the stake authority, every asset id — is keyed on that
 * one chain, and every address on it is a 0x address. There is no second chain
 * on this stage set, because a provider's collateral on one chain is
 * unreachable from another's settlement contract and a screen that summed the
 * two would be showing a figure no single call is backed by.
 *
 * ## Nothing here may be built at module level
 *
 * `fixtures.ts` imports this module, so this module is evaluated **first** and
 * `DEMO_CHAIN_ID`, `DEMO_ASSET` and `money()` are still in their temporal dead
 * zone while it runs. A top-level `const X = \`${DEMO_CHAIN_ID}:…\`` therefore
 * throws `Cannot access 'DEMO_CHAIN_ID' before initialization` at runtime, and
 * `tsc` sees none of it. So the tables below hold plain strings and numbers
 * only, and every wire object — every `money()` call, every CAIP id — is built
 * inside a `body()` closure, which does not run until a request is made.
 *
 * ## The story these rows tell, and it has to add up
 *
 * Harborlight Data Ltd, registered, `ESTABLISHED`, four bindings — three
 * ACTIVE (one PAID, one FREEMIUM, one FREE) and one DRAFT waiting to be
 * published. 600.00 USDG bonded against a 450.00 requirement, so 150.00 of
 * headroom: comfortably clear of the $5.00 per-window penalty ceiling, which
 * is what keeps the dashboard's thin-headroom warning off. Quality is healthy
 * (94.1% PASS over 25,449 calls in 30 days), with one FAIL that cost a single
 * call's 0.405 and one contested slash proposal on the FX binding's last
 * window. Three payout batches, all paid, summing to exactly the month's
 * earned figure.
 *
 * The arithmetic is deliberate and is checked in both directions:
 *
 *  - `requirementTotal` = `max(requirement[].minimum)` = 450.00, and each
 *    `minimum` is `max(floor 50, 1000 × price)` — its own `derivation` string
 *    says so, because three docs still say `sum` and the wire is the authority.
 *  - `headroom` = staked − requirementTotal = 150.00; `shortfall` = 0.
 *  - earnings `totals` = Σ `groups`, and `earned` + `platformFee` = the gross
 *    the call counts imply at each binding's price.
 *  - the three payout amounts sum to the month's `earned`.
 *  - `quality.verdictMix` counts sum to `totalCalls`, which is the same
 *    25,449 the traffic buckets sum to and the same figure `/providers/me`
 *    reports as `callsServed`.
 *
 * ## Two things the mechanism cannot do, so the rows work around them
 *
 * `normalise()` strips the query string, so a fixture cannot see `?bindingId=`
 * or `?from=`. Two consequences, both accepted rather than papered over:
 *
 *  - **The SLA window list is unfiltered.** Every binding-scoped screen gets
 *    the same five windows, newest-OPEN first (the one the dashboard's "Needs
 *    attention" reads). Detail routes do not have this problem — they carry
 *    the id in the path, so they look it up and answer about the right row.
 *  - **Every earnings window answers the same document.** "Today", "last 24h"
 *    and "this month" are one set of figures, sized as a day. Only the
 *    withheld line is read as a month figure anywhere.
 *
 * Detail routes take their id off the path (`idIn`) and echo it back, so any
 * id a list screen links to resolves — a known one answers with its own row,
 * an unknown one with the lead row wearing the requested id.
 *
 * `override: "always"` is set on exactly the routes whose real answer would
 * name a chain, an account or an asset: on an unseeded dev backend those still
 * answer with Solana ids, and a Solana address on a Robinhood Chain demo is
 * the one substitution that has to win over a live response rather than only
 * fill an empty one. Everything else keeps the default and yields to the API.
 *
 * `GET /providers/me/calls/export` is **not** here and cannot be: it goes
 * through `api.raw()` to keep the CSV body unwrapped, which is the one path
 * that never reaches the demo layer.
 */

// ── Identity ────────────────────────────────────────────────────────────────
// Plain strings only. Anything that needs DEMO_CHAIN_ID is a function.

/** The provider's id IS the organization id — there is no separate lookup. */
const PROVIDER_ID = "7c1e4f6a-2b93-4d17-9f0c-5a8e31d6b204";
const LEGAL_NAME = "Harborlight Data Ltd";
const API_HOST = "https://api.harborlight.example";

/** Where payouts land, on `eip155:46630`. An EVM address, never a base58 one. */
const PAYOUT_ADDRESS = "0x4E9a7C1d3B8f5026aD41e7C9b2F08A5d6E3c1B47";

/** The account whose stake account backs this provider. One per chain. */
const STAKE_ADDRESS = "0x9F2c8A1e5D7b30C4f6A8e2B915D3c7E04A6b1F82";

/** The console credential this provider's own actions are stamped with. */
const CONSOLE_CREDENTIAL = "cred_8f3a1d0c";

const EGRESS_IPS = ["203.0.113.21", "203.0.113.22", "198.51.100.9"];

/** CAIP-10 for the payout address. Built lazily — see the module docstring. */
function payoutAccount(): string {
  return `${DEMO_CHAIN_ID}:${PAYOUT_ADDRESS}`;
}

/** CAIP-10 for the stake authority. Built lazily, same reason. */
function stakeAuthority(): string {
  return `${DEMO_CHAIN_ID}:${STAKE_ADDRESS}`;
}

// ── Small helpers ───────────────────────────────────────────────────────────

/** `now + minutes`, for a deadline. Same clock as `minutesAgo`, other way. */
function inMinutes(minutes: number): string {
  return minutesAgo(-minutes);
}

/** The UTC calendar day `days` ago, as `YYYY-MM-DD`. */
function dayUtc(days: number): string {
  return minutesAgo(days * 1440).slice(0, 10);
}

/** Every list on this API is one cursor page; the stage set never has a second. */
function page<T>(items: T[]): { items: T[]; pageInfo: { nextCursor: null; hasMore: false } } {
  return { items, pageInfo: { nextCursor: null, hasMore: false } };
}

/**
 * The id at `segment` of a path, or `null`.
 *
 * `/providers/me/verdicts/abc/evidence` at segment 3 is `abc`. Segments are
 * counted from zero after the leading slash.
 */
function idIn(path: string, segment: number): string | null {
  const parts = path.replace(/^\//, "").split("/");
  return parts[segment] ?? null;
}

// ── Bindings ────────────────────────────────────────────────────────────────

interface DemoBinding {
  id: string;
  toolId: string;
  toolName: string;
  endpoint: string;
  pricingMode: "FREE" | "FREEMIUM" | "PAID";
  priceMajor: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "SUSPENDED";
  version: number;
  publishedVersion: number | null;
  freeQuotaPerAgent: number | null;
  /** Free calls per day across all agents (a count, not money). */
  freeDailyBudget: number | null;
  slaFailureRate: number;
  timeoutMs: number;
  maxRps: number | null;
  maxDailyCalls: number | null;
  /** The upstream path the request mapping appends to `endpoint`. */
  upstreamPath: string;
  /** Output fields the response mapping writes, in document order. */
  outputs: { target: string; selector: string }[];
  /** A new draft's mappings, as the wizard seeds them (field name → same name). */
  seeded?: { inputs: string[] };
  /** What a test call against this listing returns, when not the market quote. */
  sample?: { query: string; rawBody: string; mapped: Record<string, unknown> };
}

const BINDINGS: DemoBinding[] = [
  {
    id: "b1f7c2d4-8e35-4a19-b6c0-2d9f4e71a830",
    toolId: "market-quote",
    toolName: "Market quote",
    endpoint: `${API_HOST}/v1/quote`,
    pricingMode: "PAID",
    priceMajor: "0.45",
    status: "ACTIVE",
    version: 7,
    publishedVersion: 7,
    freeQuotaPerAgent: null,
    freeDailyBudget: null,
    slaFailureRate: 0.02,
    timeoutMs: 8000,
    maxRps: 40,
    maxDailyCalls: 25000,
    upstreamPath: "/v1/quote",
    outputs: [
      { target: "symbol", selector: "$.data.symbol" },
      { target: "price", selector: "$.data.last" },
      { target: "asOf", selector: "$.data.ts" },
    ],
  },
  {
    id: "c3a91e57-64b2-4f8d-9c15-7e0a3b6d2f49",
    toolId: "fx-rates",
    toolName: "FX reference rates",
    endpoint: `${API_HOST}/v1/fx`,
    pricingMode: "FREEMIUM",
    priceMajor: "0.12",
    status: "ACTIVE",
    version: 4,
    publishedVersion: 4,
    freeQuotaPerAgent: 50,
    freeDailyBudget: 5000,
    slaFailureRate: 0.05,
    timeoutMs: 6000,
    maxRps: 25,
    maxDailyCalls: null,
    upstreamPath: "/v1/fx",
    outputs: [
      { target: "base", selector: "$.base" },
      { target: "quote", selector: "$.quote" },
      { target: "rate", selector: "$.rate" },
      { target: "asOf", selector: "$.observed_at" },
    ],
  },
  {
    id: "d5e02b88-1c74-493a-8b2f-6a1c9d4e7503",
    toolId: "chain-activity",
    toolName: "Chain activity summary",
    endpoint: `${API_HOST}/v1/activity`,
    pricingMode: "FREE",
    priceMajor: "0",
    status: "ACTIVE",
    version: 3,
    publishedVersion: 3,
    freeQuotaPerAgent: null,
    freeDailyBudget: null,
    slaFailureRate: 0.08,
    timeoutMs: 10000,
    maxRps: null,
    maxDailyCalls: 5000,
    upstreamPath: "/v1/activity",
    outputs: [
      { target: "window", selector: "$.window" },
      { target: "transfers", selector: "$.counts.transfers" },
      { target: "addresses", selector: "$.counts.addresses" },
    ],
  },
  {
    id: "e7d63a10-9f28-45cb-a034-8c5b2e1f6d97",
    toolId: "vessel-positions",
    toolName: "Vessel positions",
    endpoint: `${API_HOST}/v1/vessels`,
    pricingMode: "PAID",
    priceMajor: "0.30",
    status: "DRAFT",
    version: 2,
    publishedVersion: null,
    freeQuotaPerAgent: null,
    freeDailyBudget: null,
    slaFailureRate: 0.03,
    timeoutMs: 9000,
    maxRps: 20,
    maxDailyCalls: null,
    upstreamPath: "/v1/vessels",
    outputs: [
      { target: "mmsi", selector: "$.vessel.mmsi" },
      { target: "lat", selector: "$.vessel.position.lat" },
      { target: "lon", selector: "$.vessel.position.lon" },
      { target: "asOf", selector: "$.vessel.position.ts" },
    ],
  },
];

/**
 * A tool a demo visitor can start a NEW listing for: every catalogue tool the
 * provider does not list yet. Its draft id names the tool, so a later GET of
 * that id answers as the same tool — the wizard never switches tools under
 * the visitor, and nothing has to be remembered between calls.
 */
const DRAFT_PREFIX = "demo-draft-";

const DRAFT_TOOLS: Record<string, Pick<DemoBinding, "toolName" | "outputs" | "seeded" | "sample">> = {
  "weather-now": {
    toolName: "Weather now",
    outputs: [
      { target: "temperature", selector: "$.temperature" },
      { target: "conditions", selector: "$.conditions" },
      { target: "observedAt", selector: "$.observedAt" },
    ],
    seeded: { inputs: ["city", "units"] },
    sample: {
      query: "?city=Lisbon&units=metric",
      rawBody: '{"temperature":21.4,"conditions":"Clear","observedAt":"2026-10-16T08:40:00Z"}',
      mapped: { temperature: 21.4, conditions: "Clear", observedAt: "2026-10-16T08:40:00Z" },
    },
  },
};

function draftBinding(toolId: string): DemoBinding {
  const known = DRAFT_TOOLS[toolId];
  return {
    id: `${DRAFT_PREFIX}${toolId}`,
    toolId,
    toolName: known?.toolName ?? toolId,
    endpoint: API_HOST,
    pricingMode: "FREE",
    priceMajor: "0",
    status: "DRAFT",
    version: 1,
    publishedVersion: null,
    freeQuotaPerAgent: null,
    freeDailyBudget: null,
    slaFailureRate: 0.02,
    timeoutMs: 10000,
    maxRps: null,
    maxDailyCalls: null,
    upstreamPath: "/",
    outputs: known?.outputs ?? [],
    seeded: known?.seeded ?? { inputs: [] },
    sample: known?.sample,
  };
}

/** The known binding for an id, a new draft's own tool, or the lead one standing in for an unknown id. */
function bindingFor(id: string | null): DemoBinding {
  if (id?.startsWith(DRAFT_PREFIX)) return draftBinding(id.slice(DRAFT_PREFIX.length));
  return BINDINGS.find((binding) => binding.id === id) ?? BINDINGS[0];
}

/** A write's answer: the stored listing with what was sent laid over it. Echoed, not kept. */
function withWrite(binding: DemoBinding, data: Record<string, unknown>): DemoBinding {
  const next = { ...binding };
  if (typeof data.endpoint === "string") next.endpoint = data.endpoint;
  if (data.pricingMode === "FREE" || data.pricingMode === "FREEMIUM" || data.pricingMode === "PAID") next.pricingMode = data.pricingMode;
  if (typeof data.priceAmount === "string" && /^\d+$/.test(data.priceAmount)) {
    next.priceMajor = (Number(data.priceAmount) / 1e6).toFixed(6);
  }
  if (typeof data.slaFailureRate === "number") next.slaFailureRate = data.slaFailureRate;
  if (typeof data.timeoutMs === "number") next.timeoutMs = data.timeoutMs;
  if (data.freeQuotaPerAgent === null || typeof data.freeQuotaPerAgent === "number") next.freeQuotaPerAgent = data.freeQuotaPerAgent;
  return next;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindingSummary(binding: DemoBinding) {
  return {
    id: binding.id,
    toolId: binding.toolId,
    endpoint: binding.endpoint,
    pricingMode: binding.pricingMode,
    price: money(binding.priceMajor),
    status: binding.status,
    version: binding.version,
  };
}

/**
 * The canonical mapping form, never the shorthand — a bare `"$.foo"` survives
 * exactly one normalisation call on the backend and the console persists
 * `{ "$path": … }`. The row editor round-trips this shape exactly, so opening
 * the editor and saving nothing does not bump `mapping_version`.
 */
function requestMapping(binding: DemoBinding): Record<string, unknown> {
  if (binding.seeded) {
    const inputs = binding.seeded.inputs;
    return inputs.length > 0
      ? { method: "GET", path: "/", query: Object.fromEntries(inputs.map((name) => [name, { $path: `$.${name}` }])) }
      : { method: "GET", path: "/" };
  }
  return {
    method: "GET",
    path: binding.upstreamPath,
    query: {
      q: { $path: "$.query" },
      limit: { $const: "25" },
    },
    headers: {
      accept: { $const: "application/json" },
      "x-api-version": { $const: "2026-05" },
    },
  };
}

function responseMapping(binding: DemoBinding): Record<string, unknown> {
  const document: Record<string, unknown> = {};
  for (const output of binding.outputs) document[output.target] = { $path: output.selector };
  return document;
}

function bindingDetail(binding: DemoBinding, id: string) {
  return {
    ...bindingSummary(binding),
    id,
    requestMapping: requestMapping(binding),
    responseMapping: responseMapping(binding),
    freeQuotaPerAgent: binding.freeQuotaPerAgent,
    freeDailyBudget: binding.freeDailyBudget,
    slaFailureRate: binding.slaFailureRate,
    timeoutMs: binding.timeoutMs,
    maxRps: binding.maxRps,
    maxDailyCalls: binding.maxDailyCalls,
    publishedVersion: binding.publishedVersion,
    hasUnpublishedChanges: binding.publishedVersion !== binding.version,
  };
}

// ── Traffic, quality and earnings ───────────────────────────────────────────

/**
 * Calls per UTC day over the trailing 30 days, oldest first. The 30-day total
 * is derived from this array rather than written twice — `/providers/me`'s
 * `callsServed` and `/quality`'s `totalCalls` read the same constant.
 */
const TRAFFIC_DAILY = [
  742, 801, 869, 913, 884, 756, 690, 812, 905, 948, 921, 877, 734, 702, 826, 913, 967, 940, 902,
  811, 745, 769, 858, 921, 986, 954, 918, 830, 761, 794,
];

const TRAFFIC_TOTAL = TRAFFIC_DAILY.reduce((total, calls) => total + calls, 0);

/**
 * `PaymentIntentStatus`, every value, zero-filled — a status never disappears
 * between buckets. `REFUNDED` is the one attributable failure; the in-flight
 * states only carry anything on the day that is still running.
 */
function byStatus(calls: number, inFlight = 0) {
  const refunded = Math.round(calls * 0.012);
  const voided = Math.round(calls * 0.008);
  const expired = Math.round(calls * 0.005);
  const settled = calls - refunded - voided - expired - inFlight;
  return [
    { status: "CREATED", calls: 0 },
    { status: "FUNDS_SECURED", calls: 0 },
    { status: "PROVIDER_EXECUTING", calls: Math.floor(inFlight / 2) },
    { status: "VERIFYING", calls: inFlight - Math.floor(inFlight / 2) },
    { status: "SETTLED", calls: settled },
    { status: "REFUNDED", calls: refunded },
    { status: "VOIDED", calls: voided },
    { status: "EXPIRED", calls: expired },
  ];
}

/** The top callers, calls descending. Everyone else folds into "other agents". */
const AGENT_CALLS: { agentId: string; calls: number }[] = [
  { agentId: "3f1c9a54-7e20-4b68-9d31-0c7a5e28b4d6", calls: 4218 },
  { agentId: "8b4d20e7-31c5-4f09-a7e2-9d5c60b18f34", calls: 3607 },
  { agentId: "1a7e5c39-b268-4d40-8f13-6e02a95c7d81", calls: 2984 },
  { agentId: "c6203f8b-49d1-4a75-b0e8-25f7c31a9e64", calls: 2440 },
  { agentId: "5d9b1e40-8c37-42fa-9165-b73e0a4d28c9", calls: 1903 },
  { agentId: "92f8c0a3-1b46-4e79-8c25-7a0d3f61b9e5", calls: 1512 },
  { agentId: "e4517b0d-2f68-4c93-a851-3b6d9e0f27ca", calls: 1188 },
  { agentId: "7a0d63f2-5e94-4187-b3c6-08f1e5b2c4d7", calls: 902 },
];

/** Verdict mix over the same 30-day window, as shares that sum to one. */
const VERDICT_SHARES: { verdict: string; share: number }[] = [
  { verdict: "PASS", share: 0.941 },
  { verdict: "FAIL", share: 0.0125 },
  { verdict: "EMPTY_CONFIRMED", share: 0.0223 },
  { verdict: "SKIPPED", share: 0.0167 },
  { verdict: "DEGRADED", share: 0.0075 },
];

/**
 * Counts derived from the shares, with the last row taking the remainder — so
 * the mix sums to `totalCalls` exactly rather than to 25,448 or 25,450.
 */
function verdictMix() {
  let assigned = 0;
  return VERDICT_SHARES.map((entry, index) => {
    const last = index === VERDICT_SHARES.length - 1;
    const calls = last ? TRAFFIC_TOTAL - assigned : Math.round(TRAFFIC_TOTAL * entry.share);
    assigned += calls;
    return { verdict: entry.verdict, calls, share: calls / TRAFFIC_TOTAL };
  });
}

/**
 * Earnings by tool, sized as one day. `earned` is Σ provider_amount and
 * `platformFee` is Σ platform_fee, so the two add back to the gross the call
 * count implies at that binding's price — 408 settled × $0.45 = $183.60, of
 * which 90% is the provider's.
 */
function earningsGroups() {
  return [
    {
      key: "market-quote",
      calls: 414,
      earned: money("165.24"),
      platformFee: money("18.36"),
      withheld: money("1.62"),
      withheldCalls: 4,
      // One passed call whose buyer has not settled its payment yet, and one
      // whose buyer never did (written off after 30 days). One each, so the
      // figure never equals the two failed checks' $0.81 on Money.
      debtOutstanding: money("0.405"),
      debtOutstandingCalls: 1,
      forfeited: money("0"),
      forfeitedCalls: 0,
      uncollected: money("0.405"),
      uncollectedCalls: 1,
    },
    {
      key: "fx-rates",
      calls: 219,
      earned: money("16.20"),
      platformFee: money("1.80"),
      withheld: money("0"),
      withheldCalls: 0,
      // One call forfeited while the stake was below the minimum.
      forfeited: money("0.072"),
      forfeitedCalls: 1,
    },
    {
      key: "chain-activity",
      calls: 218,
      earned: money("0"),
      platformFee: money("0"),
      withheld: money("0"),
      withheldCalls: 0,
    },
  ];
}

/** Σ of the groups above: 414 + 219 + 218 calls, $165.24 + $16.20 earned. */
function earningsTotals() {
  return {
    calls: 851,
    earned: money("181.44"),
    platformFee: money("20.16"),
    withheld: money("1.62"),
    withheldCalls: 4,
    debtOutstanding: money("0.405"),
    debtOutstandingCalls: 1,
    forfeited: money("0.072"),
    forfeitedCalls: 1,
    uncollected: money("0.405"),
    uncollectedCalls: 1,
  };
}

// ── SLA windows ─────────────────────────────────────────────────────────────

interface DemoWindow {
  windowId: string;
  label: string;
  sequence: number;
  bindingIndex: number;
  status: "OPEN" | "CLOSED";
  outcome: "WITHIN_SLA" | "INSUFFICIENT_SAMPLE" | "BREACH_PROPOSED" | null;
  openedMinutesAgo: number;
  closedMinutesAgo: number | null;
  totalCalls: number;
  verifiedCalls: number;
  failedCalls: number;
  minVerifiedCalls: number;
  warningLevel: "WARNING" | "CRITICAL" | null;
  samplingEscalationRequested: boolean;
}

/**
 * Per tool, back-to-back 7-day windows with exactly one OPEN (the newest) —
 * the Quality tab, the Penalties drawer and Home all read these, so a penalty
 * always points at a window that went over the promise. The list fixture
 * sorts newest first and filters by `bindingId`; the array order only fixes
 * the indices `demo-penalties.ts` refers to.
 *
 * Penalties (see `demo-penalties.ts`), by the real formula
 * min(Σ price × (observed − declared) × 2, max($5, 100 × price)):
 *   w_117 market-quote  21/512 = 4.10% vs 2% → $675.90 × 2.10% × 2 = $28.41
 *   w_46  fx-rates      27/214 = 12.62% vs 5% → $72.48 × 7.62% × 2 = $11.04
 *   w_45  fx-rates      21/203 = 10.34% vs 5% → $70.56 × 5.34% × 2 = $7.54
 */
const WINDOWS: DemoWindow[] = [
  {
    windowId: "9d4c1f70-3a86-4b52-8e09-1c7f2a56d3b8",
    label: "w_118",
    sequence: 118,
    bindingIndex: 0,
    status: "OPEN",
    outcome: null,
    openedMinutesAgo: 2760,
    closedMinutesAgo: null,
    totalCalls: 1284,
    verifiedCalls: 431,
    failedCalls: 6,
    minVerifiedCalls: 200,
    warningLevel: null,
    samplingEscalationRequested: false,
  },
  {
    windowId: "2e8b6045-97c3-41da-b57f-0a3d9e1c86f4",
    label: "w_117",
    sequence: 117,
    bindingIndex: 0,
    status: "CLOSED",
    outcome: "BREACH_PROPOSED",
    openedMinutesAgo: 12840,
    closedMinutesAgo: 2760,
    totalCalls: 1502,
    verifiedCalls: 512,
    failedCalls: 21,
    minVerifiedCalls: 200,
    warningLevel: "CRITICAL",
    samplingEscalationRequested: false,
  },
  {
    windowId: "6f31a92d-5c04-4e87-9b60-8d2e7c4a15f3",
    label: "w_46",
    sequence: 46,
    bindingIndex: 1,
    status: "CLOSED",
    outcome: "BREACH_PROPOSED",
    openedMinutesAgo: 15840,
    closedMinutesAgo: 5760,
    totalCalls: 604,
    verifiedCalls: 214,
    failedCalls: 27,
    minVerifiedCalls: 200,
    warningLevel: "CRITICAL",
    samplingEscalationRequested: false,
  },
  {
    windowId: "a70d2c85-1b49-4f63-8ae2-3c5f06d97b21",
    label: "w_45",
    sequence: 45,
    bindingIndex: 1,
    status: "CLOSED",
    outcome: "BREACH_PROPOSED",
    openedMinutesAgo: 25920,
    closedMinutesAgo: 15840,
    totalCalls: 588,
    verifiedCalls: 203,
    failedCalls: 21,
    minVerifiedCalls: 200,
    warningLevel: "CRITICAL",
    samplingEscalationRequested: false,
  },
  {
    windowId: "4c95e138-8d27-4a06-b1f9-27e0a6c3d854",
    label: "w_9",
    sequence: 9,
    bindingIndex: 2,
    status: "OPEN",
    outcome: null,
    openedMinutesAgo: 1440,
    closedMinutesAgo: null,
    totalCalls: 218,
    verifiedCalls: 61,
    failedCalls: 2,
    minVerifiedCalls: 200,
    warningLevel: null,
    samplingEscalationRequested: true,
  },
  {
    windowId: "1b7e4d92-6a05-4c38-9f21-5e8c0a3d7b64",
    label: "w_116",
    sequence: 116,
    bindingIndex: 0,
    status: "CLOSED",
    outcome: "WITHIN_SLA",
    openedMinutesAgo: 22920,
    closedMinutesAgo: 12840,
    totalCalls: 1476,
    verifiedCalls: 498,
    failedCalls: 7,
    minVerifiedCalls: 200,
    warningLevel: null,
    samplingEscalationRequested: false,
  },
  {
    windowId: "8c2f5a17-3e90-4d6b-a148-0f7b9e2c5d31",
    label: "w_47",
    sequence: 47,
    bindingIndex: 1,
    status: "OPEN",
    outcome: null,
    openedMinutesAgo: 5760,
    closedMinutesAgo: null,
    totalCalls: 392,
    verifiedCalls: 141,
    failedCalls: 4,
    minVerifiedCalls: 200,
    warningLevel: null,
    samplingEscalationRequested: false,
  },
];

function slaWindow(entry: DemoWindow, windowId = entry.windowId) {
  const binding = BINDINGS[entry.bindingIndex];
  const price = money(binding.priceMajor);
  return {
    windowId,
    label: entry.label,
    sequence: entry.sequence,
    bindingId: binding.id,
    toolId: binding.toolId,
    status: entry.status,
    outcome: entry.outcome,
    openedAt: minutesAgo(entry.openedMinutesAgo),
    /** `openedAt` + the 7-day max age frozen at open. */
    deadlineAt: minutesAgo(entry.openedMinutesAgo - 10080),
    closedAt: entry.closedMinutesAgo === null ? null : minutesAgo(entry.closedMinutesAgo),
    declaredFailureRate: binding.slaFailureRate,
    minVerifiedCalls: entry.minVerifiedCalls,
    totalCalls: entry.totalCalls,
    verifiedCalls: entry.verifiedCalls,
    failedCalls: entry.failedCalls,
    observedFailureRate:
      entry.verifiedCalls === 0 ? null : entry.failedCalls / entry.verifiedCalls,
    totalCallAmount: String(BigInt(price.amount) * BigInt(entry.totalCalls)),
    assetId: DEMO_ASSET,
    warningLevel: entry.warningLevel,
    samplingEscalationRequested: entry.samplingEscalationRequested,
  };
}

function windowFor(windowId: string | null): DemoWindow {
  return WINDOWS.find((entry) => entry.windowId === windowId) ?? WINDOWS[0];
}

/** Wilson-shaped bounds around the observed rate. Illustrative, not computed. */
function interval(rate: number, halfWidth: number) {
  return { lower: Math.max(0, rate - halfWidth), upper: rate + halfWidth };
}

// ── Verdicts ────────────────────────────────────────────────────────────────

interface DemoVerdict {
  id: string;
  bindingIndex: number;
  verdictStatus: string;
  reasonCode: string | null;
  reason: string | null;
  score: number | null;
  failingRules: string[];
  agentId: string;
  minutes: number;
  /** REFUND is the only settlement outcome that strikes. */
  outcome: "SETTLE" | "REFUND" | "VOID";
}

const VERDICTS: DemoVerdict[] = [
  {
    id: "0f5a3c81-6d29-4b74-9e08-1a7c5e30d2f6",
    bindingIndex: 0,
    verdictStatus: "PASS",
    reasonCode: null,
    reason: null,
    score: 1,
    failingRules: [],
    agentId: AGENT_CALLS[0].agentId,
    minutes: 12,
    outcome: "SETTLE",
  },
  {
    id: "3b8e07d4-92f1-4c56-a0b3-7d1e6a45c8f2",
    bindingIndex: 0,
    verdictStatus: "FAIL",
    reasonCode: "FRESHNESS_STALE",
    reason: "The quote timestamp was 41 minutes old; the policy allows 5.",
    score: 0.42,
    failingRules: ["FRESHNESS_STALE", "VALUE_RANGE_OUT_OF_BOUNDS"],
    agentId: AGENT_CALLS[1].agentId,
    minutes: 96,
    outcome: "REFUND",
  },
  {
    id: "7d20c9a5-4e83-41fb-b6d7-0c95e38a1247",
    bindingIndex: 1,
    verdictStatus: "PASS",
    reasonCode: null,
    reason: null,
    score: 1,
    failingRules: [],
    agentId: AGENT_CALLS[2].agentId,
    minutes: 148,
    outcome: "SETTLE",
  },
  {
    id: "c41f8b26-0a57-4d39-92e4-6b8d1c70f5a3",
    bindingIndex: 0,
    verdictStatus: "EMPTY_CONFIRMED",
    reasonCode: "EMPTY_RESULT_CONFIRMED",
    reason: "The upstream returned no rows, and the cross-check agreed there are none.",
    score: 0.88,
    failingRules: [],
    agentId: AGENT_CALLS[0].agentId,
    minutes: 205,
    outcome: "SETTLE",
  },
  {
    id: "9a63d05e-7c14-482b-a3f6-5e0b29d1c847",
    bindingIndex: 2,
    verdictStatus: "SKIPPED",
    reasonCode: "NOT_SAMPLED",
    reason: "This call was not drawn by the sampler at the binding's current rate.",
    score: null,
    failingRules: [],
    agentId: AGENT_CALLS[3].agentId,
    minutes: 260,
    outcome: "SETTLE",
  },
  {
    id: "5e07b2c9-8d41-4a06-b7f3-2c9a6e05d183",
    bindingIndex: 1,
    verdictStatus: "PASS",
    reasonCode: null,
    reason: null,
    score: 1,
    failingRules: [],
    agentId: AGENT_CALLS[4].agentId,
    minutes: 318,
    outcome: "SETTLE",
  },
  {
    id: "2c9f4e81-53a7-40d6-8b12-7e05c3a9f640",
    bindingIndex: 0,
    verdictStatus: "PASS",
    reasonCode: null,
    reason: null,
    score: 1,
    failingRules: [],
    agentId: AGENT_CALLS[1].agentId,
    minutes: 402,
    outcome: "SETTLE",
  },
];

function verdictFor(id: string | null): DemoVerdict {
  return VERDICTS.find((entry) => entry.id === id) ?? VERDICTS[0];
}

function verdictListItem(entry: DemoVerdict) {
  const binding = BINDINGS[entry.bindingIndex];
  return {
    id: entry.id,
    intentId: `pi_${entry.id.slice(0, 8)}`,
    toolId: binding.toolId,
    callId: `call_${entry.id.slice(0, 12)}`,
    callClass: binding.pricingMode === "FREE" ? "FREE" : "PAID",
    state: "SETTLED",
    verdictStatus: entry.verdictStatus,
    reasonCode: entry.reasonCode,
    score: entry.score,
    failingRules: entry.failingRules,
    agentId: entry.agentId,
    decisionPolicyVersion: 3,
    /** No column records which mapping version was live. Always null. */
    bindingVersion: null,
    windowId: WINDOWS[0].windowId,
    countedTowardWindow: entry.verdictStatus === "PASS" || entry.verdictStatus === "FAIL",
    retentionState: "RAW",
    createdAt: minutesAgo(entry.minutes),
  };
}

/** The four pipeline stages, always present and always in pipeline order. */
function stageResults(entry: DemoVerdict) {
  const failed = entry.verdictStatus === "FAIL";
  return [
    {
      stage: "SCHEMA",
      status: "PASSED",
      label: "Schema",
      note: "Every declared output field was present and well-typed.",
      passed: true,
      code: null,
      detail: null,
      score: 1,
    },
    {
      stage: "DETERMINISTIC_RULES",
      status: failed ? "FAILED" : "PASSED",
      label: "Deterministic rules",
      note: failed ? "One rule of three failed." : "All three rules passed.",
      passed: !failed,
      code: failed ? entry.reasonCode : null,
      detail: failed ? entry.reason : null,
      score: failed ? 0.42 : 1,
    },
    {
      stage: "CROSS_CHECK",
      status: failed ? "NOT_REACHED" : "PASSED",
      label: "Cross-check",
      note: failed
        ? "Not reached — the previous stage decided the verdict."
        : "Agreed with a second source.",
      passed: !failed,
      code: null,
      detail: null,
      score: failed ? null : 0.96,
    },
    {
      stage: "SEMANTIC",
      status: "NOT_IMPLEMENTED",
      label: "Semantic",
      note: "No semantic judge is registered on this platform.",
      passed: false,
      code: null,
      detail: null,
      score: null,
    },
  ];
}

/** The deterministic rules behind the stage score, for the evidence pack. */
function evidenceRules(failed: boolean) {
  return [
    {
      ruleId: "freshness",
      type: "FRESHNESS",
      outcome: failed ? "FAILED" : "PASSED",
      weight: 0.4,
      code: failed ? "FRESHNESS_STALE" : null,
      detail: failed ? "Observed 41m old; the ceiling is 5m." : "Observed 22s old.",
      pointer: "/asOf",
    },
    {
      ruleId: "required-fields",
      type: "REQUIRED_FIELDS",
      outcome: "PASSED",
      weight: 0.35,
      code: null,
      detail: null,
      pointer: null,
    },
    {
      ruleId: "value-range",
      type: "VALUE_RANGE",
      outcome: "PASSED",
      weight: 0.25,
      code: null,
      detail: null,
      pointer: "/price",
    },
  ];
}

// ── Slash proposal and dispute ──────────────────────────────────────────────

const PROPOSAL_ID = "a91c35e7-0b62-4d84-9f3a-6c81e740d2b5";
const DISPUTE_ID = "f2a84c61-3d75-4e08-b19c-7a0e5d2f8c36";



const DISPUTE_REASON =
  "19 of the 27 failures in this window came from one caller, which re-sent the same stale-window query every 40 seconds for two hours. Excluding that caller the observed rate is 3.74%, inside the declared 5.00%.";

function slashProposalSummary(proposalId: string) {
  /* Three demo cases — needs action, disputed on chain, executed — matching
     the on-chain rows in `demo-penalties.ts`. Any other id reads as the
     disputed one, as before. */
  const known = DEMO_PENALTY_PROPOSALS.indexOf(proposalId as (typeof DEMO_PENALTY_PROPOSALS)[number]);
  const which = known === -1 ? 1 : known;
  const subject = WINDOWS[DEMO_PENALTY_SUBJECTS[which].windowIndex];
  const binding = BINDINGS[DEMO_PENALTY_SUBJECTS[which].bindingIndex];
  const penalty = money(DEMO_PENALTY_AMOUNTS[which]);
  const base = {
    id: proposalId,
    providerId: PROVIDER_ID,
    bindingId: binding.id,
    bindingLabel: `${binding.toolName} · ${binding.endpoint}`,
    toolId: binding.toolId,
    toolName: binding.toolName,
    windowId: subject.windowId,
    windowLabel: subject.label,
    penaltyAmount: penalty,
    outcome: null,
    resolutionKind: null,
    resolvedAt: null,
  };
  if (which === 0) {
    return {
      ...base,
      status: "PROPOSED",
      appliedAmount: null,
      clocks: {
        proposedAt: demoPenaltyTime(-1200),
        notifiedAt: demoPenaltyTime(-1190),
        acknowledgedAt: null,
        respondByAt: demoPenaltyTime(3120),
        platformDecisionDueAt: null,
        earliestExecutionAt: demoPenaltyTime(3120),
        chainExecutableAt: demoPenaltyTime(3120),
        chainStatus: "PENDING",
        secondsRemaining: 3120 * 60,
        runningClock: "PROVIDER",
      },
      disputeId: null,
      executedAt: null,
    };
  }
  if (which === 2) {
    return {
      ...base,
      status: "EXECUTED",
      appliedAmount: penalty,
      clocks: {
        proposedAt: demoPenaltyTime(-15000),
        notifiedAt: demoPenaltyTime(-14990),
        acknowledgedAt: null,
        respondByAt: demoPenaltyTime(-10680),
        platformDecisionDueAt: null,
        earliestExecutionAt: demoPenaltyTime(-10680),
        chainExecutableAt: demoPenaltyTime(-10680),
        chainStatus: "EXECUTED",
        secondsRemaining: null,
        runningClock: "NONE",
      },
      disputeId: null,
      outcome: "EXECUTED",
      resolvedAt: demoPenaltyTime(-10500),
      executedAt: demoPenaltyTime(-10500),
    };
  }
  return {
    ...base,
    status: "DISPUTED",
    appliedAmount: null,
    clocks: {
      proposedAt: demoPenaltyTime(-5700),
      notifiedAt: demoPenaltyTime(-5688),
      acknowledgedAt: null,
      respondByAt: null,
      platformDecisionDueAt: demoPenaltyTime(5340),
      earliestExecutionAt: demoPenaltyTime(2520),
      chainExecutableAt: demoPenaltyTime(2880),
      chainStatus: "DISPUTED",
      chainDisputedAt: demoPenaltyTime(-4320),
      chainDisputedParts: 1,
      secondsRemaining: null,
      runningClock: "PLATFORM",
    },
    disputeId: DISPUTE_ID,
    executedAt: null,
  };
}

/** `total` failures split by `shares`, the first bucket taking the remainder so the parts sum to `total`. */
function splitFailures(total: number, shares: readonly number[]): number[] {
  const counts = shares.map((share) => Math.floor(total * share));
  counts[0] += total - counts.reduce((sum, count) => sum + count, 0);
  return counts;
}

/** "$28.41" from a major-unit string, two decimals. */
/** Cut to cents, never rounded up — the same rule `formatMoney` applies, so a fixture's text matches the screens. */
function usd(major: string): string {
  const [whole, fraction = ""] = major.split(".");
  return `$${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
}

/**
 * The figures one demo penalty case rests on, read from its subject window so
 * the timeline, the derivation and the Quality tab say the same thing.
 */
function caseFacts(proposalId: string | null) {
  const known = DEMO_PENALTY_PROPOSALS.indexOf(proposalId as (typeof DEMO_PENALTY_PROPOSALS)[number]);
  const which = known === -1 ? 1 : known;
  const subject = WINDOWS[DEMO_PENALTY_SUBJECTS[which].windowIndex];
  const binding = BINDINGS[DEMO_PENALTY_SUBJECTS[which].bindingIndex];
  const declared = binding.slaFailureRate;
  const observed = subject.failedCalls / subject.verifiedCalls;
  const threshold = declared + 2.58 * Math.sqrt((declared * (1 - declared)) / subject.verifiedCalls);
  const split = (shares: readonly number[]) => splitFailures(subject.failedCalls, shares);
  const agentCounts = which === 1 ? [19, 5, 3] : split([0.62, 0.24, 0.14]);
  const ruleCounts = which === 1 ? [21, 4, 2] : split([0.72, 0.19, 0.09]);
  const agents = [AGENT_CALLS[1].agentId, AGENT_CALLS[4].agentId, AGENT_CALLS[2].agentId];
  const rules = ["FRESHNESS_STALE", "VALUE_RANGE_OUT_OF_BOUNDS", "REQUIRED_FIELDS_MISSING"];
  return {
    which,
    subject,
    binding,
    declared,
    observed,
    threshold,
    amount: DEMO_PENALTY_AMOUNTS[which],
    proposedMinutesAgo: [1200, 5700, 15000][which],
    byAgent: agents.map((key, index) => ({ key, count: agentCounts[index], share: agentCounts[index] / subject.failedCalls })),
    byRule: rules.map((key, index) => ({ key, count: ruleCounts[index], share: ruleCounts[index] / subject.failedCalls })),
  };
}

function disputeRow(id: string) {
  return {
    id,
    /* Written directly by the arbitration service; the public enum omits it. */
    subjectType: "SLASH_PROPOSAL",
    subjectId: PROPOSAL_ID,
    providerId: PROVIDER_ID,
    state: "UNDER_REVIEW",
    claimType: "AGENT_GRIEFING",
    reason: DISPUTE_REASON,
    evidence: [],
    openedBy: CONSOLE_CREDENTIAL,
    acknowledgedAt: minutesAgo(4380),
    deadlineAt: inMinutes(2460),
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    restoredAmount: null,
    createdAt: minutesAgo(4320),
    updatedAt: minutesAgo(2880),
  };
}

// ── The fixtures ────────────────────────────────────────────────────────────

/**
 * Order matters only where two entries could match one path: the first match
 * wins. `catalogue` is listed before the `tool-bindings/{id}` regex for exactly
 * that reason, and every id-shaped regex is anchored so a sub-resource
 * (`/evidence`, `/sla`, `/timeline`) cannot be swallowed by its parent.
 */
export const PROVIDER_FIXTURES: readonly DemoFixture[] = [
  // ── Identity and registration ────────────────────────────────────────────
  {
    method: "GET",
    match: "/providers/me",
    body: () => ({
      id: PROVIDER_ID,
      status: "ACTIVE",
      tier: "ESTABLISHED",
      stats: {
        availabilityRate: 0.9991,
        paidQualityRate: 0.982,
        freeQualityRate: 0.9705,
        p50LatencyMs: 142,
        p95LatencyMs: 486,
        callsServed: TRAFFIC_TOTAL,
        upheldSlashes: 0,
      },
      slashHolds: [],
    }),
  },
  {
    method: "GET",
    match: "/providers/me/registration",
    /* `payoutAccounts[]` names a chain and an account. Must win. */
    override: "always",
    body: () => ({
      registration: {
        id: PROVIDER_ID,
        legalName: LEGAL_NAME,
        technicalContact: {
          name: "Priya Raman",
          email: "priya.raman@harborlight.example",
          phone: "+44 20 7946 0812",
        },
        ownerContact: {
          name: "Tomas Ek",
          email: "tomas.ek@harborlight.example",
          phone: null,
        },
        timezone: "Europe/London",
        acceptedTerms: {
          providerAgreementVersion: "2026-04-01",
          payoutTermsVersion: "2026-04-01",
          slashPolicyVersion: "2026-06-15",
          acceptedAt: minutesAgo(64800),
          acceptedBy: CONSOLE_CREDENTIAL,
        },
        status: "ACTIVE",
        tier: "ESTABLISHED",
        /* One enrolment per chain, and only `ACTIVE` is payable. */
        payoutAccounts: [
          {
            chainId: DEMO_CHAIN_ID,
            accountId: payoutAccount(),
            provedAt: minutesAgo(64740),
            status: "ACTIVE",
          },
        ],
        endpoint: API_HOST,
        verification: {
          verified: true,
          verifiedBy: "ops@platform.example",
          verifiedAt: minutesAgo(43200),
          method: "DOMAIN_CONTROL",
          checks: [
            { check: "DOMAIN_CONTROL", result: "PASS", note: "DNS TXT record observed." },
            { check: "LEGAL_ENTITY", result: "PASS", note: "Companies House 09871423." },
            { check: "SANCTIONS_SCREEN", result: "PASS", note: null },
            { check: "ON_CHAIN_HISTORY", result: "NOT_CHECKED", note: null },
          ],
          expiresAt: inMinutes(388800),
          evidenceUrl: null,
        },
        registeredAt: minutesAgo(64800),
      },
      steps: [
        { key: "account", title: "Account", caption: "Legal name and two contacts", status: "DONE" },
        {
          key: "payoutWallet",
          title: "Payout wallet",
          caption: "Signed proof of the address we pay",
          status: "DONE",
        },
        {
          key: "endpoint",
          title: "Endpoint",
          caption: "Reachable from our egress addresses",
          status: "DONE",
        },
        { key: "terms", title: "Terms", caption: "Three documents, versioned", status: "DONE" },
      ],
      currentStep: 4,
      totalSteps: 4,
      terms: {
        providerAgreementVersion: "2026-04-01",
        payoutTermsVersion: "2026-04-01",
        slashPolicyVersion: "2026-06-15",
        acceptanceLine:
          "I accept the Provider Agreement (2026-04-01), the Payout Terms (2026-04-01) and the Slash Policy (2026-06-15) on behalf of Harborlight Data Ltd.",
        commercialTerms: [
          {
            key: "take_rate",
            label: "Take rate",
            value: "10%",
            caption: "Configurable; the rate in force is shown at registration.",
          },
          {
            key: "payout_rail",
            label: "Payout",
            value: "On-chain, at redemption",
            caption: "Paid into your own token account inside the settling transaction.",
          },
          {
            key: "unbonding",
            label: "Unbonding",
            value: "14 days",
            caption: "Stake stays slashable for the whole period.",
          },
        ],
      },
      egressIps: EGRESS_IPS,
      lastConnectivityCheck: {
        outcome: "REACHABLE",
        endpoint: API_HOST,
        statusCode: 200,
        latencyMs: 96,
        failureKind: null,
        failureCode: null,
        detail: null,
        egressIps: EGRESS_IPS,
        checkedAt: minutesAgo(180),
      },
    }),
  },
  {
    method: "GET",
    match: "/providers/egress-ips",
    body: () => ({ egressIps: EGRESS_IPS }),
  },

  // ── Capital ──────────────────────────────────────────────────────────────
  {
    method: "GET",
    match: "/providers/me/stake",
    /* Names the chain and the stake authority on every entry. Must win. */
    override: "always",
    body: () => ({
      /*
        One chain, because this provider serves one chain. `staked` and
        `hasKnownStake` live HERE and never at the response's top level — a
        per-chain list has no scalar reading.
      */
      stake: [
        {
          chainId: DEMO_CHAIN_ID,
          hasKnownStake: true,
          staked: money("600.00"),
          observedAt: minutesAgo(3),
          unbonding: null,
          unbondingStartedAt: null,
          unbondingCompletesAt: null,
          chainReadable: true,
          stakeAuthority: stakeAuthority(),
        },
      ],
      /* ACTIVE PAID/FREEMIUM bindings only — the FREE one needs no stake. */
      requirement: [
        {
          bindingId: BINDINGS[1].id,
          toolId: BINDINGS[1].toolId,
          pricingMode: "FREEMIUM",
          price: money("0.12"),
          minimum: money("120.00"),
          derivation: "max(floor 50.000000, 1000 × 0.120000) = 120.000000",
          grace: null,
        },
        {
          bindingId: BINDINGS[0].id,
          toolId: BINDINGS[0].toolId,
          pricingMode: "PAID",
          price: money("0.45"),
          minimum: money("450.00"),
          derivation: "max(floor 50.000000, 1000 × 0.450000) = 450.000000",
          grace: null,
        },
      ],
      requirementRule: "max",
      requirementTotal: money("450.00"),
      negotiatedMinimum: null,
      graceSummary: null,
      headroom: money("150.00"),
      shortfall: money("0"),
      recommendedBuffer: money("675.00"),
    }),
  },

  // ── Bindings ─────────────────────────────────────────────────────────────
  {
    method: "GET",
    match: "/providers/me/tool-bindings/catalogue",
    /* `settlementAsset.assetId` is a CAIP-19 and must be the 46630 USDG. */
    override: "always",
    body: () => ({
      tools: [
        {
          id: "market-quote",
          name: "Market quote",
          description: "The last traded price for one symbol, with the timestamp it was observed.",
          tier: "VERIFIED",
          inputSchema: {
            type: "object",
            required: ["symbol"],
            properties: { symbol: { type: "string" } },
          },
          outputSchema: {
            type: "object",
            required: ["symbol", "price", "asOf"],
            properties: {
              symbol: { type: "string" },
              price: { type: "number" },
              asOf: { type: "string", format: "date-time" },
            },
          },
        },
        {
          id: "fx-rates",
          name: "FX reference rates",
          description: "A reference rate for one currency pair, with the observation time.",
          tier: "VERIFIED",
          inputSchema: {
            type: "object",
            required: ["base", "quote"],
            properties: { base: { type: "string" }, quote: { type: "string" } },
          },
          outputSchema: {
            type: "object",
            required: ["base", "quote", "rate", "asOf"],
            properties: {
              base: { type: "string" },
              quote: { type: "string" },
              rate: { type: "number" },
              asOf: { type: "string", format: "date-time" },
            },
          },
        },
        {
          id: "chain-activity",
          name: "Chain activity summary",
          description: "Transfer and active-address counts for one chain over a named window.",
          tier: "UNVERIFIED",
          inputSchema: {
            type: "object",
            required: ["chainId"],
            properties: { chainId: { type: "string" }, window: { type: "string" } },
          },
          outputSchema: {
            type: "object",
            required: ["window", "transfers", "addresses"],
            properties: {
              window: { type: "string" },
              transfers: { type: "integer" },
              addresses: { type: "integer" },
            },
          },
        },
        {
          id: "vessel-positions",
          name: "Vessel positions",
          description: "The last reported AIS position for one vessel.",
          tier: "GUARANTEED",
          inputSchema: {
            type: "object",
            required: ["mmsi"],
            properties: { mmsi: { type: "string" } },
          },
          outputSchema: {
            type: "object",
            required: ["mmsi", "lat", "lon", "asOf"],
            properties: {
              mmsi: { type: "string" },
              lat: { type: "number" },
              lon: { type: "number" },
              asOf: { type: "string", format: "date-time" },
            },
          },
        },
        {
          id: "weather-now",
          name: "Weather now",
          description: "Current temperature and conditions for a city.",
          tier: "VERIFIED",
          inputSchema: {
            type: "object",
            required: ["city"],
            properties: { city: { type: "string", examples: ["Lisbon"] }, units: { type: "string", enum: ["metric", "imperial"] } },
          },
          outputSchema: {
            type: "object",
            required: ["temperature", "conditions", "observedAt"],
            properties: {
              temperature: { type: "number" },
              conditions: { type: "string" },
              observedAt: { type: "string", format: "date-time" },
            },
          },
        },
        {
          /* Seeded for tests; the listing wizard must never offer it. */
          id: "fixture-echo",
          name: "Echo (DEMO FIXTURE — DO NOT CALL)",
          description: "DEMO FIXTURE — DO NOT CALL",
          tier: "UNVERIFIED",
          inputSchema: { type: "object", properties: {} },
          outputSchema: { type: "object", properties: {} },
        },
      ],
      settlementAsset: { assetId: DEMO_ASSET, symbol: "USDG", decimals: 6 },
    }),
  },
  {
    method: "GET",
    match: "/providers/me/tool-bindings",
    body: () => page(BINDINGS.map(bindingSummary)),
  },
  {
    method: "GET",
    match: /^\/providers\/me\/tool-bindings\/[^/]+\/publish-check$/,
    body: (path) => {
      const binding = bindingFor(idIn(path, 3));
      return {
        publishable: true,
        mappingVersion: binding.version,
        requirements: [
          {
            requirement: "TESTER_RUN",
            met: true,
            code: null,
            detail: `Run at revision ${binding.version}.`,
          },
          {
            requirement: "TESTER_PASSED",
            met: true,
            code: null,
            detail: "Every layer passed, including verification.",
          },
          {
            requirement: "STAKE_AT_MINIMUM_ON_EVERY_CHAIN",
            met: true,
            code: null,
            detail: "$600.00 bonded against a $450.00 requirement.",
          },
        ],
      };
    },
  },
  {
    method: "GET",
    match: /^\/providers\/me\/tool-bindings\/[^/]+$/,
    body: (path) => {
      const id = idIn(path, 3) ?? BINDINGS[0].id;
      return bindingDetail(bindingFor(id), id);
    },
  },
  {
    /*
      The tester calls the provider's endpoint for real, charges nobody and
      writes no payment intent — so a canned run is a report, not a ledger
      entry. Left at the default override so a dev backend that can really run
      one still wins.
    */
    method: "POST",
    match: /^\/providers\/me\/tool-bindings\/[^/]+\/test$/,
    body: (path) => {
      const binding = bindingFor(idIn(path, 3));
      return {
        callId: "call_7f21c93a4b08",
        outcome: "PASSED",
        failedLayer: null,
        mappingVersion: binding.version,
        layers: [
          { layer: "REQUEST_MAPPING", status: "PASSED", code: null, detail: null, fault: null },
          {
            layer: "UPSTREAM",
            status: "PASSED",
            code: null,
            detail: "HTTP 200 in 118ms.",
            fault: null,
          },
          { layer: "CLASSIFICATION", status: "PASSED", code: "OK", detail: null, fault: null },
          { layer: "RESPONSE_MAPPING", status: "PASSED", code: null, detail: null, fault: null },
          { layer: "VERIFICATION", status: "PASSED", code: null, detail: null, fault: null },
        ],
        request: {
          method: "GET",
          url: binding.sample ? `${binding.endpoint}${binding.sample.query}` : `${binding.endpoint}?q=ETH-USD&limit=25`,
          headerNames: ["accept", "x-api-version", "x-assay-call-id"],
          body: null,
        },
        upstream: {
          status: 200,
          latencyMs: 118,
          rawBody: binding.sample?.rawBody ?? '{"data":{"symbol":"ETH-USD","last":3184.22,"ts":"2026-09-16T08:41:02Z"}}',
          rawBodyTruncated: false,
          contentType: "application/json",
          transportError: null,
        },
        classification: { responseClass: "DATA_RESULT", reason: "OK", retryAfterMs: null },
        mapped: binding.sample?.mapped ?? { symbol: "ETH-USD", price: 3184.22, asOf: "2026-09-16T08:41:02Z" },
        verification: {
          policySource: "STORED_POLICY",
          policyId: "pol_market_quote_v3",
          policyVersion: 3,
          stages: [
            { stage: "SCHEMA", status: "PASSED", code: null, detail: null, score: 1 },
            {
              stage: "DETERMINISTIC_RULES",
              status: "PASSED",
              code: null,
              detail: null,
              score: 1,
              rules: evidenceRules(false),
            },
            { stage: "CROSS_CHECK", status: "PASSED", code: null, detail: null, score: 0.97 },
            { stage: "SEMANTIC", status: "NOT_IMPLEMENTED", code: null, detail: null, score: null },
          ],
          verdict: "PASS",
        },
        ranAt: justNow(),
      };
    },
  },

  /*
    Writes from the listing wizard and a listing's Settings. Stand-ins only:
    they echo a plausible answer and remember nothing, so the screens can be
    walked through without a backend. A new draft answers as the tool that
    was picked (its id names the tool, see `draftBinding`), so the wizard keeps
    that tool on every later GET; a tool already listed answers as that listing.
  */
  {
    method: "POST",
    match: "/providers/me/tool-bindings/validate-mapping",
    body: (_path, _query, data = {}) => ({
      canonical: data.mapping ?? {},
      selectors: [],
      transforms: [],
    }),
  },
  {
    method: "POST",
    match: "/providers/me/tool-bindings",
    body: (_path, _query, data = {}) => {
      const toolId = typeof data.toolId === "string" ? data.toolId : BINDINGS[3].toolId;
      const listed = BINDINGS.find((binding) => binding.toolId === toolId);
      const binding = withWrite(listed ?? draftBinding(toolId), data);
      return {
        ...bindingDetail(binding, binding.id),
        ...(isMapping(data.requestMapping) ? { requestMapping: data.requestMapping } : {}),
        ...(isMapping(data.responseMapping) ? { responseMapping: data.responseMapping } : {}),
      };
    },
  },
  {
    method: "PATCH",
    match: /^\/providers\/me\/tool-bindings\/[^/]+$/,
    body: (path, _query, data = {}) => {
      const id = idIn(path, 3) ?? BINDINGS[0].id;
      return {
        ...bindingDetail(withWrite(bindingFor(id), data), id),
        ...(isMapping(data.requestMapping) ? { requestMapping: data.requestMapping } : {}),
        ...(isMapping(data.responseMapping) ? { responseMapping: data.responseMapping } : {}),
      };
    },
  },
  {
    method: "POST",
    match: /^\/providers\/me\/tool-bindings\/[^/]+\/publish$/,
    body: (path) => {
      const id = idIn(path, 3) ?? BINDINGS[0].id;
      const binding = bindingFor(id);
      return {
        ...bindingDetail({ ...binding, status: "ACTIVE", publishedVersion: binding.version }, id),
        publishedAt: justNow(),
      };
    },
  },
  {
    method: "POST",
    match: /^\/providers\/me\/tool-bindings\/[^/]+\/(pause|resume)$/,
    body: (path) => {
      const id = idIn(path, 3) ?? BINDINGS[0].id;
      const pausing = path.endsWith("/pause");
      return {
        ...bindingDetail({ ...bindingFor(id), status: pausing ? "PAUSED" : "ACTIVE" }, id),
        pauseReason: pausing ? "PROVIDER_REQUESTED" : null,
        pausedAt: pausing ? justNow() : null,
      };
    },
  },
  {
    method: "POST",
    match: "/tool-requests",
    body: () => ({
      id: "3f9c7a21-5e08-4d6b-9b2a-8c1e4f7d0a35",
      title: "Your requested tool",
      description: "Returns: what you described",
      upstreamUrl: null,
      expectedMonthlyCalls: null,
      status: "OPEN",
      ownerOperatorId: null,
      firstResponseDueAt: minutesAgo(-2880),
      firstRespondedAt: null,
      resolutionNote: null,
      closedAt: null,
      createdAt: justNow(),
    }),
  },

  // ── Reports ──────────────────────────────────────────────────────────────
  {
    method: "GET",
    match: "/providers/me/traffic",
    body: () => ({
      from: minutesAgo(43200),
      to: minutesAgo(0),
      buckets: TRAFFIC_DAILY.map((calls, index) => ({
        day: dayUtc(TRAFFIC_DAILY.length - 1 - index),
        calls,
        byStatus: byStatus(calls, index === TRAFFIC_DAILY.length - 1 ? 9 : 0),
        /* No per-day latency source exists. Null, never a synthetic figure. */
        p50LatencyMs: null,
        p95LatencyMs: null,
      })),
      totalCalls: TRAFFIC_TOTAL,
      agentBreakdown: AGENT_CALLS.map((agent) => ({
        agentId: agent.agentId,
        calls: agent.calls,
        byStatus: byStatus(agent.calls),
      })),
    }),
  },
  {
    method: "GET",
    match: "/providers/me/quality",
    body: () => ({
      /*
        The three rates carry the registry snapshot's own rolling windows (24h
        for availability, 7d for quality) — they are NOT scoped by from/to.
      */
      paidQualityRate: 0.982,
      freeQualityRate: 0.9705,
      availabilityRate: 0.9991,
      from: minutesAgo(43200),
      to: minutesAgo(0),
      verdictMix: verdictMix(),
      totalCalls: TRAFFIC_TOTAL,
    }),
  },
  {
    method: "GET",
    match: "/providers/me/earnings",
    /* `asset` is a CAIP-19 the money columns are denominated in. Must win. */
    override: "always",
    body: () => ({
      groups: earningsGroups(),
      totals: earningsTotals(),
      asset: DEMO_ASSET,
    }),
  },

  // ── Reconciliation (the month's classes over the whole ledger) ───────────
  {
    method: "GET",
    match: "/providers/me/reconciliation",
    override: "always",
    body: () => {
      const totals = earningsTotals();
      const row = (cls: string, calls: number, credited: string | null, note: string) => ({
        class: cls,
        calls,
        share: calls / totals.calls,
        credited: credited === null ? null : money(credited),
        note,
      });
      return {
        from: minutesAgo(60 * 24 * 16),
        to: justNow(),
        asset: DEMO_ASSET,
        callCount: totals.calls,
        // Adds up to `earningsTotals`: 836 credited, 1 waiting on the buyer, 1 never collected,
        // 1 forfeited, 4 not credited (2 failed checks, 1 endpoint error, 1 refused request, as
        // in the per-call file), 8 free.
        classBreakdown: [
          row("PAID_CREDITED", 836, "181.44", "settled to you"),
          row("PAID_AWAITING_REDEMPTION", 0, "0", ""),
          row("PAID_BUYER_DEBT", 1, "0", "the buyer's payment could not be collected yet"),
          row("PAID_UNCOLLECTED", 1, "0", "the buyer never settled it"),
          row("PROVIDER_FORFEITED", 1, "0", "your stake was below the minimum"),
          row("PAID_UNCREDITED", 2, "0", "our checks rejected the response"),
          row("SYSTEM_ERROR", 1, "0", "your endpoint timed out or returned 5xx"),
          row("REQUEST_ERROR", 1, "0", "4xx from your endpoint"),
          row("FREE", 8, "0", "free-tier call"),
        ],
        unexplained: { calls: 0, reference: null },
        gross: money("201.60"),
        platformTakeRatePercent: 10,
        platformTake: totals.platformFee,
        net: totals.earned,
        batches: { count: 3, paid: totals.earned, reconciles: true },
      };
    },
  },

  // ── Payouts ──────────────────────────────────────────────────────────────
  {
    method: "GET",
    match: "/providers/me/payouts",
    /* `chainTxRef` is an EVM transaction hash here, never a base58 signature. */
    override: "always",
    body: () =>
      page([
        {
          id: "ple_5c81a04f",
          batchId: "pb_2026-09-16-08",
          amount: { ...money("52.18"), asset: DEMO_ASSET },
          chainTxRef: "0x58f09cc907edec4fd5fda8cf1d3a0f9f04661d42150a744ce90f20cf4171a71f",
          createdAt: minutesAgo(52),
        },
        {
          id: "ple_3d07f9b2",
          batchId: "pb_2026-09-15-19",
          amount: { ...money("64.91"), asset: DEMO_ASSET },
          chainTxRef: "0x1ef5cc71b2166cbfe9971f4bff054dda0d3d2bcfb71eb18aec2a7b0e32469391",
          createdAt: minutesAgo(1320),
        },
        {
          id: "ple_91e26cd7",
          batchId: "pb_2026-09-12-11",
          amount: { ...money("64.35"), asset: DEMO_ASSET },
          chainTxRef: "0x0555b7515f9639e142ee463706cefc42f8a8a9dad3b062c26b1675788ab5b2c2",
          createdAt: minutesAgo(6000),
        },
      ]),
  },

  // ── SLA windows ──────────────────────────────────────────────────────────
  {
    method: "GET",
    match: /^\/providers\/me\/sla-windows\/[^/]+\/evidence$/,
    override: "always",
    body: (path) => {
      const id = idIn(path, 3) ?? WINDOWS[0].windowId;
      const entry = windowFor(id);
      const binding = BINDINGS[entry.bindingIndex];
      const price = money(binding.priceMajor);
      const calls = [
        {
          verdict: "FAIL",
          reasonCode: "FRESHNESS_STALE",
          agentId: AGENT_CALLS[1].agentId,
          minutes: 96,
        },
        {
          verdict: "FAIL",
          reasonCode: "FRESHNESS_STALE",
          agentId: AGENT_CALLS[1].agentId,
          minutes: 141,
        },
        {
          verdict: "FAIL",
          reasonCode: "VALUE_RANGE_OUT_OF_BOUNDS",
          agentId: AGENT_CALLS[4].agentId,
          minutes: 228,
        },
        { verdict: "PASS", reasonCode: null, agentId: AGENT_CALLS[0].agentId, minutes: 305 },
        { verdict: "PASS", reasonCode: null, agentId: AGENT_CALLS[2].agentId, minutes: 388 },
        { verdict: "UNVERIFIED", reasonCode: null, agentId: AGENT_CALLS[3].agentId, minutes: 452 },
      ].map((call, index) => ({
        intentId: `pi_${entry.label}_${index + 1}`,
        agentId: call.agentId,
        verdict: call.verdict,
        reasonCode: call.reasonCode,
        countedAsQuality: call.verdict === "PASS" || call.verdict === "FAIL",
        countedAsFailure: call.verdict === "FAIL",
        priceAmount: price.amount,
        assetId: DEMO_ASSET,
        postedAt: minutesAgo(call.minutes),
      }));

      return {
        ...slaWindow(entry, id),
        calls,
        /* Both breakdowns sum to the window's own failure count. */
        failuresByReasonCode: splitFailures(entry.failedCalls, [0.72, 0.19, 0.09])
          .map((count, index) => ({
            key: ["FRESHNESS_STALE", "VALUE_RANGE_OUT_OF_BOUNDS", "REQUIRED_FIELDS_MISSING"][index],
            count,
          }))
          .filter((row) => row.count > 0),
        failuresByAgentId: splitFailures(entry.failedCalls, [0.62, 0.24, 0.14])
          .map((count, index) => ({ key: [AGENT_CALLS[1], AGENT_CALLS[4], AGENT_CALLS[2]][index].agentId, count }))
          .filter((row) => row.count > 0),
      };
    },
  },
  {
    method: "GET",
    match: /^\/providers\/me\/sla-windows\/[^/]+$/,
    override: "always",
    body: (path) => {
      const id = idIn(path, 3) ?? WINDOWS[0].windowId;
      const entry = windowFor(id);
      const binding = BINDINGS[entry.bindingIndex];
      const observed = entry.verifiedCalls === 0 ? 0 : entry.failedCalls / entry.verifiedCalls;
      const projectedSample =
        entry.status === "OPEN" ? entry.verifiedCalls + 180 : entry.verifiedCalls;
      const thresholdAtClose = binding.slaFailureRate + 0.0181;
      const errorBudget = Math.round(projectedSample * thresholdAtClose);
      const breach = observed > thresholdAtClose;

      return {
        ...slaWindow(entry, id),
        state:
          entry.verifiedCalls < entry.minVerifiedCalls
            ? "BELOW_SAMPLE_GATE"
            : breach
              ? "PROJECTED_BREACH"
              : "WITHIN_SLA",
        slashable: entry.verifiedCalls >= entry.minVerifiedCalls,
        confidenceInterval: interval(observed, 0.0142),
        projectedSampleAtClose: projectedSample,
        effectiveThresholdAtClose: thresholdAtClose,
        toleranceAtClose: 0.0181,
        errorBudgetCalls: errorBudget,
        errorBudgetUsedCalls: entry.failedCalls,
        errorBudgetRemainingCalls: Math.max(0, errorBudget - entry.failedCalls),
        errorBudgetUsedFraction: errorBudget === 0 ? null : entry.failedCalls / errorBudget,
        projectedFailureRate: observed,
        projectedFailedCalls: Math.round(projectedSample * observed),
        projectedBreach: breach,
        confidentlyAboveDeclared: breach,
      };
    },
  },
  {
    method: "GET",
    match: "/providers/me/sla-windows",
    override: "always",
    body: (_path, query) => {
      const bindingId = typeof query.bindingId === "string" ? query.bindingId : null;
      const status = typeof query.status === "string" ? query.status : null;
      const limit = Number(query.limit) || WINDOWS.length;
      return page(
        [...WINDOWS]
          .filter((entry) => !bindingId || BINDINGS[entry.bindingIndex].id === bindingId)
          .filter((entry) => !status || entry.status === status)
          .sort((a, b) => a.openedMinutesAgo - b.openedMinutesAgo)
          .slice(0, limit)
          .map((entry) => slaWindow(entry)),
      );
    },
  },
  {
    method: "GET",
    match: /^\/providers\/me\/bindings\/[^/]+\/sla$/,
    body: (path) => {
      const binding = bindingFor(idIn(path, 3));
      const open = WINDOWS.find(
        (entry) => entry.status === "OPEN" && BINDINGS[entry.bindingIndex].id === binding.id,
      );
      const closed = WINDOWS.filter(
        (entry) => entry.status === "CLOSED" && BINDINGS[entry.bindingIndex].id === binding.id,
      );
      const verifiedCalls = closed.reduce((total, entry) => total + entry.verifiedCalls, 0);
      const failedCalls = closed.reduce((total, entry) => total + entry.failedCalls, 0);
      const observed = verifiedCalls === 0 ? null : failedCalls / verifiedCalls;

      return {
        bindingId: binding.id,
        toolId: binding.toolId,
        currentDeclaredFailureRate: binding.slaFailureRate,
        inFlightWindow: open
          ? {
              windowId: open.windowId,
              label: open.label,
              declaredFailureRate: binding.slaFailureRate,
              openedAt: minutesAgo(open.openedMinutesAgo),
              verifiedCalls: open.verifiedCalls,
            }
          : null,
        measured:
          verifiedCalls === 0
            ? null
            : {
                verifiedCalls,
                failedCalls,
                observedFailureRate: observed,
                confidenceInterval: interval(observed ?? 0, 0.0139),
              },
        effectiveThreshold: binding.slaFailureRate + 0.0181,
        minVerifiedCalls: 200,
        /* Cross-organization aggregates only — never another provider's name. */
        peers: { median: 0.0241, p90: 0.0688, rank: 3, count: 17 },
      };
    },
  },

  // ── Verdicts and the call-level evidence pack ────────────────────────────
  {
    method: "GET",
    match: /^\/providers\/me\/verdicts\/[^/]+\/evidence$/,
    body: (path) => {
      const id = idIn(path, 3) ?? VERDICTS[0].id;
      const entry = verdictFor(id);
      const binding = BINDINGS[entry.bindingIndex];
      const failed = entry.verdictStatus === "FAIL";
      return {
        id,
        intentId: `pi_${id.slice(0, 8)}`,
        toolId: binding.toolId,
        request: { method: "GET", url: `${binding.endpoint}?q=ETH-USD&limit=25` },
        response: {
          data: { symbol: "ETH-USD", last: 3184.22, ts: minutesAgo(entry.minutes + 41) },
        },
        stageResults: stageResults(entry).map((stage) => ({
          stage: stage.stage,
          status: stage.status,
          code: stage.code,
          detail: stage.detail,
          score: stage.score,
          ...(stage.stage === "DETERMINISTIC_RULES" ? { rules: evidenceRules(failed) } : {}),
        })),
        sampling: {
          sampleRate: 0.25,
          sampled: entry.verdictStatus !== "SKIPPED",
          sampleSelector: 0.1834,
          sampleDisplay: "0.1834 < 0.2500 → sampled",
        },
        pinnedPolicy: {
          policyId: `pol_${binding.toolId.replace(/-/g, "_")}_v3`,
          policyVersion: 3,
          lifecycle: "ACTIVE",
          decisionDocument: {
            threshold: 0.7,
            clauses: [
              { trigger: "FAILURES_AT_LEAST", value: 1, label: "any deterministic rule failed" },
            ],
          },
          verificationDocument: { stages: ["SCHEMA", "DETERMINISTIC_RULES", "CROSS_CHECK"] },
        },
        evaluatedAt: minutesAgo(entry.minutes - 1),
        integrity: {
          sealed: true,
          contentHash: "9f2a54c1d83b60e7452ac917fb0d3e8c6a15720d94fe3b81c05da76e2f4b19c3",
          sealedAt: minutesAgo(entry.minutes - 1),
          bodyState: "RAW",
        },
        bodyDigests: {
          request: "sha256:c41d09b7e5a23f680d57192ba4c0e8f36d295a71b0834ef9c6152da70e483b7d",
          response: "sha256:2b70e5c81f34a96d0d8271b5e4a03cf69d158e720b4a3fc85169d02e7c3ba418",
        },
      };
    },
  },
  {
    method: "GET",
    match: /^\/providers\/me\/verdicts\/[^/]+$/,
    body: (path) => {
      const id = idIn(path, 3) ?? VERDICTS[0].id;
      const entry = verdictFor(id);
      const binding = BINDINGS[entry.bindingIndex];
      const refunded = entry.outcome === "REFUND";
      const free = binding.pricingMode === "FREE";
      const providerAmount = money(free ? "0" : "0.405");
      const platformFee = money(free ? "0" : "0.045");

      return {
        id,
        intentId: `pi_${id.slice(0, 8)}`,
        toolId: binding.toolId,
        state: "SETTLED",
        verdictStatus: entry.verdictStatus,
        reasonCode: entry.reasonCode,
        reason: entry.reason,
        score: entry.score,
        stageResults: stageResults(entry),
        verifiers: [
          {
            verifierId: "det.freshness",
            outcome: entry.verdictStatus === "FAIL" ? "FAIL" : "PASS",
            code: entry.verdictStatus === "FAIL" ? "FRESHNESS_STALE" : null,
            detail: entry.reason,
            score: entry.verdictStatus === "FAIL" ? 0 : 1,
            costUsd: 0,
            stage: "DETERMINISTIC_RULES",
          },
          {
            verifierId: "det.required-fields",
            outcome: "PASS",
            code: null,
            detail: null,
            score: 1,
            costUsd: 0,
            stage: "DETERMINISTIC_RULES",
          },
          {
            verifierId: "xcheck.second-source",
            outcome: entry.verdictStatus === "FAIL" ? "ABSTAIN" : "PASS",
            code: null,
            detail: null,
            score: entry.verdictStatus === "FAIL" ? null : 0.96,
            costUsd: 0.0004,
            stage: "CROSS_CHECK",
          },
        ],
        tally: {
          declared: 3,
          votes: 3,
          passed: entry.verdictStatus === "FAIL" ? 1 : 3,
          failed: entry.verdictStatus === "FAIL" ? 1 : 0,
          misapplied: 0,
          unavailable: 0,
          abstained: entry.verdictStatus === "FAIL" ? 1 : 0,
          failedFraction: entry.verdictStatus === "FAIL" ? 1 / 3 : 0,
          unregistered: 0,
        },
        decidedBy:
          entry.verdictStatus === "FAIL"
            ? {
                clauseIndex: 0,
                trigger: "FAILURES_AT_LEAST",
                label: "any deterministic rule failed",
              }
            : { clauseIndex: null, trigger: null, label: null },
        policyId: `pol_${binding.toolId.replace(/-/g, "_")}_v3`,
        policyVersion: 3,
        decisionPolicyId: `dec_${binding.toolId.replace(/-/g, "_")}_v3`,
        decisionPolicyVersion: 3,
        lifecycle: "ACTIVE",
        sampled: entry.verdictStatus !== "SKIPPED",
        sampleRate: 0.25,
        sampleDisplay: "0.1834 < 0.2500 → sampled",
        evaluatedAt: minutesAgo(entry.minutes - 1),
        createdAt: minutesAgo(entry.minutes),
        consequence: {
          settlementOutcome: entry.outcome,
          settledAt: minutesAgo(entry.minutes - 2),
          intentStatus: refunded ? "REFUNDED" : "SETTLED",
          /* `strike` is `settlementOutcome === 'REFUND'`, exactly. */
          strike: refunded,
          price: money(binding.priceMajor),
          providerAmount,
          platformFee,
          settledAmount: refunded ? money("0") : providerAmount,
        },
        evidenceUrl: `/providers/me/verdicts/${id}/evidence`,
      };
    },
  },
  {
    method: "GET",
    match: "/providers/me/verdicts",
    body: () => page(VERDICTS.map(verdictListItem)),
  },

  // ── Policy changes ───────────────────────────────────────────────────────
  {
    method: "GET",
    match: "/providers/me/policy-changes",
    body: () => [
      {
        toolId: BINDINGS[1].toolId,
        policyId: "pol_fx_rates_v4",
        pendingVersion: 4,
        pendingLifecycle: "SHADOW",
        inForcePolicyId: "pol_fx_rates_v3",
        inForceVersion: 3,
        /* No column records when a SHADOW version takes effect. Always null. */
        effectiveDate: null,
        bindings: [{ bindingId: BINDINGS[1].id, status: BINDINGS[1].status }],
        diff: [
          { path: "$.threshold", changeType: "changed", before: 0.65, after: 0.7 },
          { path: "$.clauses[0].value", changeType: "changed", before: 2, after: 1 },
          {
            path: "$.verifiers[2]",
            changeType: "added",
            after: { verifierId: "xcheck.second-source", weight: 0.2 },
          },
        ],
      },
    ],
  },

  // ── Slash proposal and disputes ──────────────────────────────────────────
  {
    method: "GET",
    match: /^\/providers\/me\/slash-proposals\/[^/]+\/timeline$/,
    body: (path) => {
      const facts = caseFacts(idIn(path, 3));
      const { subject } = facts;
      const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
      const events: { id: string; occurredAt: string; kind: string; actorType: string; actorId: string | null; summary: string; detail: object }[] = [
        {
          id: "ev_1",
          occurredAt: minutesAgo(subject.closedMinutesAgo ?? 0),
          kind: "WINDOW_CLOSED",
          actorType: "system",
          actorId: null,
          summary: `${subject.label} closed · ${subject.failedCalls} failed of ${subject.verifiedCalls} verified · ${pct(facts.observed)} against your declared ${pct(facts.declared)}`,
          detail: {},
        },
        {
          id: "ev_2",
          occurredAt: minutesAgo(facts.proposedMinutesAgo),
          kind: "PROPOSED",
          actorType: "system",
          actorId: null,
          summary: `penalty proposed · ${usd(facts.amount)}`,
          detail: {},
        },
        {
          id: "ev_3",
          occurredAt: minutesAgo(facts.proposedMinutesAgo - 12),
          kind: "NOTIFIED",
          actorType: "system",
          actorId: null,
          summary: "delivery confirmed by email · your response clock started here",
          detail: {},
        },
      ];
      if (facts.which === 1) {
        events.push(
          {
            id: "ev_4",
            occurredAt: minutesAgo(4380),
            kind: "ACKNOWLEDGED",
            actorType: "provider",
            actorId: CONSOLE_CREDENTIAL,
            summary: "acknowledged · this moves no clock",
            detail: {},
          },
          {
            id: "ev_5",
            occurredAt: minutesAgo(4320),
            kind: "DISPUTE_FILED",
            actorType: "provider",
            actorId: CONSOLE_CREDENTIAL,
            summary: "disputed on chain by your stake wallet",
            detail: {},
          },
          {
            id: "ev_6",
            occurredAt: minutesAgo(2880),
            kind: "REVIEW_ASSIGNED",
            actorType: "operator",
            actorId: "op_4d17",
            summary: "reviewer assigned · we respond by the platform deadline on this case",
            detail: {},
          },
        );
      }
      if (facts.which === 2) {
        events.push({
          id: "ev_4",
          occurredAt: minutesAgo(10500),
          kind: "EXECUTED",
          actorType: "system",
          actorId: null,
          summary: `penalty taken from stake · ${usd(facts.amount)}`,
          detail: {},
        });
      }
      return {
        events,
        restoration: [
          { label: "Penalty", value: usd(facts.amount), status: facts.which === 2 ? "NOT_APPLICABLE" : "ON_DECISION" },
          { label: "Stake", value: facts.which === 2 ? `${usd(facts.amount)} taken` : "$600.00 untouched", status: "NOT_APPLICABLE" },
          { label: "Routing", value: "unaffected throughout", status: "NOT_APPLICABLE" },
          { label: "Window record", value: `${subject.label} annotated`, status: facts.which === 2 ? "NOT_APPLICABLE" : "ON_DECISION" },
        ],
      };
    },
  },
  {
    method: "GET",
    match: /^\/providers\/me\/slash-proposals\/[^/]+$/,
    body: (path) => {
      const proposalId = idIn(path, 3) ?? PROPOSAL_ID;
      const facts = caseFacts(proposalId);
      const { subject, binding } = facts;
      const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
      const gross = Number(binding.priceMajor) * subject.totalCalls;
      const ceiling = Math.max(5, 100 * Number(binding.priceMajor));
      const prior = WINDOWS.filter(
        (entry) =>
          entry.bindingIndex === subject.bindingIndex &&
          entry.status === "CLOSED" &&
          (entry.closedMinutesAgo ?? 0) >= (subject.closedMinutesAgo ?? 0),
      ).sort((x, y) => (y.closedMinutesAgo ?? 0) - (x.closedMinutesAgo ?? 0));
      return {
        proposal: slashProposalSummary(proposalId),
        changeOverlay: null,
        failuresByAgent: facts.byAgent,
        failuresByRule: facts.byRule,
        evidenceVerdictCount: subject.verifiedCalls,
        suggestedClaim: facts.which === 1 ? "AGENT_GRIEFING" : null,
        inaction: {
          executesAt: inMinutes(facts.which === 0 ? 3120 : 2520),
          stakeBefore: money("600.00"),
          /* 90% of a penalty leaves the stake (60% buyers, 30% Assay); 10% is never taken. */
          stakeAfter: money((600 - Number(facts.amount) * 0.9).toFixed(6)),
          minimumRequired: money("450.00"),
          fallsBelowMinimum: false,
          graceHours: null,
          projectedRestoreHours: null,
          /* Routing is unaffected by a proposal. The server states it anyway. */
          routingContinues: true,
        },
        arithmetic: [
          {
            key: "verified_calls",
            expression: `${subject.verifiedCalls} verified of ${subject.totalCalls} posted`,
            value: String(subject.verifiedCalls),
            note: `above the ${subject.minVerifiedCalls}-call sample gate`,
            tone: "NEUTRAL",
          },
          {
            key: "observed_rate",
            expression: `${subject.failedCalls} failed / ${subject.verifiedCalls} verified`,
            value: pct(facts.observed),
            note: `observed ${pct(facts.observed)} > ${pct(facts.threshold)} → breach`,
            tone: "BAD",
          },
          {
            key: "declared_rate",
            expression: null,
            value: pct(facts.declared),
            note: "frozen when the window opened",
            tone: "NEUTRAL",
          },
          {
            key: "effective_threshold",
            expression: `${pct(facts.declared)} + 2.58 × sqrt(p(1−p)/${subject.verifiedCalls})`,
            value: pct(facts.threshold),
            note: null,
            tone: "NEUTRAL",
          },
          {
            key: "penalty",
            expression: `${usd(gross.toFixed(2))} of calls × (${pct(facts.observed)} − ${pct(facts.declared)}) × 2, at most ${usd(ceiling.toFixed(2))}`,
            value: usd(facts.amount),
            note: "under the per-window ceiling",
            tone: "BAD",
          },
        ],
        priorWindows: prior.map((entry) => ({
          windowId: entry.windowId,
          label: entry.label,
          observedRate: entry.verifiedCalls === 0 ? 0 : entry.failedCalls / entry.verifiedCalls,
          closedAt: minutesAgo(entry.closedMinutesAgo ?? 0),
          isSubject: entry.windowId === subject.windowId,
        })),
      };
    },
  },
  {
    method: "GET",
    match: /^\/disputes\/[^/]+$/,
    body: (path) => disputeRow(idIn(path, 1) ?? DISPUTE_ID),
  },
  {
    method: "GET",
    match: "/disputes",
    body: () =>
      page([
        disputeRow(DISPUTE_ID),
        {
          id: "8d3b61f0-27ac-4e95-b104-5f9c2e8a3d76",
          subjectType: "VERDICT",
          subjectId: VERDICTS[1].id,
          providerId: PROVIDER_ID,
          state: "UPHELD",
          claimType: "POLICY_DEFECT",
          reason:
            "The freshness rule read an offset-less timestamp as local time. The upstream field is UTC.",
          evidence: [],
          openedBy: CONSOLE_CREDENTIAL,
          acknowledgedAt: minutesAgo(20160),
          deadlineAt: minutesAgo(15840),
          resolvedAt: minutesAgo(14400),
          resolvedBy: "op_4d17",
          resolutionNote: "Upheld. The rule was corrected and the call was re-settled.",
          restoredAmount: money("0.405"),
          createdAt: minutesAgo(20220),
          updatedAt: minutesAgo(14400),
        },
      ]),
  },

  // ── Tool requests ────────────────────────────────────────────────────────
  {
    method: "GET",
    match: /^\/tool-requests\/[^/]+$/,
    body: (path) => ({
      id: idIn(path, 1) ?? "6b1d907c-42e5-4a38-9f07-c3e18b0d5246",
      title: "Port congestion index",
      description:
        "A per-port queue depth and median wait, refreshed hourly. We already serve the raw AIS feed behind vessel-positions and can derive this without a new upstream.",
      upstreamUrl: `${API_HOST}/v1/ports/congestion`,
      expectedMonthlyCalls: 90000,
      status: "ACKNOWLEDGED",
      ownerOperatorId: "op_4d17",
      firstResponseDueAt: minutesAgo(1440),
      firstRespondedAt: minutesAgo(2160),
      resolutionNote: null,
      closedAt: null,
      createdAt: minutesAgo(5760),
    }),
  },
  {
    method: "GET",
    match: "/tool-requests",
    body: () =>
      page([
        {
          id: "9a2e51d0-7c43-4b8e-a1f6-3d5c0b9e8a12",
          title: "Tide predictions",
          description: "Returns: high and low tide times and heights for a port.",
          upstreamUrl: null,
          expectedMonthlyCalls: 20000,
          status: "OPEN",
          ownerOperatorId: null,
          firstResponseDueAt: minutesAgo(-1900),
          firstRespondedAt: null,
          resolutionNote: null,
          closedAt: null,
          createdAt: minutesAgo(980),
        },
        {
          id: "6b1d907c-42e5-4a38-9f07-c3e18b0d5246",
          title: "Port congestion index",
          description:
            "A per-port queue depth and median wait, refreshed hourly. We already serve the raw AIS feed behind vessel-positions.",
          upstreamUrl: `${API_HOST}/v1/ports/congestion`,
          expectedMonthlyCalls: 90000,
          status: "ACKNOWLEDGED",
          ownerOperatorId: "op_4d17",
          firstResponseDueAt: minutesAgo(1440),
          firstRespondedAt: minutesAgo(2160),
          resolutionNote: null,
          closedAt: null,
          createdAt: minutesAgo(5760),
        },
        {
          id: "0e74c3a9-8b12-4d60-a597-2f6b8e01c43d",
          title: "Settlement-day FX fixing",
          description: "The 16:00 London fixing for the eight majors, as a single call.",
          upstreamUrl: `${API_HOST}/v1/fx/fixing`,
          expectedMonthlyCalls: 12000,
          status: "ACCEPTED",
          ownerOperatorId: "op_9c02",
          firstResponseDueAt: minutesAgo(27360),
          firstRespondedAt: minutesAgo(28080),
          resolutionNote: "Accepted. Shipped in the catalogue as fx-fixing; bind it when ready.",
          closedAt: minutesAgo(21600),
          createdAt: minutesAgo(30240),
        },
      ]),
  },

  // `/notifications` is shared with the buyer console and the buyer fixtures
  // answer it first; `fixtures.ts` routes the provider Inbox's read (it asks
  // for `provider.*` events) to `providerNotifications()` below instead.
  {
    method: "GET",
    match: /^\/agents\/[^/]+\/credentials$/,
    body: (path) => {
      const agentId = idIn(path, 1) ?? "agent";
      return page([
        {
          id: CONSOLE_CREDENTIAL,
          agentId,
          name: "console",
          prefix: "assay_pk_8f3a",
          scopes: [],
          lastUsedAt: minutesAgo(18),
          expiresAt: null,
          revokedAt: null,
          createdAt: minutesAgo(64740),
        },
        {
          id: "cred_51b9e207",
          agentId,
          name: "ci-deploy",
          prefix: "assay_pk_51b9",
          scopes: [],
          lastUsedAt: minutesAgo(2160),
          expiresAt: inMinutes(129600),
          revokedAt: null,
          createdAt: minutesAgo(30240),
        },
      ]);
    },
  },
  {
    method: "GET",
    match: "/agents",
    /* `agentAccount` is a CAIP-10 and must name 46630, not a Solana cluster. */
    override: "always",
    body: () =>
      page([
        {
          agentId: "b5e21f84-0c37-4d96-a1e8-73d0c95f26ba",
          label: "harborlight-console",
          agentAccount: `${DEMO_CHAIN_ID}:0x2B6f18C05aD37e94b1C8f0E5a7D3629c4F81b0eA`,
        },
      ]),
  },
];

/**
 * The provider Inbox's notices — provider events only, about the same cases
 * and windows the other screens show: the penalty that needs action (also
 * counted by the Needs action strip, so the badge counts it once), a warning
 * on FX rates' open window, and the executed penalty, already read.
 */
export function providerNotifications() {
  const pending = WINDOWS[DEMO_PENALTY_SUBJECTS[0].windowIndex];
  const pendingBinding = BINDINGS[DEMO_PENALTY_SUBJECTS[0].bindingIndex];
  const fx = BINDINGS[1];
  const fxOpen = WINDOWS.find((entry) => entry.status === "OPEN" && entry.bindingIndex === 1)!;
  const executed = BINDINGS[DEMO_PENALTY_SUBJECTS[2].bindingIndex];
  const pct = (value: number) => `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
  return page([
    {
      id: "ntf_9a41c0",
      event: "provider.slash_proposed",
      severity: "CRITICAL",
      title: `A penalty of ${usd(DEMO_PENALTY_AMOUNTS[0])} is proposed on ${pendingBinding.toolName}`,
      body: `${pending.failedCalls} of ${pending.verifiedCalls} checked calls failed (${pct(pending.failedCalls / pending.verifiedCalls)}) against your promised ${pct(pendingBinding.slaFailureRate)}. Dispute it before the deadline if you think it is wrong.`,
      subjectType: "slash_proposal",
      subjectId: DEMO_PENALTY_PROPOSALS[0],
      readAt: null,
      createdAt: minutesAgo(1190),
    },
    {
      id: "ntf_2f80b7",
      event: "provider.sla_window_warning",
      severity: "WARNING",
      title: `${fx.toolName} is past half of its promised failure rate`,
      body: `${fxOpen.failedCalls} of ${fxOpen.verifiedCalls} checked calls failed this window (${pct(fxOpen.failedCalls / fxOpen.verifiedCalls)}) against your promised ${pct(fx.slaFailureRate)}. Nothing is taken unless the window closes over the promise.`,
      subjectType: "binding",
      subjectId: fx.id,
      readAt: null,
      createdAt: minutesAgo(300),
    },
    {
      id: "ntf_7c13e5",
      event: "provider.slash_executed",
      severity: "INFO",
      title: `A penalty of ${usd(DEMO_PENALTY_AMOUNTS[2])} on ${executed.toolName} was taken from your stake`,
      body: "The dispute window closed with no dispute. Buyers whose calls failed were paid from it.",
      subjectType: "slash_execution",
      subjectId: DEMO_PENALTY_PROPOSALS[2],
      readAt: minutesAgo(10200),
      createdAt: minutesAgo(10500),
    },
  ]);
}
