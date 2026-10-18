/**
 * Whether the receipt may still promise "refunded in full if your report is
 * accepted" at `now` (wave-1 audit I1, W1A review C1).
 *
 * The backend's `refundableIfReportedNow` was true when the receipt was
 * fetched; it is never extended past `refundableIfReportedUntil` (collectable
 * minus the filing guard) nor past the hold's end (`disputeWindowEndsAt`),
 * whichever the receipt carries. A page left open past either drops the
 * promise on the clock, before the next refetch says so.
 */
export function refundPromiseLive(
  receipt: {
    refundableIfReportedNow?: boolean;
    refundableIfReportedUntil?: string | null;
    disputeWindowEndsAt?: string | null;
  },
  now: number,
): boolean {
  if (receipt.refundableIfReportedNow !== true) return false;
  const until = receipt.refundableIfReportedUntil ?? null;
  if (until !== null && now >= Date.parse(until)) return false;
  const holdEnds = receipt.disputeWindowEndsAt ?? null;
  return holdEnds === null || now < Date.parse(holdEnds);
}

/** How often a receipt carrying a refund promise is fetched again. */
export const REFUND_PROMISE_REFETCH_MS = 60_000;

/**
 * The receipt query's `refetchInterval`: every minute while the receipt
 * carries the backend's refund promise, so a voucher redeemed meanwhile (the
 * hold's end then known) or a report filed elsewhere replaces it; never
 * otherwise.
 */
export function receiptRefetchInterval(receipt: { refundableIfReportedNow?: boolean } | undefined): number | false {
  return receipt?.refundableIfReportedNow === true ? REFUND_PROMISE_REFETCH_MS : false;
}
