import { describe, expect, it } from "vitest";

import { formatNotificationBody } from "./inbox-item";

describe("formatNotificationBody", () => {
  it("rewrites raw minor units and the asset id as money", () => {
    const body =
      "Estimated penalty 28470000 solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (uncapped formula)";
    expect(formatNotificationBody(body)).toBe("Estimated penalty $28.47 (uncapped formula)");
  });

  it("leaves other text alone", () => {
    expect(formatNotificationBody("Nothing to see, 12 calls")).toBe("Nothing to see, 12 calls");
  });
});
