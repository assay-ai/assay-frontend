import { describe, expect, it } from "vitest";

import { formatNotificationBody, formatNotificationTitle, notificationHref } from "./inbox-item";

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

describe("formatNotificationTitle", () => {
  it("rewrites the raw minor-unit penalty amount as money", () => {
    expect(formatNotificationTitle("A penalty of 28470000 is proposed against your stake")).toBe(
      "A penalty of $28.47 is proposed against your stake"
    );
  });

  it("leaves other titles alone", () => {
    expect(formatNotificationTitle("Window closed with 12 calls")).toBe("Window closed with 12 calls");
  });
});

describe("notificationHref", () => {
  it("links penalties to their drawer and leaves unknown subjects without a link", () => {
    expect(notificationHref({ subjectType: "slash_proposal", subjectId: "p1" })?.href).toBe("/provider/penalties?case=p1");
    expect(notificationHref({ subjectType: "binding", subjectId: "b1" })?.href).toBe("/provider/bindings/view?binding=b1");
    expect(notificationHref({ subjectType: "agent", subjectId: "a1" })).toBeNull();
    expect(notificationHref({ subjectType: "slash_proposal", subjectId: null })).toBeNull();
  });
});
