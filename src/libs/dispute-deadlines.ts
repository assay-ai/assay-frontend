/**
 * Deadlines the frontend works out by itself, copied by hand from the
 * backend because its DTOs do not carry them yet. Every screen reads them
 * from here, so when the API sends explicit timestamps (reply due, decide
 * by, auto-uphold at, cutoff confirm-by already sent) this module is the one
 * place to retire.
 *
 *   dispute/services/call-dispute.service.ts   PROVIDER_REPLY_HOURS = 24
 *   dispute/services/call-dispute-sla.service.ts  page 48 h, decide 72 h
 *   payment collection-hold                     1 h hold, 7 d chain timeout
 *   dispute/constants/call-dispute.config.ts    7 d filing window
 *   provider-tool deprecate                     sunset at least 90 d
 */

/** The provider may reply once, within this long of the filing. */
export const PROVIDER_REPLY_HOURS = 24;
/** An undecided dispute pages an operator at this age. */
export const OPERATOR_PAGE_HOURS = 48;
/** Decide by this age; a provider silent past its reply window is upheld automatically. */
export const DECISION_HOURS = 72;
/** A charged call's payment is held this long after it settles; a report inside it is refunded in full if upheld. */
export const DISPUTE_HOLD_MINUTES = 60;
/** A report is accepted this long after the call. */
export const FILING_WINDOW_DAYS = 7;
/** After this, anyone may collect a held payment for the provider, and a refund is impossible. */
export const HELD_TIMEOUT_DAYS = 7;
/** A takedown waiting for its second operator reads as urgent this close to its confirm-by. */
export const CUTOFF_LATE_HOURS = 12;
/** A deprecated major's sunset is at least this far away (UTC). */
export const SUNSET_MIN_DAYS = 90;
/** The failure rate a listing started from a promotion invitation promises until the provider changes it. */
export const DEFAULT_SLA_FAILURE_RATE = 0.02;
