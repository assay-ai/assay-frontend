import {
  DEMO_ASSET,
  DEMO_BUYER_ACCOUNT,
  DEMO_CHAIN_ID,
  minutesAgo,
  money,
  type DemoFixture,
} from "./fixtures";

/**
 * DEMO ONLY — see `demo-api.ts` for the rules. The buyer surface.
 *
 * One account's September on Robinhood Chain testnet: a pilot that restarted
 * seven days ago and has run 53 calls across five tools since, three of which
 * were not charged, five of which are still in flight, against a $250 deposit
 * two days ago. Every screen from `/overview` to `/funding/escrow` draws from
 * the tables below, so a figure a viewer reads twice reads the same twice —
 * the held total on `/overview` is the sum of the holds on `/funding`, which
 * is the sum of the five in-flight calls in `/tool-calls`, which is the `held`
 * on the `/balances` fixture in `fixtures.ts` (482.15 available, 17.85 held,
 * 500.00 total).
 *
 * ## The aggregates are computed, not typed in
 *
 * `body` receives the request's query, so `/receipts/summary` and `/withheld`
 * answer the window they were actually asked about. Both are folded out of one
 * day-by-day model ({@link WEEK} and {@link PAST_CYCLES}) rather than written
 * out per screen, which is what makes three otherwise unrelated promises hold
 * at once:
 *
 *  - the rows in a response always sum to that response's own totals, whatever
 *    the grouping, because both come from the same fold;
 *  - a day, a week and a month are three different answers — the `/overview`
 *    chart draws seven different bars and `/guarantee` prints three different
 *    months;
 *  - `/withheld` for a window equals that window's `withheldTotal`, so the
 *    guarantee's hero figure agrees with its own table for every month.
 *
 * The model has no activity in the current month before the pilot week, which
 * is deliberate and is what pins the two figures other fixtures state as
 * constants: month-to-date charged is exactly the week's 127.15 (the Limits
 * screen's usage block) and month-to-date withheld is exactly 10.85 (the
 * guarantee's hero).
 *
 * ## Every list is one complete page
 *
 * `pageInfo.hasMore` is always false: `useGuarantee` walks a cursor until a
 * page says it is the last one, and a fixture that claimed another page would
 * be walked ten times for the same rows and fold them ten times over.
 *
 * Addresses are EVM (`0x…`) and the chain is `eip155:46630` throughout — this
 * account has never touched any other chain.
 */

/* ------------------------------------------------------------------- tools */

/**
 * The five tools this account calls, with the price each one lists.
 *
 * The ids are the ids: no buyer endpoint resolves a tool id to a name, so
 * every screen prints whatever is here, and `groupKeyLabel` truncates anything
 * over twelve characters.
 */
const TOOLS = {
  deep_search: { provider: "prv_searchly", price: "6.00" },
  ocr_extract: { provider: "prv_ocrlab", price: "4.50" },
  kyc_lookup: { provider: "prv_veritas", price: "3.60" },
  price_quote: { provider: "prv_quotes", price: "2.50" },
  geocode: { provider: "prv_geomap", price: "1.25" },
} as const;

type ToolId = keyof typeof TOOLS;

const TOOL_IDS = Object.keys(TOOLS) as ToolId[];

/* ------------------------------------------------------------------- calls */

interface DemoCall {
  readonly intentId: string;
  readonly toolId: ToolId;
  readonly minutesAgo: number;
  /** Major units. `"0"` on every call that was not charged. */
  readonly charged: string;
  readonly status: string;
  /** `null` while the call is still in flight — the wire's own value there. */
  readonly verdict: string | null;
  readonly classification: string | null;
  /** Set only on a call that was not charged; `/guarantee` folds by this. */
  readonly reasonCode: string | null;
  readonly score: number | null;
}

/**
 * The recent calls, newest first.
 *
 * The first five are in flight and are the five open holds — one call of each
 * tool, 6.00 + 4.50 + 3.60 + 2.50 + 1.25 = 17.85, which is the `held` figure on
 * `/balances`.
 *
 * The next six are today's finished calls and are **the same six calls as
 * today's row in the day model**: one `ocr_extract`, four `price_quote`, one
 * `geocode`, 15.75 charged. Counting the rows on `/overview` and reading the
 * "Today" tile above them has to give the same answer.
 *
 * The last three are the three that were not charged — 6.00 + 1.25 + 3.60 =
 * 10.85, the `/withheld` total for the month. They sit 26 to 40 hours back so
 * that they land on the two days the model marks as having refunds, whatever
 * hour of the day the demo is given at.
 */
const CALLS: readonly DemoCall[] = [
  {
    intentId: "c7f1a2d4-3b90-4e51-9a8c-2f6b18d40e11",
    toolId: "deep_search",
    minutesAgo: 2,
    charged: "0",
    status: "VERIFYING",
    verdict: null,
    classification: null,
    reasonCode: null,
    score: null,
  },
  {
    intentId: "41b8e6c0-77d2-4a35-bd1e-58a0c93f7d62",
    toolId: "ocr_extract",
    minutesAgo: 9,
    charged: "0",
    status: "PROVIDER_EXECUTING",
    verdict: null,
    classification: null,
    reasonCode: null,
    score: null,
  },
  {
    intentId: "9e2c5b7a-1f44-4d08-8c63-7ab9e0d21c45",
    toolId: "kyc_lookup",
    minutesAgo: 26,
    charged: "0",
    status: "VERIFYING",
    verdict: null,
    classification: null,
    reasonCode: null,
    score: null,
  },
  {
    intentId: "2d6f8a13-5c07-49be-a1d2-90e4b7c53f88",
    toolId: "price_quote",
    minutesAgo: 41,
    charged: "0",
    status: "FUNDS_SECURED",
    verdict: null,
    classification: null,
    reasonCode: null,
    score: null,
  },
  {
    intentId: "6b0d47e9-8a52-4c1f-93b7-14ce2f60a7d3",
    toolId: "geocode",
    minutesAgo: 58,
    charged: "0",
    status: "PROVIDER_EXECUTING",
    verdict: null,
    classification: null,
    reasonCode: null,
    score: null,
  },
  {
    intentId: "f3a9c15e-24b8-4f70-8de1-6c05b39a72f4",
    toolId: "price_quote",
    minutesAgo: 78,
    charged: "2.50",
    status: "SETTLED",
    verdict: "PASS",
    classification: "DATA_RESULT",
    reasonCode: null,
    score: 0.96,
  },
  {
    intentId: "8c47b0d2-9e36-4a15-b7f8-03d1e5c86a29",
    toolId: "geocode",
    minutesAgo: 96,
    charged: "1.25",
    status: "SETTLED",
    verdict: "PASS",
    classification: "DATA_RESULT",
    reasonCode: null,
    score: 0.94,
  },
  {
    intentId: "5a1e93f7-6d20-4bc8-91a4-e78c0b25d36f",
    toolId: "ocr_extract",
    minutesAgo: 120,
    charged: "4.50",
    status: "SETTLED",
    verdict: "SKIPPED",
    classification: "DATA_RESULT",
    reasonCode: null,
    score: null,
  },
  {
    intentId: "71c6d85b-0f92-4a3e-b46c-9d8e13f5a204",
    toolId: "price_quote",
    minutesAgo: 155,
    charged: "2.50",
    status: "SETTLED",
    verdict: "PASS",
    classification: "DATA_RESULT",
    reasonCode: null,
    score: 0.93,
  },
  {
    intentId: "3f75e2a8-1b4c-49d7-a05e-8c6b91d37f20",
    toolId: "price_quote",
    minutesAgo: 190,
    charged: "2.50",
    status: "SETTLED",
    verdict: "PASS",
    classification: "DATA_RESULT",
    reasonCode: null,
    score: 0.97,
  },
  {
    intentId: "a62b9d04-5e18-4c73-9f2a-7d03e8b15c96",
    toolId: "price_quote",
    minutesAgo: 230,
    charged: "2.50",
    status: "SETTLED",
    verdict: "DEGRADED",
    classification: "DATA_RESULT",
    reasonCode: null,
    score: 0.71,
  },
  {
    intentId: "b90f2c48-3a71-4e69-85d0-2f4a6c19e7b5",
    toolId: "deep_search",
    minutesAgo: 1560,
    charged: "0",
    status: "REFUNDED",
    verdict: "FAIL",
    classification: "EMPTY_RESULT",
    reasonCode: "insufficient_results",
    score: 0.22,
  },
  {
    intentId: "0d83f6b2-4a95-4e1c-87d6-b21c5f70e9a8",
    toolId: "geocode",
    minutesAgo: 1800,
    charged: "0",
    status: "REFUNDED",
    verdict: "FAIL",
    classification: "DATA_RESULT",
    reasonCode: "stale_data",
    score: 0.34,
  },
  {
    /*
      Classified SYSTEM_ERROR, so the receipt screen draws the "The tool did not
      respond" card — and it still carries a verdict row with a reason, which is
      what puts its 3.60 in the guarantee's "Why calls failed" table instead of
      leaving that table short of the headline figure.
    */
    intentId: "e48a3b19-7c65-4d02-8f1b-5a97c2e04d63",
    toolId: "kyc_lookup",
    minutesAgo: 2400,
    charged: "0",
    status: "REFUNDED",
    verdict: "FAIL",
    classification: "SYSTEM_ERROR",
    reasonCode: "upstream_unavailable",
    score: null,
  },
];

const IN_FLIGHT_STATUS = new Set(["CREATED", "FUNDS_SECURED", "PROVIDER_EXECUTING", "VERIFYING"]);

function inFlight(call: DemoCall): boolean {
  return IN_FLIGHT_STATUS.has(call.status);
}

function listedPrice(call: DemoCall): string {
  return TOOLS[call.toolId].price;
}

function providerOf(call: DemoCall): string {
  return TOOLS[call.toolId].provider;
}

/** listed − charged, in major units, as a string — never a float on the wire. */
function notChargedMajor(call: DemoCall): string {
  const minor = Math.round(Number(listedPrice(call)) * 1e6) - Math.round(Number(call.charged) * 1e6);
  return (minor / 1e6).toFixed(2);
}

/** The verdict id derived from the intent — the receipt screen resolves one from the other. */
function verdictIdOf(call: DemoCall): string {
  return `ver_${call.intentId.slice(0, 8)}`;
}

function findCallByIntent(intentId: string): DemoCall {
  return CALLS.find((call) => call.intentId === intentId) ?? CALLS[0];
}

function findCallByVerdict(verdictId: string): DemoCall {
  return CALLS.find((call) => verdictIdOf(call) === verdictId) ?? CALLS[5];
}

/**
 * Whether a call falls inside `[fromMs, toMs)`.
 *
 * The call list and the verdict feed are windowed like the aggregates are, so
 * picking August on `/guarantee` does not fold September's failure reasons
 * under an August headline figure. It answers nothing for a month this table
 * does not reach, which is the truth: these fourteen rows are the recent ones.
 */
function withinWindow(call: DemoCall, fromMs: number, toMs: number): boolean {
  const at = Date.now() - call.minutesAgo * 60_000;
  return at >= fromMs && at < toMs;
}

/** The last path segment, or the one before `/evidence` — ids only, never a query. */
function segment(path: string, fromEnd = 0): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1 - fromEnd] ?? "";
}

/* --------------------------------------------------------- the day model */

/** One day of activity: calls per tool, and how many of them were not charged. */
interface DayShape {
  readonly counts: Partial<Record<ToolId, number>>;
  readonly refunds?: Partial<Record<ToolId, number>>;
}

const NO_ACTIVITY: DayShape = { counts: {} };

/**
 * The pilot week, index 0 = today.
 *
 * These seven rows ARE the 7-day window every screen leads with: 53 calls,
 * 138.00 listed, 127.15 charged, 10.85 withheld over three refunded calls.
 * Today is 6 calls and 15.75 — the same six calls that head the finished half
 * of {@link CALLS}, and the figure `/spend-policy`'s usage block reports as
 * spent today.
 *
 * Changing a number here moves `/overview`, `/spend`, `/guarantee`,
 * `/statements` and `/limits` together, which is the point of there being one
 * table rather than five.
 */
const WEEK: readonly DayShape[] = [
  { counts: { ocr_extract: 1, price_quote: 4, geocode: 1 } },
  {
    counts: { deep_search: 1, ocr_extract: 1, kyc_lookup: 1, price_quote: 3, geocode: 3 },
    refunds: { deep_search: 1, geocode: 1 },
  },
  {
    counts: { ocr_extract: 1, kyc_lookup: 1, price_quote: 3, geocode: 3 },
    refunds: { kyc_lookup: 1 },
  },
  { counts: { deep_search: 1, ocr_extract: 1, kyc_lookup: 1, price_quote: 3, geocode: 3 } },
  { counts: { ocr_extract: 1, kyc_lookup: 1, price_quote: 3, geocode: 3 } },
  { counts: { deep_search: 1, ocr_extract: 1, kyc_lookup: 1, price_quote: 2, geocode: 2 } },
  { counts: { price_quote: 3, geocode: 3 } },
];

/**
 * Earlier months, as a repeating seven-day cycle.
 *
 * Two cycles, picked by the month's parity, so August and July do not come out
 * with the same totals — the guarantee's "By month" table is three rows and
 * three identical rows would say the fold is not real. The busier cycle lands
 * on odd months (August is `getUTCMonth() === 7`).
 */
const PAST_CYCLES: readonly (readonly DayShape[])[] = [
  [
    { counts: { price_quote: 1, geocode: 1 } },
    NO_ACTIVITY,
    NO_ACTIVITY,
    { counts: { ocr_extract: 1, price_quote: 1 } },
    NO_ACTIVITY,
    { counts: { price_quote: 2, geocode: 2 } },
    { counts: { kyc_lookup: 1, geocode: 1 }, refunds: { kyc_lookup: 1 } },
  ],
  [
    { counts: { price_quote: 2, geocode: 2 } },
    { counts: { ocr_extract: 1, geocode: 2 } },
    NO_ACTIVITY,
    { counts: { deep_search: 1, price_quote: 1, geocode: 1 }, refunds: { geocode: 1 } },
    { counts: { kyc_lookup: 1, price_quote: 2, geocode: 2 } },
    NO_ACTIVITY,
    { counts: { price_quote: 1, geocode: 2 } },
  ],
];

const DAY_MS = 86_400_000;

/** Midnight UTC of the day this instant falls in. */
function utcDayStart(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dayKeyOf(dayMs: number): string {
  return new Date(dayMs).toISOString().slice(0, 10);
}

function monthKeyOf(dayMs: number): string {
  return new Date(dayMs).toISOString().slice(0, 7);
}

/**
 * What happened on one day.
 *
 * The middle branch is the load-bearing one: a day in the CURRENT month that is
 * older than the pilot week has no activity, which is what makes month-to-date
 * equal to the week and keeps `/limits` ("this month") agreeing with
 * `/guarantee` (September) and with `/withheld`.
 */
function shapeForDay(dayMs: number, todayMs: number): DayShape {
  const daysAgo = Math.round((todayMs - dayMs) / DAY_MS);
  if (daysAgo < 0) return NO_ACTIVITY;
  if (daysAgo < WEEK.length) return WEEK[daysAgo];

  const day = new Date(dayMs);
  const today = new Date(todayMs);
  if (
    day.getUTCFullYear() === today.getUTCFullYear() &&
    day.getUTCMonth() === today.getUTCMonth()
  ) {
    return NO_ACTIVITY;
  }

  const cycle = PAST_CYCLES[day.getUTCMonth() % PAST_CYCLES.length];
  return cycle[(day.getUTCDate() + day.getUTCMonth()) % cycle.length];
}

/** Minor units throughout — a money figure becomes a string only on the way out. */
interface Bucket {
  calls: number;
  refundedCalls: number;
  listed: number;
  charged: number;
  withheld: number;
}

function emptyBucket(): Bucket {
  return { calls: 0, refundedCalls: 0, listed: 0, charged: 0, withheld: 0 };
}

function priceMinorOf(toolId: ToolId): number {
  return Math.round(Number(TOOLS[toolId].price) * 1e6);
}

/** The key one contribution lands under, for each grouping the API offers. */
function groupKeyOf(groupBy: string, toolId: ToolId, dayMs: number, refunded: boolean): string {
  switch (groupBy) {
    case "provider":
      return TOOLS[toolId].provider;
    case "day":
      return dayKeyOf(dayMs);
    case "month":
      return monthKeyOf(dayMs);
    case "status":
      return refunded ? "REFUNDED" : "SETTLED";
    case "verdict":
      return refunded ? "FAIL" : "PASS";
    default:
      return toolId;
  }
}

function addTo(bucket: Bucket, calls: number, refundedCalls: number, amount: number): void {
  bucket.calls += calls;
  bucket.refundedCalls += refundedCalls;
  bucket.listed += amount;
  bucket.charged += refundedCalls > 0 ? 0 : amount;
  bucket.withheld += refundedCalls > 0 ? amount : 0;
}

/**
 * Fold the window `[fromMs, toMs)` into groups plus totals.
 *
 * A window that starts mid-day takes that whole day, which is how a "last 7
 * days" window ending now covers eight calendar days — the eighth is inside the
 * current month and therefore empty, so the totals are still the week's.
 */
function collect(
  fromMs: number,
  toMs: number,
  groupBy: string,
): { groups: Map<string, Bucket>; totals: Bucket } {
  const todayMs = utcDayStart(Date.now());
  const first = utcDayStart(fromMs);
  // Bounded so a malformed window cannot walk for ever; no screen asks for more.
  const last = Math.min(utcDayStart(toMs - 1), first + 400 * DAY_MS);

  const groups = new Map<string, Bucket>();
  const totals = emptyBucket();

  const into = (key: string, calls: number, refundedCalls: number, amount: number) => {
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = emptyBucket();
      groups.set(key, bucket);
    }
    addTo(bucket, calls, refundedCalls, amount);
    addTo(totals, calls, refundedCalls, amount);
  };

  for (let dayMs = first; dayMs <= last; dayMs += DAY_MS) {
    const shape = shapeForDay(dayMs, todayMs);
    for (const toolId of TOOL_IDS) {
      const count = shape.counts[toolId] ?? 0;
      if (count === 0) continue;
      const price = priceMinorOf(toolId);
      const refunded = shape.refunds?.[toolId] ?? 0;
      const paid = count - refunded;
      if (paid > 0) into(groupKeyOf(groupBy, toolId, dayMs, false), paid, 0, paid * price);
      if (refunded > 0) {
        into(groupKeyOf(groupBy, toolId, dayMs, true), refunded, refunded, refunded * price);
      }
    }
  }

  return { groups, totals };
}

/** A figure that was computed in minor units — `money()` takes major ones. */
function minorMoney(minor: number) {
  return { amount: String(Math.round(minor)), decimals: 6, currency: "USD" };
}

function wireFigures(bucket: Bucket) {
  return {
    calls: bucket.calls,
    refundedCalls: bucket.refundedCalls,
    listedTotal: minorMoney(bucket.listed),
    chargedTotal: minorMoney(bucket.charged),
    withheldTotal: minorMoney(bucket.withheld),
    failRate: bucket.calls === 0 ? null : bucket.refundedCalls / bucket.calls,
  };
}

/** The previous period's figures plus the deltas the server computed for us. */
function wireComparison(previous: Bucket | undefined, current: Bucket) {
  const before = previous ?? emptyBucket();
  return {
    ...wireFigures(before),
    deltaCalls: current.calls - before.calls,
    deltaListedTotal: minorMoney(current.listed - before.listed),
    deltaChargedTotal: minorMoney(current.charged - before.charged),
    deltaWithheldTotal: minorMoney(current.withheld - before.withheld),
  };
}

/** `[from, to)` as the API documents it; a caller that sends neither gets the week. */
function windowOf(query: Record<string, unknown>): { from: number; to: number } {
  const parse = (value: unknown): number | null => {
    if (typeof value !== "string") return null;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  };
  const to = parse(query.to) ?? Date.now();
  const from = parse(query.from) ?? to - 7 * DAY_MS;
  return from < to ? { from, to } : { from: to - DAY_MS, to };
}

function summaryBody(query: Record<string, unknown>) {
  const { from, to } = windowOf(query);
  const groupBy = typeof query.groupBy === "string" ? query.groupBy : "tool";
  const current = collect(from, to, groupBy);
  /*
    `compareTo=previous_period` is the only comparison the wire accepts, so the
    basis is the window immediately before this one, of the same length. Absent
    the parameter there is no comparison block at all — the same as the API.
  */
  const previous = query.compareTo ? collect(from - (to - from), from, groupBy) : null;

  const groups = [...current.groups.entries()].map(([key, bucket]) => ({
    key,
    ...wireFigures(bucket),
    comparison: previous ? wireComparison(previous.groups.get(key), bucket) : null,
  }));

  // A time axis reads in time order; everything else reads biggest first.
  groups.sort((a, b) =>
    groupBy === "day" || groupBy === "month"
      ? a.key.localeCompare(b.key)
      : Number(b.chargedTotal.amount) - Number(a.chargedTotal.amount) || a.key.localeCompare(b.key),
  );

  return { groups, totals: wireFigures(current.totals), asset: DEMO_ASSET };
}

/**
 * `GET /withheld` for one window, decomposed the way the API decomposes it.
 *
 * The split is by tool because that is where the model records it: a
 * `kyc_lookup` refund is the upstream failing (`SYSTEM_ERROR` on the receipt),
 * everything else is a call that failed our own checks.
 */
function withheldBody(query: Record<string, unknown>) {
  const { from, to } = windowOf(query);
  const { groups, totals } = collect(from, to, "tool");

  const platform = emptyBucket();
  const verification = emptyBucket();
  for (const [toolId, bucket] of groups) {
    if (bucket.withheld === 0) continue;
    const into = toolId === "kyc_lookup" ? platform : verification;
    into.refundedCalls += bucket.refundedCalls;
    into.withheld += bucket.withheld;
  }

  const buckets = [
    verification.withheld > 0
      ? {
          bucket: "FAILED_VERIFICATION",
          label: "failed verification",
          calls: verification.refundedCalls,
          amount: minorMoney(verification.withheld),
        }
      : null,
    platform.withheld > 0
      ? {
          bucket: "PROVIDER_OR_PLATFORM_ERROR",
          label: "provider or platform error",
          calls: platform.refundedCalls,
          amount: minorMoney(platform.withheld),
        }
      : null,
  ].filter((row): row is NonNullable<typeof row> => row !== null);

  return {
    withheld: [
      {
        withheld: {
          asset: DEMO_ASSET,
          calls: totals.refundedCalls,
          amount: minorMoney(totals.withheld),
          buckets,
        },
        // The identity the Guarantee screen states in its header: withheld == Σ HOLD_RELEASE.
        // `ok` is the API's own verdict on it, not a comparison the screen runs.
        holdReleaseTotal: minorMoney(totals.withheld),
        orphanedReleases: minorMoney(0),
        orphanedHoldIds: [],
        ok: true,
        difference: "0",
      },
    ],
  };
}

/* -------------------------------------------------------------- tool calls */

function toolCallRow(call: DemoCall) {
  return {
    intentId: call.intentId,
    toolId: call.toolId,
    providerId: providerOf(call),
    status: call.status,
    price: money(listedPrice(call)),
    charged: money(call.charged),
    verdict: call.verdict,
    createdAt: minutesAgo(call.minutesAgo),
  };
}

/* ----------------------------------------------------------------- receipt */

interface WireStage {
  stage: string;
  status: string;
  label: string;
  note?: string | null;
  passed?: boolean;
  detail?: string | null;
  score?: number | null;
}

/**
 * The four pipeline stages for one call.
 *
 * `SEMANTIC` is `SKIPPED` on a healthy call because it is SAMPLED, not omitted
 * — that is the one case the receipt screen has a sentence for, and it only
 * prints it when every other stage passed.
 */
function stagesFor(call: DemoCall): WireStage[] {
  const passed = (stage: string, note?: string): WireStage => ({
    stage,
    status: "PASSED",
    label: "passed",
    passed: true,
    note: note ?? null,
  });
  const notReached = (stage: string): WireStage => ({
    stage,
    status: "NOT_REACHED",
    label: "did not run",
    passed: false,
    note: null,
  });

  if (inFlight(call)) {
    return ["SCHEMA", "DETERMINISTIC_RULES", "CROSS_CHECK", "SEMANTIC"].map(notReached);
  }

  if (call.classification === "SYSTEM_ERROR") {
    return [
      {
        stage: "SCHEMA",
        status: "UNAVAILABLE",
        label: "could not run",
        passed: false,
        detail: "The upstream returned 504 twice and then closed the connection.",
      },
      notReached("DETERMINISTIC_RULES"),
      notReached("CROSS_CHECK"),
      notReached("SEMANTIC"),
    ];
  }

  if (call.verdict === "FAIL") {
    return [
      passed("SCHEMA", "runs on every call"),
      {
        stage: "DETERMINISTIC_RULES",
        status: "FAILED",
        label: "failed",
        passed: false,
        score: call.score,
        detail:
          call.reasonCode === "stale_data"
            ? "Every row carried an observation date older than the 24h this tool promises."
            : "The result set was empty where the rules require at least two rows.",
      },
      notReached("CROSS_CHECK"),
      notReached("SEMANTIC"),
    ];
  }

  if (call.verdict === "DEGRADED") {
    return [
      passed("SCHEMA", "runs on every call"),
      passed("DETERMINISTIC_RULES", "runs on every call"),
      {
        stage: "CROSS_CHECK",
        status: "UNAVAILABLE",
        label: "could not run",
        passed: false,
        detail: "The second venue did not answer inside the budget, so it counted neither way.",
      },
      notReached("SEMANTIC"),
    ];
  }

  return [
    passed("SCHEMA", "runs on every call"),
    passed("DETERMINISTIC_RULES", "runs on every call"),
    passed("CROSS_CHECK"),
    { stage: "SEMANTIC", status: "SKIPPED", label: "not sampled", passed: false, note: null },
  ];
}

function receiptBody(call: DemoCall) {
  const created = minutesAgo(call.minutesAgo);
  const settled = inFlight(call) ? null : minutesAgo(Math.max(call.minutesAgo - 1, 0));
  const charged = call.charged !== "0";

  return {
    intentId: call.intentId,
    toolId: call.toolId,
    providerId: providerOf(call),
    classification: call.classification,
    status: call.status,
    listedPrice: money(listedPrice(call)),
    chargedPrice: money(call.charged),
    withheld: money(notChargedMajor(call)),
    verdict: {
      status: call.verdict,
      reasonCode: call.reasonCode,
      reason: call.reasonCode,
      score: call.score,
    },
    stages: stagesFor(call),
    policy: {
      policyId: "pol_buyer_default",
      policyVersion: 4,
      decisionPolicyId: "dp_tool_default",
      decisionPolicyVersion: 3,
      lifecycle: "ACTIVE",
    },
    sampling: {
      rate: 0.025,
      sampled: false,
      display: "1 call in 40 at this price",
    },
    createdAt: created,
    expiresAt: minutesAgo(call.minutesAgo - 1440),
    updatedAt: settled ?? created,
    evaluatedAt: settled,
    settledAt: charged ? settled : null,
    holdReleasedAt: charged ? null : settled,
  };
}

/* ---------------------------------------------------------------- verdicts */

/** Only the finished calls have a verdict; an in-flight one has nothing to record yet. */
const JUDGED = CALLS.filter((call) => !inFlight(call));

function verdictRow(call: DemoCall) {
  return {
    id: verdictIdOf(call),
    intentId: call.intentId,
    toolId: call.toolId,
    providerId: providerOf(call),
    verdictStatus: call.verdict,
    reasonCode: call.reasonCode,
    score: call.score,
    // False on every row, and it agrees with the stage list on the receipt:
    // no call here drew the semantic judge, which is the sampled stage.
    sampled: false,
    decisionPolicyId: "dp_tool_default",
    decisionPolicyVersion: 3,
    state: "SEALED",
    createdAt: minutesAgo(call.minutesAgo),
  };
}

/** The request and response the evidence pack holds, per tool. */
const EVIDENCE_BODIES: Record<ToolId, { request: unknown; response: unknown }> = {
  deep_search: {
    request: { query: "series B fintech raises, EMEA, last 30 days", maxResults: 10 },
    response: { results: [], truncated: false },
  },
  ocr_extract: {
    request: { documentUrl: "https://files.northwind-labs.example/invoices/2026-09/inv-4471.pdf" },
    response: {
      pages: 2,
      fields: { invoiceNumber: "INV-4471", total: "1840.00", currency: "USD" },
    },
  },
  kyc_lookup: {
    request: { legalName: "Halberd Trading Ltd", jurisdiction: "GB", registryId: "09912774" },
    response: { error: "upstream_timeout" },
  },
  price_quote: {
    request: { symbol: "AAPL", venue: "XNAS" },
    response: { symbol: "AAPL", bid: "241.18", ask: "241.22", asOf: "2026-09-16T09:14:02Z" },
  },
  geocode: {
    request: { address: "221B Baker Street, London NW1 6XE" },
    response: {
      results: [{ lat: 51.523767, lng: -0.1585982, confidence: 0.98, source: "osm" }],
    },
  },
};

function evidenceBody(call: DemoCall) {
  const bodies = EVIDENCE_BODIES[call.toolId];
  return {
    id: verdictIdOf(call),
    intentId: call.intentId,
    toolId: call.toolId,
    providerId: providerOf(call),
    state: "SEALED",
    request: bodies.request,
    response: bodies.response,
    outputSchema: {
      type: "object",
      required: ["results"],
      properties: { results: { type: "array" } },
    },
    stageResults: stagesFor(call),
    sampling: { rate: 0.025, sampled: false, display: "1 call in 40 at this price" },
    pinnedPolicy: { decisionPolicyId: "dp_tool_default", decisionPolicyVersion: 3 },
    evaluatedAt: minutesAgo(Math.max(call.minutesAgo - 1, 0)),
    createdAt: minutesAgo(call.minutesAgo),
  };
}

/* ------------------------------------------------------------------ people */

const PROD_AGENT = "9d4c1f80-6b2e-4a57-8c31-7e05b9a2d146";
const STAGING_AGENT = "b71e05a3-2c48-4d90-9f61-38ca7d0b2e54";
const STAGING_ADDRESS = "0x2F5d8B17aC93e04f6b1D7c8A05E2f9B34cD61a70";

/* --------------------------------------------------------------- fixtures */

/**
 * Order matters where two entries could match one path: the specific string is
 * always listed before the regex that would also take it.
 */
export const BUYER_FIXTURES: readonly DemoFixture[] = [
  /* ---------------------------------------------------------- the guarantee */
  {
    method: "GET",
    match: "/withheld",
    body: (_path, query) => withheldBody(query),
  },

  /* ---------------------------------------------------------------- holds */
  {
    method: "GET",
    match: "/holds",
    body: () => ({
      items: CALLS.filter(inFlight).map((call) => ({
        id: `hld_${call.intentId.slice(0, 8)}`,
        intentId: call.intentId,
        amount: money(listedPrice(call)),
        status: "OPEN",
        createdAt: minutesAgo(call.minutesAgo),
        ageSeconds: call.minutesAgo * 60,
        expiresAt: minutesAgo(call.minutesAgo - 1440),
      })),
      pageInfo: { nextCursor: null, hasMore: false },
    }),
  },

  /* ----------------------------------------------------------- tool calls */
  {
    method: "GET",
    match: "/tool-calls",
    body: (_path, query) => {
      const { from, to } = windowOf(query);
      return {
        items: CALLS.filter((call) => withinWindow(call, from, to)).map(toolCallRow),
        pageInfo: { nextCursor: null, hasMore: false },
      };
    },
  },
  {
    method: "GET",
    match: /^\/tool-calls\/[^/]+$/,
    body: (path) => toolCallRow(findCallByIntent(segment(path))),
  },

  /* ------------------------------------------------------------- receipts */
  {
    method: "GET",
    match: "/receipts/summary",
    body: (_path, query) => summaryBody(query),
  },
  {
    // Listed after `/receipts/summary` AND excluding it, so the order of this
    // array is not the only thing keeping the two apart.
    method: "GET",
    match: /^\/receipts\/(?!summary$)[^/]+$/,
    body: (path) => receiptBody(findCallByIntent(segment(path))),
  },

  /* ------------------------------------------------------------- verdicts */
  {
    method: "GET",
    match: "/verdicts",
    body: (_path, query) => {
      const { from, to } = windowOf(query);
      return {
        items: JUDGED.filter((call) => withinWindow(call, from, to)).map(verdictRow),
        pageInfo: { nextCursor: null, hasMore: false },
      };
    },
  },
  {
    method: "GET",
    match: /^\/verdicts\/[^/]+\/evidence$/,
    body: (path) => evidenceBody(findCallByVerdict(segment(path, 1))),
  },

  /* ------------------------------------------------------------- deposits */
  {
    method: "GET",
    match: "/deposits",
    override: "always",
    body: () => ({
      items: [
        {
          id: "dep_7f2a91c4",
          status: "SETTLED",
          statusReason: null,
          agentId: PROD_AGENT,
          agentAccount: DEMO_BUYER_ACCOUNT,
          requestedAmount: money("250.00"),
          settledAmount: money("250.00"),
          chainId: DEMO_CHAIN_ID,
          chainTxRef:
            "0xf20b628bc89d1a3aff88340b307546e0d336e46de2371d76c8220f3c3cfcdd9c",
          expiresAt: minutesAgo(2878),
          createdAt: minutesAgo(2880),
        },
        {
          id: "dep_1c08b5de",
          status: "EXPIRED",
          statusReason: "no transfer observed before the intent expired",
          agentId: PROD_AGENT,
          agentAccount: DEMO_BUYER_ACCOUNT,
          requestedAmount: money("50.00"),
          settledAmount: null,
          chainId: DEMO_CHAIN_ID,
          chainTxRef: null,
          expiresAt: minutesAgo(7198),
          createdAt: minutesAgo(7200),
        },
        {
          id: "dep_4b6e2039",
          status: "SETTLED",
          statusReason: null,
          agentId: PROD_AGENT,
          agentAccount: DEMO_BUYER_ACCOUNT,
          requestedAmount: money("150.00"),
          settledAmount: money("150.00"),
          chainId: DEMO_CHAIN_ID,
          chainTxRef:
            "0xeb5d904fe5ffc1f642f0dff25a94a2e865b86cfd18c55190be121e376e4691e0",
          expiresAt: minutesAgo(12958),
          createdAt: minutesAgo(12960),
        },
        {
          /*
            The two older deposits are what the earlier months were spent out of
            — 890.00 funded against roughly 390.00 charged since July leaves the
            500.00 the ledger reports today.
          */
          id: "dep_a3d97f61",
          status: "SETTLED",
          statusReason: null,
          agentId: PROD_AGENT,
          agentAccount: DEMO_BUYER_ACCOUNT,
          requestedAmount: money("200.00"),
          settledAmount: money("200.00"),
          chainId: DEMO_CHAIN_ID,
          chainTxRef:
            "0x4c1db62bcbe5d1408fdb6596b0cbe8fc94011c60341e6f14a1cc8514d468a40d",
          expiresAt: minutesAgo(33118),
          createdAt: minutesAgo(33120),
        },
        {
          id: "dep_60e4c827",
          status: "SETTLED",
          statusReason: null,
          agentId: PROD_AGENT,
          agentAccount: DEMO_BUYER_ACCOUNT,
          requestedAmount: money("290.00"),
          settledAmount: money("290.00"),
          chainId: DEMO_CHAIN_ID,
          chainTxRef:
            "0x5c38c68d25f54d688ef3980cdc1a944b475793cb15cd470bab412c0efa7c9c0e",
          expiresAt: minutesAgo(66238),
          createdAt: minutesAgo(66240),
        },
      ],
      pageInfo: { nextCursor: null, hasMore: false },
    }),
  },

  /* --------------------------------------------------------------- escrow */
  {
    method: "GET",
    match: "/escrow",
    override: "always",
    body: () => ({
      exists: true,
      chainReadable: true,
      account: DEMO_BUYER_ACCOUNT,
      /*
        Both null on `eip155`, and that is the chain's answer rather than a gap
        in this fixture: the EVM balance is held by a settlement contract keyed
        on the buyer's own address, so there is no per-account address to print.
        `EscrowOnChain` renders the chain's explorer and no address list.
      */
      escrowPda: null,
      escrowTokenAccount: null,
      balance: money("500.00"),
      openHolds: money("17.85"),
      spendable: money("482.15"),
      withdrawRequested: money("0"),
      withdrawAvailableAt: null,
      serverTime: minutesAgo(0),
      maxVoucherAmount: money("10.00"),
      maxPerWindow: money("120.00"),
      spentInWindow: money("15.75"),
      windowStartedAt: minutesAgo(540),
      windowSeconds: 86400,
      observedAt: minutesAgo(1),
    }),
  },

  /* --------------------------------------------------------- spend policy */
  {
    method: "GET",
    match: "/spend-policy/history",
    body: () => ({
      items: [
        {
          id: "sph_04",
          scope: "ORGANIZATION",
          agentId: null,
          policyVersion: 4,
          perCallMax: money("10.00"),
          dailyCap: money("75.00"),
          monthlyCap: money("900.00"),
          maxCallsPerHour: 400,
          maxCallsPerMinute: 30,
          maxSpendPerHour: money("25.00"),
          allowedTools: null,
          requireApprovalAbove: money("25.00"),
          paused: false,
          changedBy: "ops@northwind-labs.example",
          changeReason: "Raised the daily cap for the September pilot",
          changedAt: minutesAgo(10080),
          supersededAt: null,
        },
        {
          id: "sph_03",
          scope: "ORGANIZATION",
          agentId: null,
          policyVersion: 3,
          perCallMax: money("10.00"),
          dailyCap: money("40.00"),
          monthlyCap: money("900.00"),
          maxCallsPerHour: 400,
          maxCallsPerMinute: 30,
          maxSpendPerHour: money("25.00"),
          allowedTools: null,
          requireApprovalAbove: money("25.00"),
          paused: false,
          changedBy: "ops@northwind-labs.example",
          changeReason: "Velocity ceiling added after the August retry loop",
          changedAt: minutesAgo(21600),
          supersededAt: minutesAgo(10080),
        },
        {
          id: "sph_02",
          scope: "ORGANIZATION",
          agentId: null,
          policyVersion: 2,
          perCallMax: money("10.00"),
          dailyCap: money("40.00"),
          monthlyCap: money("600.00"),
          maxCallsPerHour: null,
          maxCallsPerMinute: null,
          maxSpendPerHour: null,
          allowedTools: null,
          requireApprovalAbove: money("25.00"),
          paused: false,
          changedBy: "ops@northwind-labs.example",
          changeReason: "Approval threshold set before the first paid run",
          changedAt: minutesAgo(46080),
          supersededAt: minutesAgo(21600),
        },
        {
          id: "sph_01",
          scope: "ORGANIZATION",
          agentId: null,
          policyVersion: 1,
          perCallMax: money("5.00"),
          dailyCap: money("20.00"),
          monthlyCap: money("300.00"),
          maxCallsPerHour: null,
          maxCallsPerMinute: null,
          maxSpendPerHour: null,
          allowedTools: null,
          requireApprovalAbove: null,
          paused: false,
          changedBy: "ops@northwind-labs.example",
          changeReason: "Account opened",
          changedAt: minutesAgo(66240),
          supersededAt: minutesAgo(46080),
        },
      ],
      pageInfo: { nextCursor: null, hasMore: false },
    }),
  },
  {
    method: "GET",
    match: "/spend-policy",
    body: () => {
      /*
        The enforcement side's own counters, which the Limits screen prefers
        over `/receipts/summary`. Both are folded out of the SAME day model the
        summary is, so "spent today" here and today's bar on `/overview` cannot
        drift apart: 15.75 today, 127.15 this month.
      */
      const todayStart = utcDayStart(Date.now());
      const monthStart = Date.UTC(
        new Date(todayStart).getUTCFullYear(),
        new Date(todayStart).getUTCMonth(),
        1,
      );
      const today = collect(todayStart, todayStart + DAY_MS, "tool").totals;
      const month = collect(monthStart, todayStart + DAY_MS, "tool").totals;

      return {
        id: "sp_northwind",
        scope: "ORGANIZATION",
        agentId: null,
        policyVersion: 4,
        asset: DEMO_ASSET,
        decimals: 6,
        perCallMax: money("10.00"),
        dailyCap: money("75.00"),
        monthlyCap: money("900.00"),
        maxCallsPerHour: 400,
        maxCallsPerMinute: 30,
        maxSpendPerHour: money("25.00"),
        allowedTools: null,
        requireApprovalAbove: money("25.00"),
        paused: false,
        changedBy: "ops@northwind-labs.example",
        changeReason: "Raised the daily cap for the September pilot",
        createdAt: minutesAgo(10080),
        usage: {
          spendToday: minorMoney(today.charged),
          spendThisMonth: minorMoney(month.charged),
          spendThisHour: money("4.50"),
          callsThisMinute: 2,
          callsThisHour: 11,
          usageReadable: true,
        },
      };
    },
  },

  /* --------------------------------------------------- agents, credentials */
  {
    method: "GET",
    match: "/agents",
    /*
      `agentAccount` is CAIP-10 and Settings prints it whole, so a real agent row
      would put a `solana:…` account on the screen. Substituting always also
      keeps the agent ids stable, which is what the credentials fixture below
      reads back out of its own path.
    */
    override: "always",
    body: () => ({
      items: [
        {
          agentId: PROD_AGENT,
          label: "prod",
          agentAccount: DEMO_BUYER_ACCOUNT,
          chainId: DEMO_CHAIN_ID,
          credentialCount: 2,
        },
        {
          agentId: STAGING_AGENT,
          label: "staging",
          agentAccount: `${DEMO_CHAIN_ID}:${STAGING_ADDRESS}`,
          chainId: DEMO_CHAIN_ID,
          credentialCount: 1,
        },
      ],
      pageInfo: { nextCursor: null, hasMore: false },
    }),
  },
  {
    // `/agents/{id}/credentials` — the agent is read back out of the path so
    // each panel lists its own rows rather than one shared set.
    method: "GET",
    match: /^\/agents\/[^/]+\/credentials$/,
    body: (path) => {
      const agentId = segment(path, 1);
      const staging = agentId === STAGING_AGENT;
      return {
        items: [
          {
            id: staging ? "cred_9c41" : "cred_2f70",
            agentId,
            name: staging ? "staging runner" : "orchestrator",
            prefix: staging ? "x402_live_8fd2" : "x402_live_31ac",
            scopes: ["tools:call"],
            lastUsedAt: minutesAgo(staging ? 820 : 2),
            expiresAt: null,
            revokedAt: null,
            rotatedFromId: null,
            createdAt: minutesAgo(staging ? 46080 : 66240),
          },
          ...(staging
            ? []
            : [
                {
                  id: "cred_0b19",
                  agentId,
                  name: "CI deploy",
                  prefix: "x402_live_a47e",
                  scopes: ["tools:call"],
                  lastUsedAt: minutesAgo(24000),
                  expiresAt: null,
                  revokedAt: minutesAgo(21600),
                  rotatedFromId: null,
                  createdAt: minutesAgo(52000),
                },
              ]),
        ],
        pageInfo: { nextCursor: null, hasMore: false },
      };
    },
  },

  /* ------------------------------------------------------------ audit log */
  {
    method: "GET",
    match: "/audit-log",
    body: () => ({
      items: [
        {
          id: "aud_77a4",
          actorType: "agent",
          actorId: PROD_AGENT,
          action: "session.created",
          resourceType: "session",
          resourceId: "ses_41d8",
          before: null,
          after: { credential: "x402_live_31ac" },
          createdAt: minutesAgo(1440),
        },
        {
          id: "aud_0f81",
          actorType: "system",
          actorId: null,
          action: "payment_intent.refunded",
          resourceType: "payment_intent",
          resourceId: "b90f2c48-3a71-4e69-85d0-2f4a6c19e7b5",
          before: { charged: "6.00" },
          after: { charged: "0.00" },
          createdAt: minutesAgo(1558),
        },
        {
          id: "aud_5b2c",
          actorType: "system",
          actorId: null,
          action: "payment_intent.refunded",
          resourceType: "payment_intent",
          resourceId: "e48a3b19-7c65-4d02-8f1b-5a97c2e04d63",
          before: { charged: "3.60" },
          after: { charged: "0.00" },
          createdAt: minutesAgo(2398),
        },
        {
          id: "aud_d310",
          actorType: "system",
          actorId: null,
          action: "deposit.credited",
          resourceType: "deposit",
          resourceId: "dep_7f2a91c4",
          before: null,
          after: { amount: "250.00", chain: "eip155:46630" },
          createdAt: minutesAgo(2878),
        },
        {
          id: "aud_9e46",
          actorType: "user",
          actorId: "ops@northwind-labs.example",
          action: "spend_policy.updated",
          resourceType: "spend_policy",
          resourceId: "sp_northwind",
          before: { dailyCap: "40.00" },
          after: { dailyCap: "75.00" },
          createdAt: minutesAgo(10080),
        },
        {
          id: "aud_c052",
          actorType: "user",
          actorId: "ops@northwind-labs.example",
          action: "credential.revoked",
          resourceType: "credential",
          resourceId: "cred_0b19",
          before: { name: "CI deploy", revokedAt: null },
          after: { name: "CI deploy", revokedAt: "immediately" },
          createdAt: minutesAgo(21600),
        },
        {
          id: "aud_1a8f",
          actorType: "user",
          actorId: "ops@northwind-labs.example",
          action: "spend_policy.updated",
          resourceType: "spend_policy",
          resourceId: "sp_northwind",
          before: { maxCallsPerMinute: null },
          after: { maxCallsPerMinute: 30 },
          createdAt: minutesAgo(21600),
        },
        {
          id: "aud_6d23",
          actorType: "user",
          actorId: "ops@northwind-labs.example",
          action: "agent.created",
          resourceType: "agent",
          resourceId: STAGING_AGENT,
          before: null,
          after: { label: "staging" },
          createdAt: minutesAgo(46080),
        },
      ],
      pageInfo: { nextCursor: null, hasMore: false },
    }),
  },

  /* -------------------------------------------------------- notifications */
  {
    method: "GET",
    match: "/notifications/unread-count",
    body: () => ({ count: 2 }),
  },
  {
    method: "GET",
    match: "/notifications",
    body: () => ({
      items: [
        {
          id: "ntf_4c17",
          event: "velocity.anomaly",
          severity: "WARNING",
          title: "geocode ran at eight times its usual rate for 20 minutes",
          body: "34 calls between 09:10 and 09:30 UTC against a 7-day median of 4 in that window. Nothing was refused — the per-minute ceiling is 30 and the burst stayed under it.",
          subjectType: "tool",
          subjectId: "geocode",
          readAt: null,
          createdAt: minutesAgo(96),
        },
        {
          id: "ntf_2fa9",
          event: "spend.threshold_crossed",
          severity: "INFO",
          title: "This month's spend passed 10% of the monthly cap",
          body: "$127.15 charged of a $900.00 cap. This is a notice, not a refusal — a limit is what refuses.",
          subjectType: "spend_policy",
          subjectId: "sp_northwind",
          readAt: minutesAgo(1300),
          createdAt: minutesAgo(1440),
        },
        {
          id: "ntf_8b30",
          event: "payment_intent.refunded",
          severity: "INFO",
          title: "A deep_search call failed our checks — $6.00 was not charged",
          body: "The result set was empty where the rules require at least two rows. The hold was released; your balance never moved.",
          subjectType: "payment_intent",
          subjectId: "b90f2c48-3a71-4e69-85d0-2f4a6c19e7b5",
          readAt: null,
          createdAt: minutesAgo(1558),
        },
        {
          id: "ntf_7d65",
          event: "deposit.credited",
          severity: "INFO",
          title: "$250.00 credited",
          body: "Observed on Robinhood Chain testnet and credited in full. The credited amount is what we observed on chain.",
          subjectType: "deposit",
          subjectId: "dep_7f2a91c4",
          readAt: minutesAgo(2870),
          createdAt: minutesAgo(2878),
        },
      ],
      pageInfo: { nextCursor: null, hasMore: false },
    }),
  },
  {
    method: "GET",
    match: /^\/notifications\/[^/]+\/deliveries$/,
    body: () => [
      {
        id: "dlv_in_app",
        channel: "IN_APP",
        status: "DELIVERED",
        attempts: 1,
        lastError: null,
        deliveredAt: minutesAgo(95),
        createdAt: minutesAgo(96),
      },
      {
        id: "dlv_email",
        channel: "EMAIL",
        status: "DELIVERED",
        attempts: 1,
        lastError: null,
        deliveredAt: minutesAgo(95),
        createdAt: minutesAgo(96),
      },
      {
        id: "dlv_slack",
        channel: "SLACK",
        status: "SUPPRESSED",
        attempts: 0,
        lastError: null,
        deliveredAt: null,
        createdAt: minutesAgo(96),
      },
    ],
  },
  {
    method: "GET",
    match: "/notification-channels",
    body: () => [
      {
        id: "nch_email",
        channel: "EMAIL",
        destination: "ops@northwind-labs.example",
        enabled: true,
        verifiedAt: minutesAgo(66000),
        createdAt: minutesAgo(66240),
      },
      {
        id: "nch_slack",
        channel: "SLACK",
        destination: "https://hooks.slack.com/services/T000/B000/XXXX",
        enabled: true,
        verifiedAt: minutesAgo(45000),
        createdAt: minutesAgo(46080),
      },
      {
        id: "nch_webhook",
        channel: "WEBHOOK",
        destination: "https://hooks.northwind-labs.example/x402/alerts",
        enabled: false,
        verifiedAt: null,
        createdAt: minutesAgo(21600),
      },
    ],
  },
];
