/**
 * Why a call earned nothing, in the provider's words. Keyed on the call class
 * of the per-call export; the buyer's "Not charged" uses the same classes, so
 * the two sides describe one call the same way.
 */
export interface NotCreditedReason {
  title: string;
  detail: string;
}

const REASONS: Record<string, NotCreditedReason> = {
  PAID_UNCREDITED: {
    title: "The answer failed Assay's check",
    detail: "Your API answered, but the result did not pass the tool's checks (a value out of range, a missing field, stale data). The buyer was not charged.",
  },
  SYSTEM_ERROR: {
    title: "Your API errored or timed out",
    detail: "It answered with a server error (5xx) or did not answer within your timeout.",
  },
  REQUEST_ERROR: {
    title: "Your API refused the request",
    detail: "It answered with a 4xx error. Usually the agent sent input your API does not accept; check your request mapping.",
  },
  PAID_UNCOLLECTED: {
    title: "The buyer never paid",
    detail:
      "These passed the check, but the buyer never settled the payment, so it was written off after 30 days. You were not paid, no fee was taken, and the platform does not pay it in their place.",
  },
  PROVIDER_FORFEITED: {
    title: "Forfeited by you",
    detail:
      "The payment could not be collected because of your account: your stake was below the minimum, or you were blocked. The buyer was not charged and nobody was paid.",
  },
  EXCLUDED: {
    title: "Excluded by Assay",
    detail: "Assay's team took these calls out of the count, for example during an incident on our side.",
  },
};

export function notCreditedReason(className: string): NotCreditedReason {
  return (
    REASONS[className] ?? {
      title: "Not credited",
      detail: "These calls did not settle to you.",
    }
  );
}

/**
 * Display amounts for a list of parts that add up to their displayed total.
 *
 * Every amount on screen is truncated to `places` decimals (see
 * `formatDecimal`). Truncating each part on its own can lose a cent per part,
 * so three reasons of $0.81, $0.405 and $0.405 would read $0.81 + $0.40 +
 * $0.40 = $1.61 under a "$1.62 not credited" headline. Here the total is
 * truncated once, each part is truncated, and the cents still missing go to
 * the parts with the largest truncated remainders (ties: earlier part first).
 * All arithmetic is on atomic units (bigint).
 *
 * Returns atomic amounts (as strings, same scale as the input) that are exact
 * multiples of the display step and sum to the truncated total.
 */
export function partsThatAddUp(parts: readonly string[], decimals: number, places = 2): string[] {
  if (parts.length === 0) return [];
  const step = decimals > places ? 10n ** BigInt(decimals - places) : 1n;
  const atomic = parts.map((part) => {
    const value = BigInt(part || "0");
    return value < 0n ? 0n : value;
  });
  const total = atomic.reduce((sum, value) => sum + value, 0n);
  const target = (total / step) * step;
  const floors = atomic.map((value) => (value / step) * step);
  let missing = (target - floors.reduce((sum, value) => sum + value, 0n)) / step;
  const order = atomic
    .map((value, index) => ({ index, remainder: value % step }))
    .sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1));
  const result = [...floors];
  for (const { index } of order) {
    if (missing <= 0n) break;
    result[index] += step;
    missing -= 1n;
  }
  return result.map(String);
}

/** "1 call", "848 calls". */
export function callCount(count: number): string {
  return `${count.toLocaleString("en-US")} call${count === 1 ? "" : "s"}`;
}
