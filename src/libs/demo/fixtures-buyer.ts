import { DISPUTE_HOLD_MINUTES } from "@/libs/dispute-deadlines";
import {
  DEMO_ASSET,
  DEMO_BUYER_ACCOUNT,
  DEMO_CHAIN_ID,
  justNow,
  minutesAgo,
  money,
  type DemoFixture,
} from "./fixtures";
import { ApiError } from "@/libs/ApiClient";

import { DEMO_NOW_MS } from "./demo-clock";
import { demoDebtSigned, demoDebtVariant, writtenOffVariant } from "./demo-debts";
import { demoDelegateCaps, demoEscrowCaps, rememberDemoPolicy, withDemoPolicy } from "./demo-stage";
import { demoTightenDelaySeconds } from "./demo-switches";
import { advanceFreshStage, freshAtLeast, freshStage } from "./fresh-account";

/**
 * DEMO ONLY — see `demo-api.ts` for the rules. The buyer surface.
 *
 * One account's September on Robinhood Chain testnet: a pilot that restarted
 * seven days ago and has run 53 calls across five tools since, three of which
 * were not charged, five of which are still in flight, against a $25 deposit
 * two days ago. The prices are the catalogue's (see {@link TOOLS}), so most
 * calls cost a fraction of a cent and one `deep_research` costs $1.20. Every
 * screen from `/` to the Funding escrow drawer draws from the tables below, so
 * a figure a viewer reads twice reads the same twice — the held total on
 * `/` is the sum of the holds on `/funding`, which is the sum of the
 * five in-flight calls in `/tool-calls`, which is the `held` on the
 * `/balances` fixture in `fixtures.ts` (58.7823 available, 1.2177 held, 60.00
 * total; see {@link demoBuyerLedger}) — plus, under a `?debt=` picture with an
 * open debt of this wallet's, that debt's price, which stays held until it is
 * collected (`demoDebtHolds`; $1.20 by default: 57.5823 available, 2.4177
 * held).
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
 *  - a day, a week and a month are three different answers — the `/`
 *    chart draws seven different bars and `/guarantee` prints three different
 *    months;
 *  - `/withheld` for a window equals that window's `withheldTotal`, so the
 *    guarantee's hero figure agrees with its own table for every month.
 *
 * The model has no activity in the current month before the pilot week, which
 * is deliberate and is what pins the two figures other fixtures state as
 * constants: month-to-date charged is exactly the week's 2.5094 (the Limits
 * screen's usage block, and the spend notice) and month-to-date withheld is
 * exactly 1.2132 (the guarantee's hero).
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
 * Each price is the catalogue's price for that tool AT that provider
 * (fixtures-explore's `offers`), so a tool's page on Explore and this
 * account's calls of it name the same price: `get_usd_eur_rate` lists
 * $0.0008–$0.0010 there, and this account's provider charges $0.0010.
 *
 * The ids are the ids: no buyer endpoint resolves a tool id to a name, so
 * every screen prints whatever is here, and `groupKeyLabel` truncates anything
 * over twelve characters. Provider ids are the catalogue's (fixtures-explore),
 * so `useEntityNames` resolves them to legal names as it would in production.
 */
const TOOLS = {
  // The keys are this file's short names; `id` is the catalogue's tool id
  // (fixtures-explore), which is what goes on the wire, so every call, filter,
  // search result and link resolves to the same named tool on Explore.
  deep_search: { id: "84c1e70b-5a29-4f36-9e8d-2b40c6f7a915", provider: "9c1d4f60-3a77-4c18-9b02-6e5a1f2d8b41", price: "1.20" }, // deep_research
  ocr_extract: { id: "abae704e-0a56-5674-9074-6c7bfc25fad1", provider: "e41b7d93-2a58-4f60-b7c9-3d80f5a1e6c4", price: "0.0035" }, // extract_page_text
  kyc_lookup: { id: "2b7f9c41-0e63-4d8a-9f52-7a1c4e6b03d9", provider: "c9f35a82-6014-4d7b-8e93-2a1c7f06b5d8", price: "0.012" }, // search_web
  price_quote: { id: "a4b9882a-9bc1-4d64-807a-27c0b93daf0a", provider: "5a2c9e18-7f46-4b03-9d51-8c6e2a4f7b09", price: "0.001" }, // get_usd_eur_rate
  geocode: { id: "ad39dccc-aff2-54c1-b383-62e0ff392570", provider: "b7e04c25-9d13-4a6f-bc80-1e5f3a7d9c62", price: "0.0012" }, // geocode_place
} as const;

/** The catalogue tool id a short name stands for. */
function wireToolId(key: ToolId): string {
  return TOOLS[key].id;
}

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
  /**
   * Buyer debt: a served, passed call whose payment could not be collected.
   * `OUTSTANDING` keeps its charge (it is charged once the buyer settles) and
   * is the one debt `GET /escrow/debts` lists — see {@link demoDebt}.
   */
  readonly debt?: "OUTSTANDING" | "WRITTEN_OFF" | "VOIDED";
  /** The lapse cause recorded with a debt. */
  readonly debtCause?: string;
}

/**
 * The recent calls, newest first.
 *
 * The first five are in flight and are the five open holds — one call of each
 * tool, 1.20 + 0.0035 + 0.012 + 0.001 + 0.0012 = 1.2177, which is the `held`
 * figure on `/balances`.
 *
 * The next six are today's finished calls and are **the same six calls as
 * today's row in the day model**: one `deep_search` (the owed one, $1.20), one
 * `geocode`, one `ocr_extract`, three `price_quote` — 1.2077 listed, 0.0077
 * charged and 1.20 owed. Counting the rows on `/` and reading the
 * "Today" tile above them has to give the same answer.
 *
 * The last three are the three that were not charged — 1.20 + 0.0012 + 0.012 =
 * 1.2132, the `/withheld` total for the month. They sit 26 to 40 hours back so
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
    toolId: "deep_search",
    minutesAgo: 78,
    charged: "1.20",
    status: "SETTLED",
    verdict: "PASS",
    classification: "DATA_RESULT",
    reasonCode: null,
    score: 0.96,
    // The agent's delegate key was revoked before the voucher was collected:
    // buyer debt, so the buyer screens show the "Settle $1.20" banner.
    debt: "OUTSTANDING",
    debtCause: "DelegateIsRevoked",
  },
  {
    intentId: "8c47b0d2-9e36-4a15-b7f8-03d1e5c86a29",
    toolId: "geocode",
    minutesAgo: 96,
    charged: "0.0012",
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
    charged: "0.0035",
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
    charged: "0.001",
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
    charged: "0.001",
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
    charged: "0.001",
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
      The provider returned an error, so — as on the real API — the call is
      VOIDED with no verdict: no check ran because there was no result. The
      receipt says "The provider returned an error instead of a result" and
      Not charged lists it under "No usable result".
    */
    intentId: "e48a3b19-7c65-4d02-8f1b-5a97c2e04d63",
    toolId: "kyc_lookup",
    minutesAgo: 2400,
    charged: "0",
    status: "VOIDED",
    verdict: null,
    classification: "SYSTEM_ERROR",
    reasonCode: null,
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
  return (minor / 1e6).toFixed(6);
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
 * How long ago a call was made, in minutes. The owed call is made more than 30
 * days back under a written-off picture (`?debt=written-off`, `?debt=short`):
 * a debt is written off 30 days after its payment lapsed, so a write-off two
 * days ago is a call 32 days ago. Read as "Today 00:40" it put the write-off
 * before the call (review 2026-10-17).
 */
function callAge(call: Pick<DemoCall, "minutesAgo" | "debt">): number {
  if (call.debt === "OUTSTANDING" && writtenOffVariant(demoDebtVariant())) {
    return (WRITE_OFF_DAYS + WRITTEN_OFF_DAYS_AGO) * 1440 + DEBT_LAPSE_MINUTES;
  }
  return call.minutesAgo;
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
  const at = DEMO_NOW_MS - callAge(call) * 60_000;
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
 * 4.9226 listed, 1.2132 withheld over three refunded calls, and of the 3.7094
 * served, 1.20 owed (today's open debt, see `collect`) and 2.5094 charged.
 * Today is 6 calls, 1.2077 listed and 0.0077 charged — the same six calls that
 * head the finished half of {@link CALLS}, and the figure `/spend-policy`'s
 * usage block reports as spent today.
 *
 * Changing a number here moves `/`, `/spend`, `/guarantee`,
 * `/statements` and `/limits` together, which is the point of there being one
 * table rather than five.
 */
const WEEK: readonly DayShape[] = [
  { counts: { deep_search: 1, ocr_extract: 1, price_quote: 3, geocode: 1 } },
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
  /** Buyer debt: served, payment not collected — listed, but neither charged nor not charged. */
  owed: number;
  owedCalls: number;
}

function emptyBucket(): Bucket {
  return { calls: 0, refundedCalls: 0, listed: 0, charged: 0, withheld: 0, owed: 0, owedCalls: 0 };
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
      return wireToolId(toolId);
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
  // A fresh demo account (?fresh=) has spent nothing and been refunded nothing.
  if (freshStage()) return { groups: new Map(), totals: emptyBucket() };
  const todayMs = utcDayStart(Date.now());
  const first = utcDayStart(fromMs);
  // Bounded so a malformed window cannot walk for ever; no screen asks for more.
  const last = Math.min(utcDayStart(toMs - 1), first + 400 * DAY_MS);

  const groups = new Map<string, Bucket>();
  const totals = emptyBucket();
  // Owed in the totals exactly while `/escrow/debts` lists the debt.
  const debtCall = demoDebts().length > 0 ? CALLS.find((call) => call.debt === "OUTSTANDING") : undefined;
  /*
    The day the owed call was made. Under a written-off picture that is weeks
    back (`callAge`), so the call leaves today's figures altogether — Overview's
    "Spent today" said "6 calls · $… owed" of a call made on Sep 15
    (verify-r13 P3) — and is counted, owed, on its own day.
  */
  const debtDayMs = debtCall ? utcDayStart(DEMO_NOW_MS - callAge(debtCall) * 60_000) : null;
  const debtToday = debtDayMs === null || debtDayMs >= todayMs;
  const owe = (bucket: Bucket, price: number) => {
    bucket.charged -= price;
    bucket.owed += price;
    bucket.owedCalls += 1;
  };

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
      // The demo's one debt is one of today's paid calls: owed, not charged, until settled.
      if (paid > 0 && debtCall && dayMs === todayMs && toolId === debtCall.toolId) {
        const key = groupKeyOf(groupBy, toolId, dayMs, false);
        for (const bucket of [groups.get(key)!, totals]) {
          if (debtToday) {
            owe(bucket, price);
          } else {
            // Made on another day: not one of today's calls at all.
            bucket.calls -= 1;
            bucket.listed -= price;
            bucket.charged -= price;
          }
        }
      }
      if (refunded > 0) {
        into(groupKeyOf(groupBy, toolId, dayMs, true), refunded, refunded, refunded * price);
      }
    }
  }

  // A debt made on an earlier day, counted owed on that day when the window reaches it.
  if (debtCall && debtDayMs !== null && !debtToday && debtDayMs >= first && debtDayMs <= last) {
    const price = priceMinorOf(debtCall.toolId);
    const key = groupKeyOf(groupBy, debtCall.toolId, debtDayMs, false);
    into(key, 1, 0, price);
    owe(groups.get(key)!, price);
    owe(totals, price);
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
    // The day-by-day model has no forfeit or in-flight call, so not charged
    // is withheld. Owed is the one OUTSTANDING debt the banner, the Overview
    // row and the receipt show (moved out of today's charged, see `collect`).
    notChargedTotal: minorMoney(bucket.withheld),
    notChargedCalls: bucket.refundedCalls,
    owedTotal: minorMoney(bucket.owed),
    owedCalls: bucket.owedCalls,
    inProgressTotal: minorMoney(0),
    inProgressCalls: 0,
    // The day-by-day model is paid calls only.
    freeCalls: 0,
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
    deltaNotChargedTotal: minorMoney(current.withheld - before.withheld),
    deltaOwedTotal: minorMoney(current.owed - before.owed),
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
    // Groups are keyed by the wire (catalogue) id, not this file's short name.
    const into = toolId === wireToolId("kyc_lookup") ? platform : verification;
    into.refundedCalls += bucket.refundedCalls;
    into.withheld += bucket.withheld;
  }

  // Every bucket, zero-filled and in the API's order. The demo model has no
  // served-but-never-collected call, so Not collected is always zero here.
  const buckets = [
    {
      bucket: "FAILED_VERIFICATION",
      label: "failed verification",
      calls: verification.refundedCalls,
      amount: minorMoney(verification.withheld),
    },
    {
      bucket: "PROVIDER_OR_PLATFORM_ERROR",
      label: "provider or platform error",
      calls: platform.refundedCalls,
      amount: minorMoney(platform.withheld),
    },
    {
      bucket: "NOT_COLLECTED",
      label: "not collected (the charge was cancelled or never taken)",
      calls: 0,
      amount: minorMoney(0),
    },
  ];

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

/**
 * The call's debt flag for the `?debt=` picture: the owed call reads as
 * written off under `?debt=written-off`, on the row and the receipt alike,
 * as it does in the debts list.
 */
function demoCallDebt(call: DemoCall): { debt: DemoCall["debt"] | null; chargeNote: string | null } {
  if (!call.debt) return { debt: null, chargeNote: null };
  if (call.debt === "OUTSTANDING" && writtenOffVariant(demoDebtVariant())) {
    return { debt: "WRITTEN_OFF", chargeNote: `uncollected:${call.debtCause ?? "unknown"}` };
  }
  return { debt: call.debt, chargeNote: call.debtCause ?? null };
}

function toolCallRow(call: DemoCall) {
  return {
    intentId: call.intentId,
    toolId: wireToolId(call.toolId),
    providerId: providerOf(call),
    status: call.status,
    price: money(listedPrice(call)),
    charged: money(call.charged),
    forfeited: false,
    debt: demoCallDebt(call).debt,
    refundedByReport: false,
    verdict: call.verdict,
    createdAt: minutesAgo(callAge(call)),
  };
}

/** The account ceiling as a demo change left it, as wire fields. */
function savedEscrowCaps() {
  const saved = demoEscrowCaps();
  if (!saved) return {};
  return {
    maxVoucherAmount: { amount: saved.maxVoucherAmount, asset: DEMO_ASSET, decimals: 6 },
    maxPerWindow: { amount: saved.maxPerWindow, asset: DEMO_ASSET, decimals: 6 },
  };
}

/** A delegate's caps as a demo "Sign and save" left them, as wire fields. */
function savedDelegateCaps(delegate: string) {
  const saved = demoDelegateCaps(delegate);
  if (!saved) return {};
  return {
    maxVoucherAmount: { amount: saved.maxVoucherAmount, asset: DEMO_ASSET, decimals: 6 },
    maxPerWindow: { amount: saved.maxPerWindow, asset: DEMO_ASSET, decimals: 6 },
    ...(saved.validUntil ? { validUntil: saved.validUntil } : {}),
  };
}

/* ----------------------------------------------------------- buyer debt */

const WRITE_OFF_DAYS = 30;
/** Under a written-off picture, the write-off was this many days ago. */
const WRITTEN_OFF_DAYS_AGO = 2;
/** A demo debt's payment lapses this many minutes after its call. */
const DEBT_LAPSE_MINUTES = 10;

/**
 * The call, lapse and write-off times every written-off demo debt carries —
 * `?debt=written-off`, `?debt=short` and the written-off row of `?debt=many`
 * alike — so the demo dates a write-off one way only (final2 P3: it read Sep 15
 * in one picture and a different day in another). The call is
 * `WRITE_OFF_DAYS + WRITTEN_OFF_DAYS_AGO` days back, as `callAge` puts it.
 */
function writtenOffDates() {
  const callMinutes = (WRITE_OFF_DAYS + WRITTEN_OFF_DAYS_AGO) * 1440 + DEBT_LAPSE_MINUTES;
  const lapsedMinutes = callMinutes - DEBT_LAPSE_MINUTES;
  return {
    createdAt: minutesAgo(callMinutes),
    lapsedAt: minutesAgo(lapsedMinutes),
    writeOffAt: minutesAgo(lapsedMinutes - WRITE_OFF_DAYS * 1440),
  };
}

/** The one open debt, as `GET /escrow/debts` lists it (`state: "OPEN"`). */
function debtView(call: DemoCall) {
  const lapsedMinutes = Math.max(callAge(call) - DEBT_LAPSE_MINUTES, 0);
  return {
    intentId: call.intentId,
    payer: DEMO_BUYER_ACCOUNT,
    amount: {
      amount: money(listedPrice(call)).amount,
      asset: DEMO_ASSET,
      decimals: 6,
    },
    providerId: providerOf(call),
    // The catalogue id, as on every other demo row: the banner and the settle
    // sheet name the same tool as the call list.
    toolId: wireToolId(call.toolId),
    cause: call.debtCause ?? null,
    // Not signed yet: the banner offers "Settle $X".
    state: "OPEN" as const,
    lapsedAt: minutesAgo(lapsedMinutes),
    writeOffAt: minutesAgo(lapsedMinutes - WRITE_OFF_DAYS * 1440),
    replacedAt: null,
    // Past: its original voucher's on-chain window is over, so it can be signed now.
    replaceableAt: minutesAgo(lapsedMinutes),
    createdAt: minutesAgo(callAge(call)),
  };
}

/**
 * Built on first use, not at module load: `fixtures.ts` imports this file and
 * owns DEMO_BUYER_ACCOUNT, so reading it here at load time hits the import cycle
 * before the constant exists (the static export failed with a TDZ error).
 */
export function demoDebt() {
  return debtView(CALLS.find((call) => call.debt === "OUTSTANDING")!);
}

/**
 * Another wallet of the demo organization, for the `other-wallet` and `many`
 * pictures. A function, not a constant: `DEMO_CHAIN_ID` comes from
 * `fixtures.ts`, which imports this file, so reading it at load time hits the
 * import cycle (see `demoDebt`).
 */
const demoOtherPayer = () => `${DEMO_CHAIN_ID}:0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF`;

/** The second debt of `?debt=waiting-mixed`, the one still waiting. */
const WAITING_DEBT_INTENT = "5a9e1c37-b2d4-4f60-8e13-c7a04d29f5b8";
/** How far ahead of the demo's "now" a waiting debt's `replaceableAt` sits. */
const WAITING_MINUTES = 20;
let waitingAt: string | null = null;

/**
 * `replaceableAt` for the waiting pictures: 20 minutes after the demo's "now"
 * (`DEMO_NOW_MS`, like every demo time). The demo clock can be hours old in a
 * long session, so when that moment has already passed it moves on in
 * 20-minute steps from the same base until it is ahead of the real clock. Read
 * once per page load, so the Settle button can be seen turning on when it passes.
 */
function waitingReplaceableAt(real: number = Date.now()): string {
  if (waitingAt) return waitingAt;
  const step = WAITING_MINUTES * 60_000;
  const steps = Math.max(1, Math.floor((real - DEMO_NOW_MS) / step) + 1);
  waitingAt = new Date(DEMO_NOW_MS + steps * step).toISOString();
  return waitingAt;
}

/**
 * The demo debts whose price is still held in this escrow: this wallet's own,
 * open or being collected. A written-off debt's hold was released; another
 * wallet's debt is held in that wallet's escrow.
 */
export function demoDebtHolds() {
  return demoDebts().filter((debt) => debt.payer === DEMO_BUYER_ACCOUNT && debt.state !== "WRITTEN_OFF");
}

/** The sum of the held debts, in minor units. */
function demoDebtHeldMinor(): number {
  return demoDebtHolds().reduce((sum, debt) => sum + Number(debt.amount.amount), 0);
}

/** The escrow's balance: 68.70 funded (`/deposits`) less the 8.69 charged since August. */
const BALANCE_MINOR = 60_000_000;

/**
 * The account's balance, held and available, in minor units, as `/escrow` and
 * `/balances` both print them: held is the five in-flight calls' prices
 * (1.2177) plus each debt still held (`demoDebtHolds`).
 */
export function demoBuyerLedger(): { balance: number; held: number; available: number } {
  const inFlightMinor = CALLS.filter(inFlight).reduce((sum, call) => sum + Math.round(Number(listedPrice(call)) * 1e6), 0);
  const held = inFlightMinor + demoDebtHeldMinor();
  return { balance: BALANCE_MINOR, held, available: BALANCE_MINOR - held };
}

/** The demo's deposits, newest first: 68.70 funded in four settled deposits, one expired. */
function demoDeposits() {
  return [
        {
          id: "dep_7f2a91c4",
          status: "SETTLED",
          statusReason: null,
          agentId: PROD_AGENT,
          agentAccount: DEMO_BUYER_ACCOUNT,
          requestedAmount: money("25.00"),
          settledAmount: money("25.00"),
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
          requestedAmount: money("5.00"),
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
          requestedAmount: money("15.00"),
          settledAmount: money("15.00"),
          chainId: DEMO_CHAIN_ID,
          chainTxRef:
            "0xeb5d904fe5ffc1f642f0dff25a94a2e865b86cfd18c55190be121e376e4691e0",
          expiresAt: minutesAgo(12958),
          createdAt: minutesAgo(12960),
        },
        {
          /*
            The two older deposits are what the earlier months were spent out of
            — 68.70 funded against the 8.69 charged since August (mostly the
            odd $1.20 deep_research call) leaves the 60.00 the ledger reports
            today, give or take a cent.
          */
          id: "dep_a3d97f61",
          status: "SETTLED",
          statusReason: null,
          agentId: PROD_AGENT,
          agentAccount: DEMO_BUYER_ACCOUNT,
          requestedAmount: money("12.00"),
          settledAmount: money("12.00"),
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
          requestedAmount: money("16.70"),
          settledAmount: money("16.70"),
          chainId: DEMO_CHAIN_ID,
          chainTxRef:
            "0x5c38c68d25f54d688ef3980cdc1a944b475793cb15cd470bab412c0efa7c9c0e",
          expiresAt: minutesAgo(66238),
          createdAt: minutesAgo(66240),
        },
];
}

/** The demo's withdrawal history: one request, cancelled before it was claimed. */
function demoWithdrawals() {
  return [
    {
      id: "wdr_5e81c0a2",
      chainId: DEMO_CHAIN_ID,
      account: DEMO_BUYER_ACCOUNT,
      status: "CANCELLED",
      requested: money("10.00"),
      received: null,
      requestedAt: minutesAgo(14_460),
      claimableAt: minutesAgo(14_400),
      closedAt: minutesAgo(14_430),
      requestTransactionHash: "0x8d0e5f7a1c2b3d4e5f60718293a4b5c6d7e8f9011a2b3c4d5e6f708192a3b4c5",
      closeTransactionHash: "0x1f2e3d4c5b6a79880716253443526170899a8b7c6d5e4f3021e2d3c4b5a69788",
    },
  ];
}

/**
 * `GET /statements/balance` for one month. The demo's call history is wider
 * than its deposits, so the balances are walked back from today's escrow
 * balance (closing at an instant = balance − deposits since + paid since):
 * every month adds up and the current one matches the escrow.
 */
function demoStatementBalance(query: Record<string, unknown>) {
  const { from, to } = windowOf(query);
  const now = Date.now();
  const deposited = (fromMs: number, toMs: number) =>
    demoDeposits()
      .filter((d) => d.status === "SETTLED" && Date.parse(d.createdAt) >= fromMs && Date.parse(d.createdAt) < toMs)
      .reduce((sum, d) => sum + Number(d.settledAmount!.amount), 0);
  const paid = (fromMs: number, toMs: number) =>
    fromMs >= toMs
      ? 0
      : Number(summaryBody({ from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(), groupBy: "tool" }).totals.chargedTotal.amount);
  const closingAt = (at: number) => BALANCE_MINOR - deposited(at, now) + paid(at, now);
  const end = Math.min(to, now);
  const check =
    to > now
      ? { escrowBalance: demoMoneyMinor(BALANCE_MINOR), stillSettling: demoMoneyMinor(0), difference: demoMoneyMinor(0), matches: true, observedAt: minutesAgo(1) }
      : null;
  return {
    account: DEMO_BUYER_ACCOUNT,
    chainId: DEMO_CHAIN_ID,
    opening: demoMoneyMinor(closingAt(from)),
    deposits: demoMoneyMinor(deposited(from, end)),
    withdrawals: demoMoneyMinor(0),
    paid: demoMoneyMinor(paid(from, end)),
    closing: demoMoneyMinor(closingAt(end)),
    check,
  };
}

/** Minor units as a wire amount in the demo asset (`money()` takes major ones). */
export function demoMoneyMinor(minor: number) {
  return money((minor / 1e6).toFixed(6));
}

/**
 * `GET /escrow/debts` for the picture `?debt=` asked for (see `demo-debts.ts`).
 * A fresh demo account owes nothing; a debt signed in the demo's simulated
 * settle sheet reads as being collected.
 */
export function demoDebts() {
  const variant = demoDebtVariant();
  if (freshStage() !== null || variant === "none") return [];
  const base = demoDebt();
  const debts =
    writtenOffVariant(variant)
      ? // `writeOffAt` comes from the call's own (older) time: see `callAge`.
        [{ ...base, state: "WRITTEN_OFF" as const, cause: `uncollected:${base.cause ?? "unknown"}` }]
      : variant === "other-wallet"
        ? [{ ...base, payer: demoOtherPayer() }]
        : variant === "collecting"
          ? [{ ...base, state: "REPLACING" as const, replacedAt: minutesAgo(1) }]
          : variant === "many"
            ? [
                {
                  ...base,
                  intentId: "d1e4b7a0-3c62-4f95-8b18-6a0e2d97c5f3",
                  toolId: wireToolId("geocode"),
                  providerId: TOOLS.geocode.provider,
                  amount: { ...base.amount, amount: money(TOOLS.geocode.price).amount },
                  state: "WRITTEN_OFF" as const,
                  cause: "uncollected:VoucherExpired",
                  // The same dates as every written-off demo debt (`writtenOffDates`), so no picture dates a write-off differently.
                  ...writtenOffDates(),
                },
                base,
                {
                  ...base,
                  intentId: "7f20c9d3-e815-4a6b-9c47-1d3b8e05a2c6",
                  payer: demoOtherPayer(),
                  toolId: wireToolId("deep_search"),
                  amount: { ...base.amount, amount: money(TOOLS.deep_search.price).amount },
                  cause: "EscrowWindowLimitExceeded",
                },
              ]
            : variant === "waiting"
              ? [{ ...base, replaceableAt: waitingReplaceableAt() }]
              : variant === "waiting-mixed"
                ? [
                    base,
                    {
                      ...base,
                      intentId: WAITING_DEBT_INTENT,
                      toolId: wireToolId("deep_search"),
                      amount: { ...base.amount, amount: money(TOOLS.deep_search.price).amount },
                      cause: "EscrowWindowLimitExceeded",
                      replaceableAt: waitingReplaceableAt(),
                    },
                  ]
                : [base];
  return debts.map((debt) =>
    debt.state !== "REPLACING" && demoDebtSigned(debt.intentId)
      ? { ...debt, state: "REPLACING" as const, replacedAt: justNow() }
      : debt,
  );
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

  if (call.classification === "SYSTEM_ERROR" || call.classification === "REQUEST_ERROR") {
    // No result, so no check ran — the real API has no verification record here.
    return ["SCHEMA", "DETERMINISTIC_RULES", "CROSS_CHECK", "SEMANTIC"].map(notReached);
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
  const created = minutesAgo(callAge(call));
  const settled = inFlight(call) ? null : minutesAgo(Math.max(callAge(call) - 1, 0));
  const charged = call.charged !== "0";

  return {
    intentId: call.intentId,
    toolId: wireToolId(call.toolId),
    providerId: providerOf(call),
    classification: call.classification,
    status: call.status,
    listedPrice: money(listedPrice(call)),
    chargedPrice: money(call.charged),
    withheld: money(call.debt ? "0" : notChargedMajor(call)),
    forfeited: false,
    debt: demoCallDebt(call).debt,
    chargeNote: demoCallDebt(call).chargeNote,
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
    expiresAt: minutesAgo(callAge(call) - 1440),
    updatedAt: settled ?? created,
    evaluatedAt: call.verdict ? settled : null,
    settledAt: charged ? settled : null,
    holdReleasedAt: charged ? null : settled,
    // The dispute hold: a charged call's payment is held for an hour after it settles.
    collectableAt: charged && settled ? minutesAgo(Math.max(callAge(call) - 1, 0) - HOLD_MINUTES) : null,
    disputeWindowEndsAt: charged && settled ? minutesAgo(Math.max(callAge(call) - 1, 0) - HOLD_MINUTES + 1) : null,
    // "Report a bad result" is accepted for 7 days after the call settled; null when it can't be reported.
    disputeFilingClosesAt: charged && settled ? minutesAgo(Math.max(callAge(call) - 1, 0) - 7 * 1440) : null,
    // The backend's own answer: a report now is refunded in full while the hold has more than a minute left.
    refundableIfReportedNow:
      charged && settled !== null && Date.parse(minutesAgo(Math.max(callAge(call) - 1, 0) - HOLD_MINUTES)) - 60_000 > Date.now(),
    // When that lapses: the collectable time minus the 60 s guard.
    refundableIfReportedUntil:
      charged && settled !== null && Date.parse(minutesAgo(Math.max(callAge(call) - 1, 0) - HOLD_MINUTES)) - 60_000 > Date.now()
        ? new Date(Date.parse(minutesAgo(Math.max(callAge(call) - 1, 0) - HOLD_MINUTES)) - 60_000).toISOString()
        : null,
  };
}

/** The dispute hold: how long a charged call's payment stays held after it settles. */
const HOLD_MINUTES = DISPUTE_HOLD_MINUTES;

/** The catalogue tool id of each tool this account calls (fixtures-explore's ids). */
export const DEMO_BUYER_TOOL_IDS = Object.fromEntries(TOOL_IDS.map((key) => [key, TOOLS[key].id])) as Record<ToolId, string>;
export type DemoBuyerTool = ToolId;

/**
 * A charged, passed call of `tool` that settled `settledMinutesAgo` ago, as
 * its receipt — for the "Report a bad result" pictures (inside and after the
 * 1-hour hold) and the calls behind the demo's reports. Not in the calls list:
 * it would change every total the other screens agree on.
 */
export function demoSettledReceipt(intentId: string, tool: ToolId, settledMinutesAgo: number) {
  return receiptBody({
    intentId,
    toolId: tool,
    minutesAgo: settledMinutesAgo + 1,
    charged: TOOLS[tool].price,
    status: "SETTLED",
    verdict: "PASS",
    classification: "DATA_RESULT",
    reasonCode: null,
    score: 0.91,
  });
}

/* ---------------------------------------------------------------- verdicts */

/** Only the finished calls have a verdict; an in-flight one has nothing to record yet. */
const JUDGED = CALLS.filter((call) => !inFlight(call) && call.verdict !== null);

function verdictRow(call: DemoCall) {
  return {
    id: verdictIdOf(call),
    intentId: call.intentId,
    toolId: wireToolId(call.toolId),
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
    createdAt: minutesAgo(callAge(call)),
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

/** A `deep_search` that passed (the owed call) found what it was asked for. */
const DEEP_SEARCH_PASSED_RESPONSE = {
  results: [
    { title: "Lumen Pay closes a $42m series B", url: "https://news.example/lumen-pay-series-b", date: "2026-09-03" },
    { title: "Kestrel Ledger raises $30m to expand in the Nordics", url: "https://news.example/kestrel-ledger", date: "2026-08-28" },
  ],
  truncated: false,
};

function evidenceBody(call: DemoCall) {
  const bodies =
    call.toolId === "deep_search" && call.verdict === "PASS"
      ? { ...EVIDENCE_BODIES.deep_search, response: DEEP_SEARCH_PASSED_RESPONSE }
      : EVIDENCE_BODIES[call.toolId];
  return {
    id: verdictIdOf(call),
    intentId: call.intentId,
    toolId: wireToolId(call.toolId),
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
    evaluatedAt: minutesAgo(Math.max(callAge(call) - 1, 0)),
    createdAt: minutesAgo(callAge(call)),
  };
}

/* ------------------------------------------------------------------ people */

const PROD_AGENT = "9d4c1f80-6b2e-4a57-8c31-7e05b9a2d146";
const STAGING_AGENT = "b71e05a3-2c48-4d90-9f61-38ca7d0b2e54";

/** Labels renamed on this tab (`PATCH /agents/:id`); a reload starts over. */
const demoAgentLabels = new Map<string, string>();

/** Forgets the renames (tests). */
export function resetDemoAgentLabels(): void {
  demoAgentLabels.clear();
}

function demoAgents(): { agentId: string; label: string; agentAccount: string; chainId: string; credentialCount: number }[] {
  const rows = [
    {
      agentId: PROD_AGENT,
      label: "prod",
      agentAccount: DEMO_BUYER_ACCOUNT,
      chainId: DEMO_CHAIN_ID,
      credentialCount: 2,
    },
    ...(freshStage()
      ? []
      : [
          {
            agentId: STAGING_AGENT,
            label: "staging",
            agentAccount: `${DEMO_CHAIN_ID}:${STAGING_ADDRESS}`,
            chainId: DEMO_CHAIN_ID,
            credentialCount: 1,
          },
        ]),
  ];
  return rows.map((row) => ({ ...row, label: demoAgentLabels.get(row.agentId) ?? row.label }));
}
const STAGING_ADDRESS = "0x2F5d8B17aC93e04f6b1D7c8A05E2f9B34cD61a70";
/**
 * The prod agent's own payment key (bound with `agent-cli bind`), authorised to
 * pay below. A function, not a constant: `fixtures.ts` imports this file, so
 * `DEMO_CHAIN_ID` is not initialised yet while this module evaluates.
 */
const prodDelegate = () => `${DEMO_CHAIN_ID}:0x18aB4c7E92d05F3b6A1c8D4e7F2a9B0c3D5e7296`;

/* --------------------------------------------------------------- fixtures */

/**
 * Order matters where two entries could match one path: the specific string is
 * always listed before the regex that would also take it.
 */
/* ------------------------------------------------- a fresh account (?fresh=) */

function freshDeposits() {
  const stage = freshStage();
  if (!stage || freshAtLeast(stage, "bind")) return null;
  return { items: [], pageInfo: { nextCursor: null, hasMore: false } };
}

function freshEscrow() {
  const stage = freshStage();
  if (!stage) return null;
  const opened = freshAtLeast(stage, "bind");
  return {
    exists: opened,
    chainReadable: true,
    account: DEMO_BUYER_ACCOUNT,
    escrowPda: null,
    escrowTokenAccount: null,
    balance: opened ? money("20.00") : null,
    openHolds: opened ? money("0") : null,
    spendable: opened ? money("20.00") : null,
    withdrawRequested: opened ? money("0") : null,
    withdrawAvailableAt: null,
    serverTime: justNow(),
    maxVoucherAmount: opened ? money("1.00") : null,
    maxPerWindow: opened ? money("20.00") : null,
    spentInWindow: opened ? money("0") : null,
    windowStartedAt: null,
    windowSeconds: 86400,
    observedAt: minutesAgo(1),
    // No lifetime line on a first-run escrow.
    lifetime: null,
  };
}

/**
 * The escrow under the `?debt=short` and `?debt=unread` pictures, so the
 * settle sheet's checks can be seen blocking and skipped. `null` otherwise.
 */
function debtEscrow() {
  const variant = demoDebtVariant();
  if (variant !== "short" && variant !== "unread") return null;
  const readable = variant === "short";
  const amount = (major: string) => (readable ? money(major) : null);
  return {
    exists: true,
    chainReadable: readable,
    account: DEMO_BUYER_ACCOUNT,
    escrowPda: null,
    escrowTokenAccount: null,
    // $1.00 against a $1.20 written-off debt, whose hold was released.
    balance: amount("1.00"),
    openHolds: amount("0"),
    spendable: amount("1.00"),
    withdrawRequested: amount("0"),
    withdrawAvailableAt: null,
    serverTime: justNow(),
    // A $1.00 per-call ceiling: the $1.20 payment is over it.
    maxVoucherAmount: amount("1.00"),
    maxPerWindow: amount("10.00"),
    spentInWindow: amount(SPENT_IN_WINDOW),
    windowStartedAt: readable ? minutesAgo(540) : null,
    windowSeconds: 86400,
    observedAt: readable ? minutesAgo(1) : null,
    lifetime: null,
    ...(readable ? savedEscrowCaps() : {}),
  };
}

/**
 * Charged in the escrow's current 24-hour window (it opened 9 hours ago):
 * today's five charged calls, 0.0012 + 0.0035 + 3 × 0.001 — the owed
 * $1.20 call was never collected, so it is not spent.
 */
const SPENT_IN_WINDOW = "0.0077";

function freshCredentials(agentId: string) {
  const stage = freshStage();
  if (!stage) return null;
  const page = { nextCursor: null, hasMore: false };
  if (stage === "new") return { items: [], pageInfo: page };
  return {
    items: [
      {
        id: "cred_fresh",
        agentId,
        name: "Key 1",
        prefix: "assay_live_f00d",
        scopes: ["tools:call"],
        lastUsedAt: stage === "call" ? null : minutesAgo(3),
        expiresAt: null,
        revokedAt: null,
        rotatedFromId: null,
        delegateAccount: stage === "pay" ? prodDelegate() : null,
        delegateBoundAt: stage === "pay" ? minutesAgo(2) : null,
        createdAt: minutesAgo(30),
      },
    ],
    pageInfo: page,
  };
}

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
      items: [
        ...(freshStage() ? [] : CALLS.filter(inFlight)).map((call) => ({
          id: `hld_${call.intentId.slice(0, 8)}`,
          intentId: call.intentId,
          amount: money(listedPrice(call)),
          status: "OPEN",
          createdAt: minutesAgo(call.minutesAgo),
          ageSeconds: call.minutesAgo * 60,
          expiresAt: minutesAgo(call.minutesAgo - 1440),
        })),
        // A buyer debt's price stays held until it is collected (see `demoDebtHolds`).
        ...demoDebtHolds().map((debt) => ({
          id: `hld_${debt.intentId.slice(0, 8)}`,
          intentId: debt.intentId,
          amount: { ...debt.amount },
          status: "OPEN",
          createdAt: debt.createdAt,
          ageSeconds: Math.max(Math.round((DEMO_NOW_MS - Date.parse(debt.createdAt)) / 1000), 0),
          expiresAt: debt.writeOffAt,
        })),
      ],
      pageInfo: { nextCursor: null, hasMore: false },
    }),
  },

  /* ----------------------------------------------------------- tool calls */
  {
    method: "GET",
    match: "/tool-calls",
    body: (_path, query) => {
      const { from, to } = windowOf(query);
      // `refundable=true`: the receipt's own flag, so the list and the receipt agree.
      if (query.refundable === "true" || query.refundable === true) {
        return {
          items: freshStage()
            ? []
            : CALLS.map((call) => ({ call, receipt: receiptBody(call) }))
                .filter(({ receipt }) => receipt.refundableIfReportedNow)
                .map(({ call, receipt }) => ({ ...toolCallRow(call), refundableIfReportedUntil: receipt.refundableIfReportedUntil })),
          pageInfo: { nextCursor: null, hasMore: false },
        };
      }
      return {
        // A fresh demo account has no calls in its history yet.
        items: freshStage() ? [] : CALLS.filter((call) => withinWindow(call, from, to)).map(toolCallRow),
        pageInfo: { nextCursor: null, hasMore: false },
      };
    },
  },
  {
    method: "GET",
    match: /^\/tool-calls\/[^/]+$/,
    // An id the demo does not know is a 404, as the API answers: a payment
    // link to nothing must read "not found", not show some other call.
    body: (path) => {
      const call = CALLS.find((c) => c.intentId === segment(path));
      if (!call) throw new ApiError("TOOL_CALL_NOT_FOUND", "No tool call with this id.", 404, path);
      return toolCallRow(call);
    },
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
    body: () => freshDeposits() ?? ({
      items: demoDeposits(),
      pageInfo: { nextCursor: null, hasMore: false },
    }),
  },

  /* ---------------------------------------------------------- withdrawals */
  {
    // One request the buyer cancelled: no money moved, so `lifetime.withdrawn` stays 0.
    method: "GET",
    match: "/withdrawals",
    body: () => ({ items: freshStage() ? [] : demoWithdrawals() }),
  },

  /* ----------------------------------------------------------- statements */
  {
    method: "GET",
    match: "/statements/balance",
    body: (_path, query) => ({ items: freshStage() ? [] : [demoStatementBalance(query)] }),
  },

  /* ----------------------------------------------------------- buyer debt */
  {
    method: "GET",
    match: "/escrow/debts",
    body: () => ({ account: DEMO_BUYER_ACCOUNT, debts: demoDebts() }),
  },

  /* --------------------------------------------------------------- escrow */
  {
    method: "GET",
    match: "/escrow",
    body: () => freshEscrow() ?? debtEscrow() ?? ({
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
      // The in-flight calls' 1.2177, plus the price of each debt still held (see `demoBuyerLedger`).
      balance: demoMoneyMinor(demoBuyerLedger().balance),
      openHolds: demoMoneyMinor(demoBuyerLedger().held),
      spendable: demoMoneyMinor(demoBuyerLedger().available),
      withdrawRequested: money("0"),
      withdrawAvailableAt: null,
      serverTime: justNow(),
      // Above the dearest call ($1.20 deep_research) and the agent key's own $1.50.
      maxVoucherAmount: money("2.00"),
      maxPerWindow: money("10.00"),
      spentInWindow: money(SPENT_IN_WINDOW),
      windowStartedAt: minutesAgo(540),
      windowSeconds: 86400,
      observedAt: minutesAgo(1),
      // The chain's lifetime counters: 68.70 deposited (`/deposits`) − 8.70 spent − 0 withdrawn = the balance.
      lifetime: {
        deposited: money("68.70"),
        spent: demoMoneyMinor(68_700_000 - BALANCE_MINOR),
        withdrawn: money("0"),
      },
      // A demo account ceiling change shows until reload.
      ...savedEscrowCaps(),
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
          perCallMax: money("2.00"),
          dailyCap: money("5.00"),
          monthlyCap: money("25.00"),
          maxCallsPerHour: 400,
          maxCallsPerMinute: 30,
          maxSpendPerHour: money("2.00"),
          requireApprovalAbove: money("1.50"),
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
          perCallMax: money("2.00"),
          dailyCap: money("2.00"),
          monthlyCap: money("25.00"),
          maxCallsPerHour: 400,
          maxCallsPerMinute: 30,
          maxSpendPerHour: money("2.00"),
          requireApprovalAbove: money("1.50"),
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
          perCallMax: money("2.00"),
          dailyCap: money("2.00"),
          monthlyCap: money("15.00"),
          maxCallsPerHour: null,
          maxCallsPerMinute: null,
          maxSpendPerHour: null,
          requireApprovalAbove: money("1.50"),
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
          perCallMax: money("1.00"),
          dailyCap: money("1.00"),
          monthlyCap: money("10.00"),
          maxCallsPerHour: null,
          maxCallsPerMinute: null,
          maxSpendPerHour: null,
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
    // Allow / Block on Explore, the Budgets screen and Pause all: this answers
    // the saved policy as the change would leave it, which the screens put in
    // their cache, and `demo-stage.ts` keeps the change for the tab, so the
    // next fetch and a reload show it too.
    method: "PATCH",
    match: "/spend-policy",
    body: (path, query, data) => {
      const current = (BUYER_FIXTURES.find((f) => f.method === "GET" && f.match === "/spend-policy")?.body(path, query) ??
        {}) as Record<string, unknown>;
      const change = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
      const { changeReason: _reason, ...fields } = change;
      // Kept for the tab, so Pause all stays paused on the next fetch and after a reload.
      rememberDemoPolicy(fields);
      return { ...current, ...fields, version: Number(current.version ?? 1) + 1, updatedAt: new Date().toISOString() };
    },
  },
  {
    method: "GET",
    match: "/spend-policy",
    body: () => {
      /*
        The enforcement side's own counters, which the Limits screen prefers
        over `/receipts/summary`. Both are folded out of the SAME day model the
        summary is, so "spent today" here and today's bar on `/` cannot
        drift apart: 0.0077 today, 2.5094 this month.
      */
      const todayStart = utcDayStart(Date.now());
      const monthStart = Date.UTC(
        new Date(todayStart).getUTCFullYear(),
        new Date(todayStart).getUTCMonth(),
        1,
      );
      const today = collect(todayStart, todayStart + DAY_MS, "tool").totals;
      const month = collect(monthStart, todayStart + DAY_MS, "tool").totals;

      return withDemoPolicy({
        id: "sp_northwind",
        scope: "ORGANIZATION",
        agentId: null,
        policyVersion: 4,
        asset: DEMO_ASSET,
        decimals: 6,
        perCallMax: money("2.00"),
        dailyCap: money("5.00"),
        monthlyCap: money("25.00"),
        maxCallsPerHour: 400,
        maxCallsPerMinute: 30,
        maxSpendPerHour: money("2.00"),
        requireApprovalAbove: money("1.50"),
        paused: false,
        changedBy: "ops@northwind-labs.example",
        changeReason: "Raised the daily cap for the September pilot",
        createdAt: minutesAgo(10080),
        usage: {
          spendToday: minorMoney(today.charged),
          spendThisMonth: minorMoney(month.charged),
          // Nothing charged in the last hour: its calls are still in flight.
          spendThisHour: money("0"),
          callsThisMinute: 2,
          callsThisHour: 11,
          usageReadable: true,
        },
      });
    },
  },

  /* --------------------------------------------------- agents, credentials */
  {
    // Rename in place: answers the agent as renamed, and the label is kept
    // for the tab so the next `GET /agents` (Connect, Overview, Explore) shows
    // it too.
    method: "PATCH",
    match: /^\/agents\/[^/]+$/,
    body: (path, _query, data) => {
      const agentId = segment(path);
      const label = typeof data?.label === "string" ? data.label.trim() : "";
      const agent = demoAgents().find((row) => row.agentId === agentId);
      // Like the server: an agent that is not this account's is not found.
      if (!agent) throw new ApiError("ACCOUNT_AGENT_NOT_FOUND", "Agent not found", 404, path);
      if (label) demoAgentLabels.set(agentId, label);
      return { ...agent, label: label || agent.label };
    },
  },
  {
    method: "GET",
    match: "/agents",
    /*
      `agentAccount` is CAIP-10 and Settings prints it whole, so a real agent row
      would put a `solana:…` account on the screen. Substituting always also
      keeps the agent ids stable, which is what the credentials fixture below
      reads back out of its own path.
    */
    body: () => ({
      items: demoAgents(),
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
      const fresh = freshCredentials(agentId);
      if (fresh) return fresh;
      const staging = agentId === STAGING_AGENT;
      return {
        items: [
          {
            id: staging ? "cred_9c41" : "cred_2f70",
            agentId,
            name: staging ? "staging runner" : "orchestrator",
            prefix: staging ? "assay_live_8fd2" : "assay_live_31ac",
            scopes: ["tools:call"],
            lastUsedAt: minutesAgo(staging ? 820 : 2),
            expiresAt: null,
            revokedAt: null,
            rotatedFromId: null,
            delegateAccount: staging ? null : prodDelegate(),
            delegateBoundAt: staging ? null : minutesAgo(64000),
            createdAt: minutesAgo(staging ? 46080 : 66240),
          },
          ...(staging
            ? []
            : [
                {
                  id: "cred_0b19",
                  agentId,
                  name: "CI deploy",
                  prefix: "assay_live_a47e",
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

  /* ------------------------------------------------- pay permissions */
  {
    // The prod agent's key may pay up to $1.50 a call and $5 in 24 h; staging has
    // no payment key yet, so it shows the bind step.
    method: "GET",
    match: "/escrow/delegates",
    body: () => (freshStage() ? { account: DEMO_BUYER_ACCOUNT, delegates: [], tightenDelaySeconds: demoTightenDelaySeconds() } : ({
      account: DEMO_BUYER_ACCOUNT,
      // `?tighten=1h` shows an escrow that delays a tightening (D-21); 0 by default.
      tightenDelaySeconds: demoTightenDelaySeconds(),
      delegates: [
        {
          delegate: prodDelegate(),
          maxVoucherAmount: money("1.50"),
          maxPerWindow: money("5.00"),
          spentInWindow: money(SPENT_IN_WINDOW),
          // Five days left, so the demo shows the "permission ends soon" chip and Renew.
          validUntil: new Date(DEMO_NOW_MS + 5 * 86_400_000 + 3_600_000).toISOString(),
          status: "ACTIVE",
          // Nothing signed is waiting to be collected; the 24-hour cap holds what was spent.
          unsettled: { count: 0, amount: money("0"), largest: money("0"), windowNeeds: money(SPENT_IN_WINDOW), redeemableUntil: null },
          // A demo "Sign and save" shows its new limits until reload.
          ...savedDelegateCaps(prodDelegate()),
        },
      ],
    })),
  },
  {
    // "Create key": a made-up key, shown once like the real one. Nothing is
    // stored, so the list does not grow — the reveal is what a reviewer needs.
    method: "POST",
    match: /^\/agents\/[^/]+\/credentials$/,
    body: (path, _query, body) => {
      const name = (body as { name?: unknown } | undefined)?.name;
      // A fresh account with no key now has one: the agent cards and Get
      // started read it back on their next fetch.
      advanceFreshStage("new", "call");
      return {
        id: "cred_demo_new",
        agentId: segment(path, 1),
        name: typeof name === "string" && name.trim() ? name.trim() : "Key 1",
        prefix: "assay_live_d3m0",
        token: "assay_live_d3m0_demo-key-shown-once-not-a-real-secret",
        scopes: ["tools:call"],
        createdAt: new Date().toISOString(),
      };
    },
  },
  {
    method: "GET",
    match: "/escrow/unsettled",
    body: () => ({ account: DEMO_BUYER_ACCOUNT, unsettled: null, tightenDelaySeconds: demoTightenDelaySeconds() }),
  },

  /* ------------------------------------------------------------ audit log */
  {
    method: "GET",
    match: "/audit-log",
    body: () => (freshStage() ? { items: [], pageInfo: { nextCursor: null, hasMore: false } } : {
      items: [
        {
          id: "aud_77a4",
          actorType: "agent",
          actorId: PROD_AGENT,
          action: "session.created",
          resourceType: "session",
          resourceId: "ses_41d8",
          before: null,
          after: { credential: "assay_live_31ac" },
          createdAt: minutesAgo(1440),
        },
        {
          id: "aud_0f81",
          actorType: "system",
          actorId: null,
          action: "payment_intent.refunded",
          resourceType: "payment_intent",
          resourceId: "b90f2c48-3a71-4e69-85d0-2f4a6c19e7b5",
          before: { charged: "1.20" },
          after: { charged: "0.00" },
          createdAt: minutesAgo(1558),
        },
        {
          id: "aud_5b2c",
          actorType: "system",
          actorId: null,
          action: "payment_intent.voided",
          resourceType: "payment_intent",
          resourceId: "e48a3b19-7c65-4d02-8f1b-5a97c2e04d63",
          before: { charged: "0.012" },
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
          after: { amount: "25.00", chain: "eip155:46630" },
          createdAt: minutesAgo(2878),
        },
        {
          id: "aud_9e46",
          actorType: "user",
          actorId: "ops@northwind-labs.example",
          action: "spend_policy.updated",
          resourceType: "spend_policy",
          resourceId: "sp_northwind",
          before: { dailyCap: "2.00" },
          after: { dailyCap: "5.00" },
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
    body: () => ({ count: freshStage() ? 0 : demoNotifications().filter((n) => !n.readAt).length }),
  },
  {
    method: "GET",
    match: "/notifications",
    // A fresh demo account has had no alerts. `unreadOnly` is honoured, as the server does.
    body: (_path, query) => {
      if (freshStage()) return { items: [], pageInfo: { nextCursor: null, hasMore: false } };
      const unreadOnly = String(query?.unreadOnly) === "true";
      return { items: demoNotifications().filter((n) => !unreadOnly || !n.readAt), pageInfo: { nextCursor: null, hasMore: false } };
    },
  },
  {
    method: "PATCH",
    match: /^\/notifications\/[^/]+\/read$/,
    body: (path) => {
      // Any id: the demo feed also carries tool-set and contract notices made elsewhere.
      const id = path.split("/")[2] ?? "";
      demoReadIds.add(id);
      const row = demoNotifications().find((n) => n.id === id);
      return row ?? { id, readAt: new Date().toISOString() };
    },
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
        destination: "https://hooks.northwind-labs.example/assay/alerts",
        enabled: false,
        verifiedAt: null,
        createdAt: minutesAgo(21600),
      },
    ],
  },
];

/** Alerts the demo visitor marked read (Dismiss, opening "See all alerts"), for this page load. */
const demoReadIds = new Set<string>();

/** Test hook: forget what was marked read. */
export function resetDemoNotificationsRead(): void {
  demoReadIds.clear();
}

function demoNotifications(): { id: string; readAt: string | null; [key: string]: unknown }[] {
  const rows: { id: string; readAt: string | null; [key: string]: unknown }[] = [
    {
      id: "ntf_4c17",
      event: "velocity.anomaly",
      severity: "WARNING",
      title: "geocode_place ran at eight times its usual rate for 20 minutes",
      body: "34 calls between 09:10 and 09:30 UTC against a 7-day median of 4 in that window. Nothing was refused — the per-minute ceiling is 30 and the burst stayed under it.",
      subjectType: "tool",
      subjectId: TOOLS.geocode.id,
      readAt: null,
      createdAt: minutesAgo(96),
    },
    {
      id: "ntf_2fa9",
      event: "spend.threshold_crossed",
      severity: "INFO",
      title: "This month's spend passed 10% of the monthly spending limit",
      body: "$2.5094 charged of a $25.00 cap. This is a notice, not a refusal — a limit is what refuses.",
      subjectType: "spend_policy",
      subjectId: "sp_northwind",
      readAt: minutesAgo(1300),
      createdAt: minutesAgo(1440),
    },
    {
      id: "ntf_8b30",
      event: "payment_intent.refunded",
      severity: "INFO",
      title: "A deep_research call failed our checks — $1.20 was not charged",
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
      title: "$25.00 credited",
      body: "Observed on Robinhood Chain testnet and credited in full. The credited amount is what we observed on chain.",
      subjectType: "deposit",
      subjectId: "dep_7f2a91c4",
      readAt: minutesAgo(2870),
      createdAt: minutesAgo(2878),
    },
  ];
  return rows.map((row) => (demoReadIds.has(row.id) ? { ...row, readAt: row.readAt ?? new Date().toISOString() } : row));
}
