import type {
  NotificationAggregation,
  NotificationChannel,
  NotificationEvent,
  NotificationSeverity,
} from "@/services/notifications.service";

/**
 * Alerts · a frontend MIRROR of the backend's event catalogue.
 *
 * **There is no endpoint that serves this.** `GET /notification-preferences`
 * returns only the rows an organization has overridden (verified against the
 * running API — a fresh organization gets back `[]`), and nothing exposes the
 * defaults those overrides are relative to. The authoritative source is the
 * backend's notification event catalogue (assay-backend:
 * assay-backend `src/modules/notification/constants/notification-catalogue.ts`,
 * `NOTIFICATION_CATALOGUE`, a `Record<NotificationEvent, NotificationDefinition>`)
 * plus the enum comments in assay-backend `src/modules/notification/ports/notification.port.ts`
 * there. Every row below is transcribed from those two files by hand.
 *
 * **Nothing enforces this file stays in sync with the backend.** Adding an
 * event to the backend's `NotificationEvent` enum, or changing a row in
 * `NOTIFICATION_CATALOGUE`, does not fail a build here — it just makes this
 * table quietly wrong. If a row here looks stale, the backend file above is
 * the one to trust, not this one.
 *
 * `hasProducer: false` marks the events the backend's own enum comments say
 * have no producer yet (`withdrawal.initiated`, `withdrawal.completed`,
 * `withdrawal_destination.added`, `slash.compensation_received`,
 * `provider.slash_proposed`, `provider.payout_sent`, `digest.daily`). The UI
 * must say so rather than implying they fire today — they are in the table
 * only because the backend's catalogue is `Record`-exhaustive over the enum,
 * not `Partial`, so an event with no producer still has a decided severity
 * and aggregation waiting for one.
 *
 * **Two rows were transcribed while the backend's SLA-window work was still
 * in progress.** `provider.sla_window_warning` and `provider.sla_breach_proposed`
 * (whose `hasProducer` is `true` because `SlaWindowService` is named as its
 * producer) should be re-checked against the backend catalogue: if either is
 * renamed or dropped there, nothing here will say so.
 */

export interface NotificationDefinition {
  readonly severity: NotificationSeverity;
  /** The catalogue's DEFAULT fan-out. An org narrows it via preferences, except where `nonSuppressible` refuses. */
  readonly channels: readonly NotificationChannel[];
  readonly aggregation: NotificationAggregation;
  /** `true` = no preference row can switch this off, on any channel — the account-takeover/consent list. */
  readonly nonSuppressible: boolean;
  /** `false` = nothing in the backend emits this event yet; it cannot fire today no matter what is configured. */
  readonly hasProducer: boolean;
}

const IN_APP_ONLY: readonly NotificationChannel[] = ["IN_APP"];
const IN_APP_EMAIL: readonly NotificationChannel[] = ["IN_APP", "EMAIL"];
const IN_APP_EMAIL_PUSH: readonly NotificationChannel[] = ["IN_APP", "EMAIL", "PUSH"];
const IN_APP_PUSH: readonly NotificationChannel[] = ["IN_APP", "PUSH"];
const EVERYTHING: readonly NotificationChannel[] = ["IN_APP", "EMAIL", "PUSH", "SLACK"];
const WEBHOOK_SLACK_IN_APP: readonly NotificationChannel[] = ["WEBHOOK", "SLACK", "IN_APP"];

/** Transcribed from `NOTIFICATION_CATALOGUE`. Order and grouping follow the backend file. */
export const NOTIFICATION_CATALOGUE: Readonly<Record<NotificationEvent, NotificationDefinition>> = {
  // ── Money in and out ──────────────────────────────────────────────────────
  "balance.low": {
    severity: "WARNING",
    channels: IN_APP_EMAIL_PUSH,
    aggregation: "PER_EVENT",
    nonSuppressible: false,
    hasProducer: true,
  },
  "balance.zero": {
    severity: "CRITICAL",
    channels: IN_APP_EMAIL_PUSH,
    aggregation: "ONCE_PER_UTC_DAY",
    nonSuppressible: false,
    hasProducer: true,
  },
  "deposit.credited": {
    severity: "INFO",
    channels: IN_APP_EMAIL_PUSH,
    aggregation: "PER_EVENT",
    nonSuppressible: false,
    hasProducer: true,
  },
  "deposit.failed": {
    severity: "WARNING",
    channels: IN_APP_EMAIL_PUSH,
    aggregation: "PER_EVENT",
    nonSuppressible: false,
    hasProducer: true,
  },
  "withdrawal.initiated": {
    severity: "CRITICAL",
    channels: IN_APP_EMAIL,
    aggregation: "PER_EVENT",
    nonSuppressible: true,
    hasProducer: false,
  },
  "withdrawal.completed": {
    severity: "WARNING",
    channels: IN_APP_EMAIL,
    aggregation: "PER_EVENT",
    nonSuppressible: true,
    hasProducer: false,
  },
  "withdrawal_destination.added": {
    severity: "CRITICAL",
    channels: IN_APP_EMAIL,
    aggregation: "PER_EVENT",
    nonSuppressible: true,
    hasProducer: false,
  },

  // ── Limits ────────────────────────────────────────────────────────────────
  "spend.threshold_crossed": {
    // The backend's own comment: one row cannot hold two severities (Medium at
    // 50/80%, Critical at 100% per the product doc), so WARNING is the floor
    // and the producer raises it per-occurrence via `NotificationRequest.severity`.
    severity: "WARNING",
    channels: IN_APP_EMAIL_PUSH,
    aggregation: "ONCE_PER_UTC_DAY",
    nonSuppressible: false,
    hasProducer: true,
  },
  "velocity.anomaly": {
    severity: "CRITICAL",
    channels: IN_APP_EMAIL_PUSH,
    aggregation: "ONCE_PER_INCIDENT",
    nonSuppressible: false,
    hasProducer: true,
  },
  "agent.paused": {
    severity: "WARNING",
    channels: EVERYTHING,
    aggregation: "PER_EVENT",
    nonSuppressible: false,
    hasProducer: true,
  },

  // ── Credentials and signing ───────────────────────────────────────────────
  "session.expiring": {
    severity: "WARNING",
    channels: IN_APP_EMAIL_PUSH,
    // "Exactly twice: T-7d, T-1d" — the stage is in the producer's dedupe key,
    // so ONCE per key is literally twice per credential.
    aggregation: "ONCE",
    nonSuppressible: true,
    hasProducer: true,
  },
  "session.expired": {
    severity: "CRITICAL",
    channels: EVERYTHING,
    aggregation: "ONCE",
    nonSuppressible: true,
    hasProducer: true,
  },

  // ── Free tier ─────────────────────────────────────────────────────────────
  "free_quota.exhausted": {
    severity: "INFO",
    channels: IN_APP_PUSH,
    aggregation: "ONCE_PER_UTC_DAY",
    nonSuppressible: false,
    hasProducer: true,
  },

  // ── Verification and consequence ──────────────────────────────────────────
  "payment_intent.refunded": {
    severity: "INFO",
    channels: IN_APP_ONLY,
    // "Never delivered on its own. Rolls into the daily digest" — ~4.5M
    // events/month at a 3% failure rate is the backend's own stated reason.
    aggregation: "DIGEST_ONLY",
    nonSuppressible: false,
    hasProducer: true,
  },
  "slash.compensation_received": {
    severity: "INFO",
    channels: IN_APP_EMAIL,
    aggregation: "PER_EVENT",
    nonSuppressible: false,
    hasProducer: false,
  },

  // ── Provider side ─────────────────────────────────────────────────────────
  "provider.stake_headroom_low": {
    severity: "WARNING",
    channels: IN_APP_EMAIL,
    aggregation: "ONCE_PER_UTC_DAY",
    nonSuppressible: false,
    hasProducer: true,
  },
  "provider.stake_grace_opened": {
    severity: "CRITICAL",
    channels: IN_APP_EMAIL_PUSH,
    aggregation: "PER_EVENT",
    nonSuppressible: false,
    hasProducer: true,
  },
  "provider.stake_grace_expired": {
    severity: "CRITICAL",
    channels: IN_APP_EMAIL_PUSH,
    aggregation: "PER_EVENT",
    nonSuppressible: false,
    hasProducer: true,
  },
  "provider.stake_grace_cured": {
    severity: "INFO",
    channels: IN_APP_EMAIL,
    aggregation: "PER_EVENT",
    nonSuppressible: false,
    hasProducer: true,
  },
  "provider.slash_proposed": {
    severity: "CRITICAL",
    channels: EVERYTHING,
    // Same class as a withdrawal: muting it means losing money silently.
    aggregation: "PER_EVENT",
    nonSuppressible: true,
    hasProducer: false,
  },
  // Both SLA rows need re-checking against the backend — see the caveat at the top.
  "provider.sla_breach_proposed": {
    severity: "CRITICAL",
    channels: EVERYTHING,
    aggregation: "PER_EVENT",
    nonSuppressible: true,
    hasProducer: true,
  },
  "provider.sla_window_warning": {
    // The catalogue's own value is a FLOOR — `SlaWindowService` raises this to
    // CRITICAL per-occurrence for a projected, slashable breach. This row is
    // the floor, not the ceiling.
    severity: "WARNING",
    channels: WEBHOOK_SLACK_IN_APP,
    aggregation: "PER_EVENT",
    nonSuppressible: false,
    hasProducer: true,
  },
  "provider.payout_sent": {
    severity: "INFO",
    channels: IN_APP_EMAIL,
    aggregation: "PER_EVENT",
    nonSuppressible: false,
    hasProducer: false,
  },

  // ── Tool sets ─────────────────────────────────────────────────────────────
  "toolset.update_available": {
    severity: "INFO",
    channels: IN_APP_EMAIL,
    aggregation: "ONCE",
    nonSuppressible: false,
    hasProducer: true,
  },

  // ── Digest ────────────────────────────────────────────────────────────────
  "digest.daily": {
    severity: "INFO",
    channels: IN_APP_EMAIL,
    aggregation: "ONCE_PER_UTC_DAY",
    nonSuppressible: false,
    hasProducer: false,
  },
};

/** Stable render order — the backend's own grouping, not alphabetical. */
export const NOTIFICATION_EVENT_ORDER: readonly NotificationEvent[] = Object.keys(
  NOTIFICATION_CATALOGUE
) as NotificationEvent[];

/**
 * What each event is, in words. The id beside it on the Alerts screen stays
 * the value a webhook payload and the API carry, so it is shown as a code and
 * not replaced.
 */
export const NOTIFICATION_EVENT_LABEL: Readonly<Record<NotificationEvent, string>> = {
  "balance.low": "Balance is low",
  "balance.zero": "Balance is empty",
  "deposit.credited": "Deposit credited",
  "deposit.failed": "Deposit failed",
  "withdrawal.initiated": "Withdrawal started",
  "withdrawal.completed": "Withdrawal completed",
  "withdrawal_destination.added": "Withdrawal address added",
  "spend.threshold_crossed": "Spend limit threshold reached",
  "velocity.anomaly": "Unusual spending speed",
  "agent.paused": "Agent paused",
  "session.expiring": "Agent credential expiring soon",
  "session.expired": "Agent credential expired",
  "free_quota.exhausted": "Free calls used up",
  "payment_intent.refunded": "Call refunded",
  "slash.compensation_received": "Compensation received",
  "provider.stake_headroom_low": "Stake is close to the minimum",
  "provider.stake_grace_opened": "Stake below the minimum — grace period started",
  "provider.stake_grace_expired": "Stake grace period ended",
  "provider.stake_grace_cured": "Stake back above the minimum",
  "provider.slash_proposed": "Penalty proposed against your stake",
  "provider.sla_breach_proposed": "SLA breach recorded",
  "provider.sla_window_warning": "SLA window at risk",
  "provider.payout_sent": "Payout sent",
  "toolset.update_available": "A tool set you use has a new version",
  "digest.daily": "Daily summary",
};

/**
 * A short, mechanical gloss of the aggregation enum — not a per-event
 * invented sentence. `ONCE_PER_INCIDENT`'s window (~1h) is the backend's own
 * `NOTIFICATION_INCIDENT_WINDOW_SECONDS` constant, transcribed, not guessed.
 */
export const AGGREGATION_LABEL: Readonly<Record<NotificationAggregation, string>> = {
  PER_EVENT: "every occurrence",
  ONCE: "once only",
  ONCE_PER_UTC_DAY: "once per UTC day",
  ONCE_PER_UTC_MONTH: "once per UTC month",
  ONCE_PER_INCIDENT: "once, then quiet for ~1h",
  DIGEST_ONLY: "never alone — rolls into the daily digest",
};
