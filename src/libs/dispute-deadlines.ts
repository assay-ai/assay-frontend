/**
 * Durations the dispute copy names in words ("The provider has 24 hours to
 * reply"). The API now states every deadline as a timestamp
 * (`replyDueAt`, `pageAt`, `decisionDueAt`, `autoUpholdAt`, `holdEndsAt`,
 * `filingClosesAt`, the receipt's `disputeFilingClosesAt`, a tool's
 * `earliestSunsetAt`), and every screen reads those; these numbers are only
 * the words of the sentences, kept in one place so they change together with
 * the backend's `call-dispute-sla.constants.ts`.
 */

/** "The provider has 24 hours to reply." */
export const PROVIDER_REPLY_HOURS = 24;
/** "An operator decides within 72 hours." */
export const DECISION_HOURS = 72;
/*
 * The dispute hold and the on-chain safety timeout are chain values: they are
 * read from `GET /chains` (`collectHoldSeconds`, `heldTimeoutSeconds`) through
 * `libs/chain-terms.ts`, never kept here.
 */
/** "You can report up to 20 calls in 24 hours" (fewer for a buyer whose reports are mostly rejected). */
export const REPORTS_PER_DAY = 20;
/** A UI choice, not a backend rule: a takedown waiting for its second operator reads as urgent this close to its confirm-by. */
export const CUTOFF_LATE_HOURS = 12;
