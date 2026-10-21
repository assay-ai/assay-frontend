import { describe, expect, it } from "vitest";

import { NOTIFICATION_CATALOGUE } from "@/components/g31/notification-catalogue";
import type { NotificationEvent } from "@/services/notifications.service";

import {
  ALERT_PRESETS,
  BUYER_EVENTS,
  availableChannels,
  customiseEvents,
  destinationError,
  presetState,
  presetToast,
} from "./alert-presets";

describe("alert presets", () => {
  it("offers only In-app until a sender is configured", () => {
    expect(availableChannels(undefined)).toEqual([]);
    expect(availableChannels("email, slack, nope")).toEqual(["EMAIL", "SLACK"]);
  });

  it("reads a preset as on, off or mixed", () => {
    const spend = ALERT_PRESETS.find((p) => p.id === "spend")!;
    expect(presetState(spend, "EMAIL", () => true)).toBe("on");
    expect(presetState(spend, "EMAIL", () => false)).toBe("off");
    expect(presetState(spend, "EMAIL", (e) => e === "velocity.anomaly")).toBe("mixed");
  });

  it("names the change in the toast", () => {
    expect(presetToast(ALERT_PRESETS[1]!, "PUSH", false)).toBe("Spend warnings by Push turned off");
  });

  it("validates a destination per channel", () => {
    expect(destinationError("EMAIL", "a@b.co")).toBeNull();
    expect(destinationError("EMAIL", "nope")).toMatch(/email address/);
    expect(destinationError("SLACK", "https://example.com")).toMatch(/hooks.slack.com/);
    expect(destinationError("WEBHOOK", "http://x.io")).toMatch(/https/);
    expect(destinationError("WEBHOOK", "https://x.io/hook")).toBeNull();
    expect(destinationError("PUSH", "")).toMatch(/Enter/);
  });
});

describe("alert presets cover the newer events", () => {
  const preset = (id: string) => ALERT_PRESETS.find((p) => p.id === id)!;

  it("puts the app sign-in reuse stop and a payment key's first paid call in the always-on security preset", () => {
    expect(preset("money-security").alwaysOn).toBe(true);
    expect(preset("money-security").events).toContain("oauth.grant_stopped_reuse");
    expect(preset("money-security").events).toContain("payment_key.first_spend");
  });

  it("puts the per-key daily spend in the daily summary preset", () => {
    expect(preset("summary").events).toContain("payment_key.daily_summary");
  });

  it("Customise lists every catalogue event for a provider, buyer events first, each once", () => {
    const all = Object.keys(NOTIFICATION_CATALOGUE) as NotificationEvent[];
    const listed = customiseEvents(all, { provider: true });
    expect([...listed].sort()).toEqual([...all].sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.slice(0, BUYER_EVENTS.length)).toEqual(BUYER_EVENTS);
    expect(listed).toContain("oauth.grant_stopped_reuse");
    expect(listed).toContain("provider.stake_grace_opened");
  });

  it("a buyer-only organization gets no provider-side events, but keeps buyer ones outside presets (review m9)", () => {
    const all = Object.keys(NOTIFICATION_CATALOGUE) as NotificationEvent[];
    const listed = customiseEvents(all, { provider: false });
    expect(listed.filter((e) => e.startsWith("provider"))).toEqual([]);
    expect(listed).not.toContain("call_dispute.opened");
    expect(listed).toContain("call.refused_repeatedly");
    expect(listed).toContain("call_dispute.decided");
    expect(listed).toContain("tool_version.retired");
    expect(listed).toContain("oauth.grant_stopped_reuse");
  });
});
