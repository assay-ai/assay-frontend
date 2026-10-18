import { api } from "./api";

/**
 * The notification-settings surface: channels,
 * per-event preferences, and per-notification delivery outcomes.
 *
 * Read against the running API (`http://localhost:3000/api/v1`), not the
 * OpenAPI document — every shape below was checked with curl against
 * assay-backend `src/modules/notification/controllers/notification-settings.controller.ts`
 * and its DTOs, using `mcp_demo_token_funded`.
 *
 * Two things worth knowing before editing this file:
 *
 *  - `GET /notification-channels` and `GET /notification-preferences` return
 *    only the rows that exist. A channel nobody has configured, or an event
 *    nobody has overridden, is simply ABSENT from the array — it is not
 *    returned as a disabled/default row. Absence-means-default is the
 *    contract; do not "fill in" the missing rows here, that is
 *    `notification-catalogue.ts`'s job on the component side.
 *  - `IN_APP` is a valid `NotificationChannel` member (used by the catalogue
 *    and by `NotificationDeliveryDto.channel`), but `PUT
 *    /notification-channels/IN_APP` is short-circuited by the controller
 *    before it reaches this service's write path — it always answers a fixed
 *    `{ enabled: true, destination: null }` shape and never touches storage.
 *    Never build a UI control that calls this for `IN_APP`.
 *
 * These enum unions mirror assay-backend `src/modules/notification/ports/notification.port.ts`
 * verbatim (see `notification-catalogue.ts`'s header for the same caveat:
 * nothing enforces they stay in sync with that file).
 */

/** Mirrors `NotificationChannel` (`ports/notification.port.ts`). */
export type NotificationChannel = "IN_APP" | "EMAIL" | "PUSH" | "SLACK" | "WEBHOOK";

/** Mirrors `NotificationSeverity`. */
export type NotificationSeverity = "INFO" | "WARNING" | "CRITICAL";

/** Mirrors `NotificationAggregation`. */
export type NotificationAggregation =
  | "PER_EVENT"
  | "ONCE"
  | "ONCE_PER_UTC_DAY"
  | "ONCE_PER_UTC_MONTH"
  | "ONCE_PER_INCIDENT"
  | "DIGEST_ONLY";

/** Mirrors `NotificationEvent` — every member of the backend enum, same string values. */
export type NotificationEvent =
  | "balance.low"
  | "balance.zero"
  | "deposit.credited"
  | "deposit.failed"
  | "withdrawal.initiated"
  | "withdrawal.completed"
  | "withdrawal_destination.added"
  | "spend.threshold_crossed"
  | "velocity.anomaly"
  | "agent.paused"
  | "session.expiring"
  | "session.expired"
  | "free_quota.exhausted"
  | "payment_intent.refunded"
  | "slash.compensation_received"
  | "provider.stake_headroom_low"
  | "provider.stake_grace_opened"
  | "provider.stake_grace_expired"
  | "provider.stake_grace_cured"
  | "provider.slash_proposed"
  | "provider.sla_breach_proposed"
  | "provider.sla_window_warning"
  | "provider.payout_sent"
  | "toolset.update_available"
  | "tool_version.deprecated"
  | "tool_version.retired"
  | "digest.daily";

/** `NotificationChannelDto`. One row per channel the organization has ever configured. */
export interface NotificationChannelDto {
  id: string;
  channel: NotificationChannel;
  /** Address, token or URL. `null` for `IN_APP`, or a channel with no destination set. */
  destination: string | null;
  enabled: boolean;
  /** `null` = unverified. Changing `destination` resets this to `null` server-side. */
  verifiedAt: string | null;
  createdAt: string;
}

/** `UpsertNotificationChannelBodyDto`. Never send this for `channel: "IN_APP"`. */
export interface UpsertNotificationChannelBody {
  destination?: string | null;
  enabled: boolean;
}

/** `NotificationPreferenceDto` — only the rows that OVERRIDE the catalogue default. */
export interface NotificationPreferenceDto {
  id: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface UpsertNotificationPreferenceItem {
  event: NotificationEvent;
  channel: NotificationChannel;
  enabled: boolean;
}

/** `NotificationDeliveryDto` — one channel's outcome for one notification. */
export interface NotificationDeliveryDto {
  id: string;
  channel: NotificationChannel;
  status: "PENDING" | "DELIVERED" | "FAILED" | "SUPPRESSED";
  attempts: number;
  lastError: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

/** GET /notification-channels */
export function listNotificationChannels(): Promise<NotificationChannelDto[]> {
  return api.get<NotificationChannelDto[]>("/notification-channels");
}

/**
 * PUT /notification-channels/:channel
 *
 * Refused/short-circuited by the controller for `channel: "IN_APP"` — see
 * this file's header comment. Do not call it with that value.
 */
export function upsertNotificationChannel(
  channel: Exclude<NotificationChannel, "IN_APP">,
  body: UpsertNotificationChannelBody
): Promise<NotificationChannelDto> {
  return api.put<NotificationChannelDto>(`/notification-channels/${channel}`, body);
}

/** GET /notification-preferences */
export function listNotificationPreferences(): Promise<NotificationPreferenceDto[]> {
  return api.get<NotificationPreferenceDto[]>("/notification-preferences");
}

/**
 * PUT /notification-preferences — bulk upsert.
 *
 * Refuses the WHOLE batch with 400 `NOTIFICATION_NONSUPPRESSIBLE_EVENT` if
 * any item disables a `nonSuppressible` event (verified against the running
 * API: `withdrawal.initiated` on `EMAIL` → 400, nothing written). The UI must
 * not rely on this alone — see `notification-catalogue.ts`'s `nonSuppressible`
 * flag, which is what actually keeps the control from being clicked in the
 * first place.
 */
export function upsertNotificationPreferences(
  preferences: readonly UpsertNotificationPreferenceItem[]
): Promise<NotificationPreferenceDto[]> {
  return api.put<NotificationPreferenceDto[]>("/notification-preferences", { preferences });
}

/**
 * GET /notifications/:id/deliveries
 *
 * 404s `NOTIFICATION_NOT_FOUND` for a cross-organization id or a missing one
 * — the two are indistinguishable on purpose, per the backend's own error
 * catalogue.
 */
export function listNotificationDeliveries(notificationId: string): Promise<NotificationDeliveryDto[]> {
  return api.get<NotificationDeliveryDto[]>(`/notifications/${notificationId}/deliveries`);
}
