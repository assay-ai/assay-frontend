import type { NotificationChannel, NotificationEvent } from "@/services/notifications.service";

/**
 * Alerts (`/alerts`), pure: the three presets a buyer chooses between instead
 * of a 25-row grid, which channels can actually deliver, and destination checks.
 *
 * Owner rule (business #5): email, push, Slack and webhook have no real
 * sender yet — the backend logs what it would send — so only In-app is offered.
 * A deployment that gets a real sender lists it in
 * `NEXT_PUBLIC_ALERT_CHANNELS` (e.g. "EMAIL,SLACK") and the configure flow
 * for that channel appears; nothing else changes.
 */

export type ExternalChannel = Exclude<NotificationChannel, "IN_APP">;

export const EXTERNAL_CHANNELS: readonly ExternalChannel[] = ["EMAIL", "PUSH", "SLACK", "WEBHOOK"];

export const CHANNEL_NAME: Record<NotificationChannel, string> = {
  IN_APP: "In-app",
  EMAIL: "Email",
  PUSH: "Push",
  SLACK: "Slack",
  WEBHOOK: "Webhook",
};

/** The external channels this deployment can really deliver on. */
export function availableChannels(raw: string | undefined = process.env.NEXT_PUBLIC_ALERT_CHANNELS): ExternalChannel[] {
  const wanted = new Set((raw ?? "").split(",").map((c) => c.trim().toUpperCase()));
  return EXTERNAL_CHANNELS.filter((c) => wanted.has(c));
}

export interface AlertPreset {
  id: "money-security" | "spend" | "toolsets" | "disputes" | "summary";
  title: string;
  description: string;
  events: readonly NotificationEvent[];
  /** Cannot be switched off on any channel. */
  alwaysOn: boolean;
}

export const ALERT_PRESETS: readonly AlertPreset[] = [
  {
    id: "money-security",
    title: "Money & security",
    description:
      "Balance low or empty, deposits, withdrawals, a new withdrawal address, an agent paused or its key expiring.",
    events: [
      "balance.low",
      "balance.zero",
      "deposit.credited",
      "deposit.failed",
      "withdrawal.initiated",
      "withdrawal.completed",
      "withdrawal_destination.added",
      "agent.paused",
      "session.expiring",
      "session.expired",
    ],
    alwaysOn: true,
  },
  {
    id: "spend",
    title: "Spend warnings",
    description: "A spend limit nearly reached, unusual spending speed, free calls used up, a call not charged.",
    events: ["spend.threshold_crossed", "velocity.anomaly", "free_quota.exhausted", "payment_intent.refunded", "slash.compensation_received"],
    alwaysOn: false,
  },
  {
    id: "toolsets",
    title: "Tool set and tool updates",
    description: "A tool set your agents use has a new version, or a version of a tool they use is going away, with what to do.",
    events: ["toolset.update_available", "tool_version.deprecated", "tool_version.retired"],
    alwaysOn: false,
  },
  {
    id: "disputes",
    title: "Reports about bad results",
    description: "The provider replied to a call you reported, the report was decided, or the call was refunded.",
    events: ["call_dispute.responded", "call_dispute.decided", "call_dispute.refunded"],
    alwaysOn: false,
  },
  {
    id: "summary",
    title: "Daily summary",
    description: "One message a day with what you spent and anything not charged.",
    events: ["digest.daily"],
    alwaysOn: false,
  },
];

/** Every buyer event, in preset order (provider events are not a buyer's). */
export const BUYER_EVENTS: readonly NotificationEvent[] = ALERT_PRESETS.flatMap((p) => p.events);

/** Whether a preset is on for a channel: on, off, or mixed (some events customised). */
export function presetState(
  preset: AlertPreset,
  channel: NotificationChannel,
  isEnabled: (event: NotificationEvent, channel: NotificationChannel) => boolean,
): "on" | "off" | "mixed" {
  const states = preset.events.map((e) => isEnabled(e, channel));
  if (states.every(Boolean)) return "on";
  if (states.every((s) => !s)) return "off";
  return "mixed";
}

/** "Spend warnings by Email turned off". */
export function presetToast(preset: AlertPreset, channel: NotificationChannel, enabled: boolean): string {
  return `${preset.title} by ${CHANNEL_NAME[channel]} turned ${enabled ? "on" : "off"}`;
}

/** One sentence when a destination will not work for its channel, else null. */
export function destinationError(channel: ExternalChannel, raw: string): string | null {
  const value = raw.trim();
  if (value === "") return "Enter where to send alerts.";
  switch (channel) {
    case "EMAIL":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : "Enter an email address like name@example.com.";
    case "SLACK":
      return /^https:\/\/hooks\.slack\.com\/\S+$/.test(value)
        ? null
        : "Paste a Slack incoming-webhook link (it starts with https://hooks.slack.com/).";
    case "WEBHOOK":
      try {
        const url = new URL(value);
        return url.protocol === "https:" ? null : "Use an https:// address.";
      } catch {
        return "Enter a full address like https://example.com/alerts.";
      }
    case "PUSH":
      return value.length >= 10 ? null : "Paste the device token from your app.";
  }
}
