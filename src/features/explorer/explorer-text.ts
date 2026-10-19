import type { Money } from "@/interfaces";
import { DAILY_CAP_PERCENT } from "@/features/explorer/provider-economics";
import { MIN_CHECKED_CALLS } from "@/features/provider-sla/reading";
import { toDecimal, formatDecimal } from "@/utils/money";

/**
 * Plain-language pieces shared by the public Explorer (`/catalogue`) and the
 * signed-in Explore (`/explore`): prices, free tier, observed failures, stake
 * and what a check covers. Pure, so both screens say the same words and the
 * words are tested once.
 */

/**
 * A per-call price: two decimals from a cent up ("$0.25"), the asset's own
 * scale below it with trailing zeros dropped ("$0.001"), so a price under a
 * cent never reads "$0.00".
 */
export function formatCallPrice(money: Money | null | undefined): string {
  if (!money) return "—";
  const value = toDecimal(money);
  if (value.isZero()) return "Free";
  return formatDecimal(value, { decimals: money.decimals });
}

/** `FREE` / `FREEMIUM` / `PAID` / null → the mode a person reads. */
export function normalisedMode(mode: string | null | undefined): "FREE" | "FREEMIUM" | "PAID" | null {
  const upper = (mode ?? "").toUpperCase();
  return upper === "FREE" || upper === "FREEMIUM" || upper === "PAID" ? upper : null;
}

/** Whether calls to this tool can cost nothing for a while. */
export function hasFreeTier(mode: string | null | undefined): boolean {
  const m = normalisedMode(mode);
  return m === "FREE" || m === "FREEMIUM";
}

/**
 * The free-tier badge text: "Free · 100 calls/day per agent" (the backend
 * counts free calls per agent, per listing, per UTC day). With no number known yet
 * (the list endpoint does not carry it), just "Free tier"; for a fully free
 * tool, "Free" — "Free, up to 100 calls/day per agent" when it has a daily cap.
 */
export function freeTierLabel(mode: string | null | undefined, callsPerDay?: number | null): string | null {
  const m = normalisedMode(mode);
  if (m === "FREE") return `Free${freeCap(callsPerDay)}`;
  if (m !== "FREEMIUM") return null;
  if (callsPerDay && callsPerDay > 0) return `Free · ${callsPerDay.toLocaleString("en-US")} calls/day per agent`;
  return "Free tier";
}

/**
 * The smallest daily free allowance across the listings that offer one —
 * what an agent can count on whichever provider it is routed to. null when
 * no listing offers a free tier.
 */
export function smallestFreeAllowance(values: readonly (number | null | undefined)[]): number | null {
  const offered = values.filter((v): v is number => typeof v === "number" && v > 0);
  return offered.length > 0 ? Math.min(...offered) : null;
}

/** One sentence on what a call costs and when. */
export function priceSentence(input: {
  mode: string | null | undefined;
  price: Money | null | undefined;
  freeCallsPerDay?: number | null;
  /**
   * When paid providers charge different prices: the cheapest. The sentence
   * then says the price after the free calls depends on who serves the call,
   * rather than naming the dearest as if it were the one price.
   */
  from?: Money | null;
}): string {
  const m = normalisedMode(input.mode);
  if (m === "FREE") return "Free to call. Results are still checked.";
  if (!input.price) return "Not available to call right now — no provider is serving it.";
  const price = formatCallPrice(input.price);
  if (m === "FREEMIUM") {
    const free = input.freeCallsPerDay && input.freeCallsPerDay > 0
      ? `The first ${input.freeCallsPerDay.toLocaleString("en-US")} calls each day are free for each agent`
      : "Some calls each day are free for each agent";
    if (input.from && !toDecimal(input.from).eq(toDecimal(input.price))) {
      return `${free}, even when other providers charge for it. After that, a call costs the price of the provider that serves it, from ${formatCallPrice(input.from)} to ${price}, and you pay only if the result passes the check.`;
    }
    return `${free}, even when other providers charge for it; after that ${price} per call, and you pay only if the result passes the check.`;
  }
  return `${price} per call. You pay only if the result passes the check.`;
}

/** How far back the public failure rate looks: the backend's `PUBLIC_QUALITY_WINDOW_DAYS` (D5). */
export const FAILURE_RATE_WINDOW_DAYS = 30;

/** A 0..1 rate as a person reads it: "5%", "2.5%", "0.1%". */
export function percentText(rate: number): string {
  const pct = rate * 100;
  return `${Number(pct.toFixed(pct < 1 ? 2 : 1))}%`;
}

/**
 * The failure rate, from the platform's own measurement, with its scope and
 * window: every call checked for any of the provider's tools in the check
 * windows active in the last 30 days, open ones included
 * (`SlaWindowRepository.qualityByProvider`; a window counts whole, so the
 * period is approximate by up to one 7-day window).
 * With `promised` (the listing's `promisedFailureRate`), the promise the
 * penalties are measured against sits beside it: "10.5% failed · promised at
 * most 5% · 95 checked calls to all their tools, last 30 days".
 */
export function failRateLabel(
  quality: { measuredCalls: number; failedCalls: number } | null | undefined,
  promised?: number | null,
  /** What the promise covers, when it is narrower than the rate: "this tool" on a tool page's provider row. */
  promiseScope?: string,
): string {
  const promise =
    typeof promised === "number"
      ? ` · promised at most ${percentText(promised)}${promiseScope ? ` for ${promiseScope}` : ""}`
      : "";
  if (!quality || quality.measuredCalls <= 0) return `Not measured yet${promise}`;
  const calls = quality.measuredCalls === 1 ? "checked call" : "checked calls";
  return `${failRateShort(quality)}${promise} · ${quality.measuredCalls.toLocaleString("en-US")} ${calls} to all their tools, last ${FAILURE_RATE_WINDOW_DAYS} days`;
}

/**
 * The failure rate alone, for a compact stat: "10.5% failed" / "Not measured
 * yet". The promise's own rule (`percentText`) at every size: one decimal
 * from 1%, two below, a trailing zero dropped ("5%", "10.5%", "0.25%"), so a
 * rate reads like the promise beside it. It used to switch to whole numbers
 * at 10%, so "5.0%" and "11%" sat side by side (V1-7).
 */
export function failRateShort(quality: { measuredCalls: number; failedCalls: number } | null | undefined): string {
  if (!quality || quality.measuredCalls <= 0) return "Not measured yet";
  const pct = (quality.failedCalls / quality.measuredCalls) * 100;
  const shown = pct === 0 ? "0%" : pct < 0.1 ? "<0.1%" : percentText(quality.failedCalls / quality.measuredCalls);
  return `${shown} failed`;
}

/**
 * The one promised rate to show for a provider: set only when every listing
 * that states one states the same, so a provider-wide figure is never paired
 * with one tool's promise.
 */
export function uniformPromise(values: readonly (number | null | undefined)[]): number | null {
  const stated = [...new Set(values.filter((v): v is number => typeof v === "number"))];
  return stated.length === 1 ? stated[0] : null;
}

/** A failure rate at or above this, over enough calls, earns a warning chip. */
export const HIGH_FAILURE_RATE = 0.2;
/** Fewer checked calls than this is too few to call a provider unreliable (D5). */
export const HIGH_FAILURE_MIN_CALLS = 20;

/**
 * Whether a provider fails often enough that a buyer should know before
 * routing to it: at least 20% of at least 20 checked calls. Shown, never
 * hidden — a failed call is not charged, but it still costs the agent time.
 */
export function failsOften(quality: { measuredCalls: number; failedCalls: number } | null | undefined): boolean {
  if (!quality || quality.measuredCalls < HIGH_FAILURE_MIN_CALLS) return false;
  return quality.failedCalls / quality.measuredCalls >= HIGH_FAILURE_RATE;
}

/**
 * The penalty rule in one sentence, as `/why-list-here` states it: a provider
 * loses stake only for failing more often than it promised, judged over a
 * full window, and never more than the daily cap.
 */
export function stakeRuleSentence(): string {
  return (
    `A provider that fails more often than it promised, over at least ${MIN_CHECKED_CALLS} checked calls in a window, ` +
    `loses part of its stake (never more than ${DAILY_CAP_PERCENT}% of it in any 24 hours), and part of that goes to the buyers it served badly.`
  );
}

/** One chain's price for a tool (`prices[]` on the catalogue): the quote there, and whose listing sets it. */
export interface ChainPrice {
  /** CAIP-2. */
  chainId: string;
  price: Money;
  /** The one provider at that price, from the router's own priced set; null when several share it. */
  providerId: string | null;
  /** Eligible listings on that chain the price was taken over. Optional for an older API. */
  listings?: number;
}

/**
 * The chain prices, the one to lead with first: the reader's own chains in
 * their order of preference (signed in), else the chain of the headline quote
 * (`held`), else the server's order.
 */
export function orderChainPrices(
  prices: readonly ChainPrice[] | null | undefined,
  preferredChains: readonly string[] | null | undefined,
  held: Money | null | undefined,
): ChainPrice[] {
  const list = [...(prices ?? [])];
  const preferred = (preferredChains ?? [])
    .map((chainId) => list.find((entry) => entry.chainId === chainId))
    .find((entry) => entry !== undefined);
  const lead = preferred ?? list.find((entry) => held && entry.price.asset === held.asset) ?? list[0];
  return lead ? [lead, ...list.filter((entry) => entry !== lead)] : [];
}

/**
 * The chains a buyer can pay on now, best funded first: balance rows with a
 * spendable amount above zero. A $0 row (left by any past activity) is not a
 * chain to lead a price with.
 */
export function fundedChains(rows: readonly { chainId: string; available: Money }[] | null | undefined): string[] {
  return [...(rows ?? [])]
    .filter((row) => toDecimal(row.available).gt(0))
    .sort((a, b) => toDecimal(b.available).cmp(toDecimal(a.available)))
    .map((row) => row.chainId);
}

/**
 * The provider to name beside a chain's price: only when exactly one eligible
 * listing serves that chain. With two or more, the price is the dearest of
 * them, and naming one would say the wrong provider serves the call.
 */
export function chainProviderName(
  entry: ChainPrice,
  nameOf: (providerId: string) => string | null | undefined,
): string | null {
  if (entry.listings !== 1 || !entry.providerId) return null;
  return nameOf(entry.providerId) ?? null;
}

/**
 * The per-chain price lines of a tool page: the lead chain's "where" (under
 * the big price; no name when the lead's own price is a range), and one full
 * line per other chain.
 */
export function chainPriceLines(
  ordered: readonly ChainPrice[],
  options: {
    chainName: (chainId: string) => string;
    nameOf: (providerId: string) => string | null | undefined;
    /** The lead chain's price is a range ("from …"), so no one provider sets it. */
    leadIsRange?: boolean;
  },
): { lead: string | null; others: { chainId: string; text: string }[] } {
  const [first, ...rest] = ordered;
  return {
    lead: first
      ? chainPriceWhere(first.chainId, options.chainName, options.leadIsRange ? null : chainProviderName(first, options.nameOf))
      : null,
    others: rest.map((entry) => ({
      chainId: entry.chainId,
      text: chainPriceText(entry, options.chainName, chainProviderName(entry, options.nameOf)),
    })),
  };
}

/**
 * "Paid on Robinhood Chain testnet, Solana devnet": the settlement chains,
 * each marked when it has no price right now (a per-chain quote can fail while
 * the chain stays in the tool's settlement list).
 */
export function paidOnText(
  settles: readonly string[],
  prices: readonly ChainPrice[] | null | undefined,
  chainName: (chainId: string) => string,
): string {
  const priced = new Set((prices ?? []).map((entry) => entry.chainId));
  const checkPrices = (prices ?? []).length > 0;
  return `Paid on ${settles
    .map((chainId) => `${chainName(chainId)}${checkPrices && !priced.has(chainId) ? " (price unavailable right now)" : ""}`)
    .join(", ")}.`;
}

/** "on Robinhood Chain testnet (E2E Weather Ltd)", or without the name when it is not known or not one provider. */
export function chainPriceWhere(chainId: string, chainName: (chainId: string) => string, providerName?: string | null): string {
  return `on ${chainName(chainId)}${providerName ? ` (${providerName})` : ""}`;
}

/** "$0.10 per call on Robinhood Chain testnet (E2E Weather Ltd)" / "Free on Solana devnet". */
export function chainPriceText(
  entry: ChainPrice,
  chainName: (chainId: string) => string,
  providerName?: string | null,
): string {
  const price = formatCallPrice(entry.price);
  return `${price}${price === "Free" ? "" : " per call"} ${chainPriceWhere(entry.chainId, chainName, providerName)}`;
}

/**
 * A tool's price when its providers charge different prices. The backend holds
 * a call at the quote — the dearest provider that can take it now — and then
 * charges the price of the provider that actually served it (rail A re-prices
 * the intent to the serving listing; a rail-B voucher signs that listing's own
 * price). So the headline is "from $min" and the line says both halves.
 */
export function priceRange(
  held: Money | null | undefined,
  listed: readonly (Money | null | undefined)[],
): { from: Money; held: Money; differs: boolean } | null {
  if (!held) return null;
  // A free binding is not a paid price: a FREE listing beside one paid listing
  // does not make the paid price a range (review 2026-10-15, L2).
  const prices = listed.filter((m): m is Money => Boolean(m) && m!.asset === held.asset && !toDecimal(m!).isZero());
  const eligible = prices.filter((m) => toDecimal(m).lte(toDecimal(held)));
  const from = eligible.reduce<Money>((min, m) => (toDecimal(m).lt(toDecimal(min)) ? m : min), held);
  return { from, held, differs: !toDecimal(from).eq(toDecimal(held)) };
}

/**
 * The one price line a tool shows: the free tier and the price together, free
 * first — "Free for 100 calls/day per agent, then $0.002 per call". "from" leads the price
 * only when the paid listings charge different prices (see `priceRange`, which
 * ignores free listings), so a free listing beside one paid listing never turns
 * the paid price into a range.
 *
 * `lead` and `price` are apart so a screen can set the price larger; `text` is
 * the whole line.
 */
export interface OfferLine {
  /** "Free for 100 calls/day per agent, then" / "Free tier, then"; null for a paid-only or free-only tool. */
  lead: string | null;
  /** "$0.002" / "from $0.002" / "Free" / "—"; empty when the lead says it all. */
  price: string;
  /** " per call" after a paid price; empty for "Free" and "—". */
  unit: string;
  /** ", up to 100 calls/day per agent" after "Free": a FREE listing's daily cap, as wrapping text. */
  cap?: string;
  text: string;
}

/** ", up to 100 calls/day per agent", or "" without a cap. */
function freeCap(freeCallsPerDay: number | null | undefined): string {
  return freeCallsPerDay && freeCallsPerDay > 0 ? `, up to ${freeCallsPerDay.toLocaleString("en-US")} calls/day per agent` : "";
}

/**
 * One provider's listing of a tool, in the same words as `offerLine`: "Free,
 * up to 100 calls/day per agent" (FREE), "Free for 50 calls/day per agent,
 * then $0.12 per call" (FREEMIUM), "$0.12 per call" (PAID). For the "Who
 * serves it" rows, where a bare price plus "100 free calls/day" contradicted
 * itself on a FREE listing.
 */
export function listingOfferText(listing: {
  pricingMode: string | null | undefined;
  price: Money | null | undefined;
  freeCallsPerAgentPerDay?: number | null;
}): string {
  return offerLine({
    mode: listing.pricingMode,
    range: listing.price ? { from: listing.price, held: listing.price, differs: false } : null,
    freeCallsPerDay: listing.freeCallsPerAgentPerDay,
  }).text;
}

export function offerLine(input: {
  mode: string | null | undefined;
  range: { from: Money; held: Money; differs: boolean } | null | undefined;
  freeCallsPerDay?: number | null;
}): OfferLine {
  const m = normalisedMode(input.mode);
  if (m === "FREE") {
    // Every call is free, up to a daily cap: never "Free per call · 100 free calls/day" (final2 P3).
    const cap = freeCap(input.freeCallsPerDay);
    return cap ? { lead: null, price: "Free", unit: "", cap, text: `Free${cap}` } : { lead: null, price: "Free", unit: "", text: "Free" };
  }
  const lead =
    m === "FREEMIUM"
      ? input.freeCallsPerDay && input.freeCallsPerDay > 0
        ? `Free for ${input.freeCallsPerDay.toLocaleString("en-US")} calls/day per agent, then`
        : "Free tier, then"
      : null;
  if (!input.range) {
    // A freemium tool with no paid route: the sentence is the lead, not a price (an empty price slot).
    if (lead) {
      const text = "Free tier; paid calls not available right now";
      return { lead: text, price: "", unit: "", text };
    }
    return { lead: null, price: "—", unit: "", text: "—" };
  }
  const price = `${input.range.differs ? "from " : ""}${formatCallPrice(input.range.from)}`;
  return { lead, price, unit: " per call", text: `${lead ? `${lead} ` : ""}${price} per call` };
}

/** The small line under a list row's price: when you pay, and the most a call is held for. */
export function offerSubLine(
  mode: string | null | undefined,
  range: { from: Money; held: Money; differs: boolean } | null | undefined,
): string {
  if (!range || normalisedMode(mode) === "FREE") return "";
  if (range.differs) return `held at most ${formatCallPrice(range.held)}, paid only if it passes`;
  return normalisedMode(mode) === "FREEMIUM" ? "after the free calls, only if it passes" : "paid only if it passes";
}

/**
 * The sentence under a tool page's price. Free first: a FREEMIUM tool says its
 * free calls before the range, so a range never drops the free-first sentence.
 */
export function costSentence(input: {
  mode: string | null | undefined;
  price: Money | null | undefined;
  range: { from: Money; held: Money; differs: boolean } | null | undefined;
  freeCallsPerDay?: number | null;
}): string {
  const rangeLine = input.range ? heldPriceSentence(input.range) : null;
  if (normalisedMode(input.mode) === "FREEMIUM") {
    // The range is said inside the free-first sentence; only the hold is added.
    const from = input.range?.differs ? input.range.from : null;
    const base = priceSentence({ mode: input.mode, price: input.price, freeCallsPerDay: input.freeCallsPerDay, from });
    const held = input.range?.differs ? `You are held at most ${formatCallPrice(input.range.held)} per call.` : null;
    return [base, held].filter(Boolean).join(" ");
  }
  const base = priceSentence({ mode: input.mode, price: input.price, freeCallsPerDay: input.freeCallsPerDay });
  return rangeLine ?? base;
}

/** The sentence under a "from $X" price. */
export function heldPriceSentence(range: { from: Money; held: Money; differs: boolean }): string | null {
  if (!range.differs) return null;
  return `Providers charge from ${formatCallPrice(range.from)} to ${formatCallPrice(range.held)}. You are held at most ${formatCallPrice(range.held)}; you pay the price of the provider that served the call, and only if the result passes.`;
}

/**
 * Stake, one line per chain (never a sum across chains). Empty means nobody
 * could read it — "Not known", never "$0".
 */
export function stakeSummary(
  stake: readonly (Money & { chainId: string })[],
  chainName: (chainId: string) => string,
): string {
  // An empty list is "the chain could not be read just now", never "no stake"
  // and never a doubt about who the provider is (Verified is about identity).
  // Said calmly: to a newcomer "could not be read" looks like an error on the page.
  if (stake.length === 0) return "Not available yet";
  return stake
    .map((entry) => `${formatDecimal(toDecimal(entry), { decimals: 2 })} on ${chainName(entry.chainId)}`)
    .join(" · ");
}

/** What a tool's results are checked for, as sentences. */
export function checkSentences(tier: string | null | undefined): string[] {
  const base = "Every result is checked against the tool's required shape and quality rules before anyone is charged.";
  switch ((tier ?? "").toUpperCase()) {
    case "GUARANTEED":
      return [base, "Every call also gets a relevance check: does the answer fit the question?"];
    case "VERIFIED":
      return [base, "A sample of calls also gets a relevance check: does the answer fit the question?"];
    default:
      return [base];
  }
}

/** "1 call" / "3 calls". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** Sum of a list of same-asset Money, or the list grouped per asset. */
export function moneyByAsset(items: readonly Money[]): Money[] {
  const map = new Map<string, Money>();
  for (const item of items) {
    const prev = map.get(item.asset);
    map.set(
      item.asset,
      prev
        ? { ...prev, amount: (BigInt(prev.amount || "0") + BigInt(item.amount || "0")).toString() }
        : { ...item },
    );
  }
  return [...map.values()];
}

/** `2026-10-14` → "14 Oct". Days are UTC on the wire and shown as such. */
export function shortDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * Whether a provider's listing is priced above what a call is held for. The
 * hold is the dearest provider that can take a paid call now, so a listing
 * above it is not being sent paid calls (paid calls go only to providers whose
 * stake covers them).
 */
export function notTakingPaidCalls(held: Money | null | undefined, listing: Money | null | undefined): boolean {
  if (!held || !listing || listing.asset !== held.asset) return false;
  return BigInt(listing.amount) > BigInt(held.amount);
}

export interface RoutingProvider {
  name: string;
  price: Money | null | undefined;
  quality: { measuredCalls: number; failedCalls: number } | null | undefined;
}

/**
 * The lines under "Who serves it" that keep the price and the provider list
 * coherent:
 *
 *  - a provider priced above the hold is said by name, with why it gets no
 *    paid calls — so a "$0.10" headline next to a "$0.25" provider reads right;
 *  - a provider marked "Fails often" that still takes the calls gets one line
 *    saying so, and that failed results are never charged.
 */
export function routingNotes(
  held: Money | null | undefined,
  providers: readonly RoutingProvider[],
  /** Names a chain from its CAIP-2 id; when given, a provider paid on another chain is said as such. */
  chainName?: (chainId: string) => string,
  /** `chainsListed`: the page already lists the price per chain, so the other-chain note is not repeated. */
  options: { chainsListed?: boolean } = {},
): string[] {
  const notes: string[] = [];
  // A listing in another asset is priced on another chain: compare it to nothing, name its chain.
  const elsewhere = held && chainName ? providers.filter((p) => p.price && p.price.asset !== held.asset) : [];
  if (held && chainName && elsewhere.length > 0 && !options.chainsListed) {
    const chainOf = (asset: string) => chainName(asset.split("/")[0]);
    notes.push(
      `The price above is for ${chainOf(held.asset)}. ${elsewhere
        .map((p) => `${p.name} charges ${formatCallPrice(p.price)} per call on ${chainOf(p.price!.asset)}`)
        .join("; ")}.`,
    );
  }
  const sameChain = providers.filter((p) => !elsewhere.includes(p));
  const idle = sameChain.filter((p) => notTakingPaidCalls(held, p.price));
  const taking = sameChain.filter((p) => !notTakingPaidCalls(held, p.price));
  if (idle.length > 0 && taking.length > 0) {
    const named = idle.map((p) => `${p.name} (${formatCallPrice(p.price)} per call)`).join(", ");
    notes.push(
      `${named} ${idle.length === 1 ? "is" : "are"} not taking paid calls right now: paid calls go only to providers whose stake covers them. The price above counts only the providers taking calls.`,
    );
  }
  const failing = taking.filter((p) => failsOften(p.quality));
  if (failing.length > 0) {
    notes.push(
      taking.length === 1
        ? `Calls go to ${failing[0].name}, the only provider taking calls; it has failed often recently. Failed results are never charged.`
        : `${failing.map((p) => p.name).join(", ")} ${failing.length === 1 ? "has failed often recently and still takes" : "have failed often recently and still take"} calls. Failed results are never charged.`,
    );
  }
  return notes;
}

/** The Explorer's list state, as it rides in the URL so Back from a tool restores it. */
export interface ExplorerListState {
  view: "tools" | "providers" | "toolsets";
  q: string;
  /** Tools with free calls only. */
  free: boolean;
}

export function readExplorerState(params: { get(name: string): string | null }): ExplorerListState {
  return {
    view: params.get("view") === "providers" ? "providers" : params.get("view") === "toolsets" ? "toolsets" : "tools",
    q: params.get("q") ?? "",
    free: params.get("free") === "1",
  };
}

/** `/catalogue` with only the non-default parts of the state in its query. */
export function explorerHref(state: ExplorerListState): string {
  const params = new URLSearchParams();
  if (state.view !== "tools") params.set("view", state.view);
  if (state.q.trim()) params.set("q", state.q);
  if (state.free && state.view === "tools") params.set("free", "1");
  const query = params.toString();
  return query ? `/catalogue?${query}` : "/catalogue";
}

/** Whether a tool has free calls: free outright, or a free tier on some listing. */
export function hasFreeCalls(mode: string | null | undefined): boolean {
  return freeTierLabel(mode) !== null;
}

/**
 * The one label per not-charged reason, shared by the feed rows and the count
 * lines, so a reader can tie a row to its count. Keyed by the server's
 * `NotChargedReason`.
 */
const NOT_CHARGED_REASON_LABEL: Record<string, string> = {
  FAILED_CHECK: "Result failed our check",
  PROVIDER_ERROR: "Provider returned an error",
  REQUEST_REJECTED: "Provider rejected the request",
  NO_USABLE_RESULT: "No usable result",
  OUT_OF_SCOPE: "Request outside what the tool covers",
  EXPIRED: "Did not finish in time",
  NOT_COLLECTED: "Payment not collected",
};

/**
 * A fixed tone per reason key, so a reason keeps its colour whatever else is
 * listed. Every tone is a different hue: success green sits next to the
 * guarantee's teal and read as the same dot (review 2026-10-17 P3-3), so it is
 * not used here.
 */
const NOT_CHARGED_REASON_TONE = {
  FAILED_CHECK: "teal",
  PROVIDER_ERROR: "info",
  REQUEST_REJECTED: "indigo",
  NO_USABLE_RESULT: "primary",
  OUT_OF_SCOPE: "pink",
  EXPIRED: "danger",
  NOT_COLLECTED: "warning",
} as const;

/** The tone of each reason key (for tests and legends). */
export function notChargedReasonTones(): Readonly<Record<string, string>> {
  return NOT_CHARGED_REASON_TONE;
}

type ReasonTone = (typeof NOT_CHARGED_REASON_TONE)[keyof typeof NOT_CHARGED_REASON_TONE] | "neutral";

/** The label of a reason key; "Another reason" for one this screen does not know yet. */
export function notChargedReasonLabel(reason: string): string {
  return NOT_CHARGED_REASON_LABEL[reason] ?? "Another reason";
}

function reasonTone(reason: string): ReasonTone {
  return (NOT_CHARGED_REASON_TONE as Record<string, ReasonTone>)[reason] ?? "neutral";
}

/**
 * A not-charged call on the public feed, as a buyer reads it: the tag (the
 * same label as its count line) and the server's own sentence. A voided debt
 * the server sends as FAILED_CHECK, or any row in the failed-verification
 * bucket, reads as the guarantee firing.
 */
export function notChargedRowText(row: { reason: string; reasonText: string; bucket: string }): {
  tag: string;
  tone: ReasonTone;
  text: string;
} {
  const reason = row.bucket === "FAILED_VERIFICATION" ? "FAILED_CHECK" : row.reason;
  return {
    tag: notChargedReasonLabel(reason),
    tone: reasonTone(reason),
    text: row.reasonText || "The call was not charged.",
  };
}

export interface NotChargedSplitLine {
  key: string;
  label: string;
  calls: number;
  tone: ReasonTone;
}

/**
 * The lines of the "not charged" split on the public proof: the guarantee
 * firing first, then each reason the server named (only when every reason
 * clears the k rule, rounded down to tens), then one line for the rest. A
 * backend without the split (or one that named nothing) gets a single merged
 * line, worded so it does not read as one reason. Lines with no calls are left
 * out, except the failed-check line, which is the claim itself.
 */
export function notChargedSplit(totals: {
  callsNotCharged: number;
  callsFailedCheck: number;
  notChargedByReason?: { reason: string; calls: number }[];
  callsNotChargedOther?: number;
}): NotChargedSplitLine[] {
  const failed: NotChargedSplitLine = {
    key: "FAILED_CHECK",
    label: notChargedReasonLabel("FAILED_CHECK"),
    calls: totals.callsFailedCheck,
    tone: reasonTone("FAILED_CHECK"),
  };
  const rest = Math.max(0, totals.callsNotCharged - totals.callsFailedCheck);
  const named = (totals.notChargedByReason ?? []).filter((r) => r.calls > 0);
  if (totals.notChargedByReason === undefined || named.length === 0) {
    if (rest === 0) return [failed];
    return [
      failed,
      {
        key: "OTHER",
        label:
          "Not charged for another reason (provider error, rejected or out-of-scope request, expired, no usable result, or not collected)",
        calls: rest,
        tone: "neutral",
      },
    ];
  }
  const lines: NotChargedSplitLine[] = [
    failed,
    ...named.map((r) => ({
      key: r.reason,
      label: notChargedReasonLabel(r.reason),
      calls: r.calls,
      tone: reasonTone(r.reason),
    })),
  ];
  const other = totals.callsNotChargedOther ?? Math.max(0, rest - named.reduce((sum, r) => sum + r.calls, 0));
  if (other > 0) {
    lines.push({ key: "OTHER", label: "The rest, incl. rounding remainders, grouped for privacy", calls: other, tone: "neutral" });
  }
  return lines;
}

/**
 * The sentence when no row is listed. With rows withheld for privacy it does
 * not claim nothing happened: it says none can be listed, and the privacy note
 * below says why.
 */
export function notChargedEmptyText(
  scope: boolean | "all" | "tool" | "provider",
  withheldForPrivacy: boolean,
  minBuyers = 5,
): string {
  const of = scope === true || scope === "tool" ? "tool" : scope === "provider" ? "provider" : "all";
  if (withheldForPrivacy) {
    // Why a tool can have no public rows at all, in the backend's own rules (`PublicNotChargedService`):
    // a row is listed a day after the call and its outcome, only the platform's most recent rows are kept,
    // and a tool's rows only when at least k eligible buyers (accounts a week old with a collected paid
    // call) stand behind them (final2 P3).
    const why =
      ` A call is listed only a day after it ends, and only when the tool's listed calls come from at least ${minBuyers} ` +
      "different buyers (accounts over a week old that have paid for a call); only the most recent calls across Assay are shown.";
    if (of === "tool") return `No uncharged call to this tool can be listed right now.${why}`;
    if (of === "provider") return `No uncharged call to their tools can be listed right now.${why}`;
    return "No uncharged call can be listed right now.";
  }
  if (of === "tool") return "No call to this tool went uncharged recently.";
  if (of === "provider") return "No call to their tools went uncharged recently.";
  return "No call went uncharged in this period.";
}

/**
 * The privacy note under the not-charged rows. With rows withheld it opens
 * with that, as its own sentence; otherwise it opens "For privacy, ...".
 */
export function notChargedPrivacyNote(withheldForPrivacy: boolean, minBuyers: number): string {
  const rule =
    `calls are listed only once at least ${minBuyers} different buyers stand behind them. Figures appear only once ` +
    `at least ${minBuyers} buyers have paid in that token; reasons are named only when each has at least ${minBuyers} ` +
    "buyers, and their counts are rounded down to tens.";
  return withheldForPrivacy
    ? `Some activity is hidden or grouped for privacy. A tool's ${rule}`
    : `For privacy, a tool's ${rule}`;
}
