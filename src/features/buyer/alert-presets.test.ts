import { describe, expect, it } from "vitest";

import { ALERT_PRESETS, availableChannels, destinationError, presetState, presetToast } from "./alert-presets";

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
