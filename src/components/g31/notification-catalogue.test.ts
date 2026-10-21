import { describe, expect, it } from "vitest";

import { NOTIFICATION_CATALOGUE, NOTIFICATION_EVENT_LABEL } from "./notification-catalogue";

/**
 * The payment-key notices (backend `PAYMENT_KEY_FIRST_SPEND` /
 * `PAYMENT_KEY_DAILY_SUMMARY`), transcribed from the backend catalogue.
 */
describe("notification catalogue: payment-key notices", () => {
  it("payment_key.first_spend: once per key, email included, cannot be muted", () => {
    expect(NOTIFICATION_CATALOGUE["payment_key.first_spend"]).toEqual({
      severity: "WARNING",
      channels: ["IN_APP", "EMAIL"],
      aggregation: "ONCE",
      nonSuppressible: true,
      hasProducer: true,
    });
    expect(NOTIFICATION_EVENT_LABEL["payment_key.first_spend"]).toBe(
      "A payment key made its first paid call",
    );
  });

  it("payment_key.daily_summary: once per UTC day, email included", () => {
    expect(NOTIFICATION_CATALOGUE["payment_key.daily_summary"]).toEqual({
      severity: "INFO",
      channels: ["IN_APP", "EMAIL"],
      aggregation: "ONCE_PER_UTC_DAY",
      nonSuppressible: false,
      hasProducer: true,
    });
    expect(NOTIFICATION_EVENT_LABEL["payment_key.daily_summary"]).toBe(
      "Daily spend per payment key",
    );
  });

  it("every catalogue event has a label", () => {
    expect(Object.keys(NOTIFICATION_EVENT_LABEL).sort()).toEqual(
      Object.keys(NOTIFICATION_CATALOGUE).sort(),
    );
  });
});
