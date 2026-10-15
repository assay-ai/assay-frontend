import type { Money } from "@/interfaces";
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
 * The free-tier badge text: "Free · 100 calls/day". With no number known yet
 * (the list endpoint does not carry it), just "Free tier"; for a fully free
 * tool, "Free".
 */
export function freeTierLabel(mode: string | null | undefined, callsPerDay?: number | null): string | null {
  const m = normalisedMode(mode);
  if (m === "FREE") return "Free";
  if (m !== "FREEMIUM") return null;
  if (callsPerDay && callsPerDay > 0) return `Free · ${callsPerDay.toLocaleString("en-US")} calls/day`;
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
}): string {
  const m = normalisedMode(input.mode);
  if (m === "FREE") return "Free to call. Results are still checked.";
  if (!input.price) return "Not available to call right now — no provider is serving it.";
  const price = formatCallPrice(input.price);
  if (m === "FREEMIUM") {
    const free = input.freeCallsPerDay && input.freeCallsPerDay > 0
      ? `The first ${input.freeCallsPerDay.toLocaleString("en-US")} calls each day are free for each agent`
      : "Some calls each day are free for each agent";
    return `${free}; after that ${price} per call, and you pay only if the result passes the check.`;
  }
  return `${price} per call. You pay only if the result passes the check.`;
}

/** Observed failures, from the platform's own measurement. */
export function failRateLabel(quality: { measuredCalls: number; failedCalls: number } | null | undefined): string {
  if (!quality || quality.measuredCalls <= 0) return "Not measured yet";
  const pct = (quality.failedCalls / quality.measuredCalls) * 100;
  const shown = pct === 0 ? "0%" : pct < 0.1 ? "<0.1%" : `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
  return `${shown} failed · ${quality.measuredCalls.toLocaleString("en-US")} ${quality.measuredCalls === 1 ? "call" : "calls"} checked`;
}

/**
 * Stake, one line per chain (never a sum across chains). Empty means nobody
 * could read it — "Not known", never "$0".
 */
export function stakeSummary(
  stake: readonly (Money & { chainId: string })[],
  chainName: (chainId: string) => string,
): string {
  if (stake.length === 0) return "Stake not known";
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
