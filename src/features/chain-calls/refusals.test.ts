import { describe, expect, it } from "vitest";

import { ApiError } from "@/libs/ApiClient";

import { refusalReasonText, refusalsById, refusalsOf } from "./refusals";

const A = "a".repeat(64);
const B = "B".repeat(64);

/** The backend's own message for `SLASH_CHAIN_BATCH_REFUSED` (`slash.errors.ts`). */
const MESSAGE =
  `2 of the request ids would make the chain revert the whole disputeSlashBatch; nothing was built: ` +
  `0x${A} (SlashNotPending), 0x${B} (DisputeWindowClosed)`;

describe("refusalsOf", () => {
  it("parses the refusals from the message, which is all the backend puts on the wire", () => {
    const refusals = refusalsOf(new ApiError("SLASH_CHAIN_BATCH_REFUSED", MESSAGE, 422));
    expect(refusals).toEqual([
      { requestId: `0x${A}`, reason: "SlashNotPending" },
      { requestId: `0x${B.toLowerCase()}`, reason: "DisputeWindowClosed" },
    ]);
  });

  it("prefers context.refusals when a backend sends it, normalising bare ids", () => {
    const error = new ApiError("SLASH_CHAIN_BATCH_REFUSED", "whatever", 422, undefined, {
      refusals: [{ requestId: A, reason: "NotSlashedProvider", detail: "the record names a different provider" }],
    });
    expect(refusalsOf(error)).toEqual([
      { requestId: `0x${A}`, reason: "NotSlashedProvider", detail: "the record names a different provider" },
    ]);
  });

  it("falls back to the message when context.refusals is empty or malformed", () => {
    const error = new ApiError("SLASH_CHAIN_BATCH_REFUSED", MESSAGE, 422, undefined, { refusals: [{ nope: 1 }] });
    expect(refusalsOf(error)).toHaveLength(2);
  });

  it("is null for any other error", () => {
    expect(refusalsOf(new ApiError("CHAIN_PROGRAM_PAUSED", MESSAGE, 503))).toBeNull();
    expect(refusalsOf(new Error(MESSAGE))).toBeNull();
  });
});

describe("refusalReasonText", () => {
  it("says every contract reason in plain words", () => {
    const reasons = [
      "NoSuchRecord",
      "DuplicateId",
      "NotSlashedProvider",
      "SlashNotPending",
      "DisputeWindowClosed",
      "SlashNotDisputed",
      "ArbiterIsVerifier",
      "DisputeTimedOut",
    ];
    for (const reason of reasons) {
      const text = refusalReasonText(reason, "provider");
      expect(text).not.toContain(reason);
      expect(text.endsWith(".")).toBe(true);
    }
    expect(refusalReasonText("DisputeWindowClosed", "provider")).toMatch(/window has closed/);
    expect(refusalReasonText("NotSlashedProvider", "provider")).toMatch(/not your stake wallet/);
    expect(refusalReasonText("DisputeTimedOut", "arbiter")).toMatch(/30 days/);
  });

  it("names an unknown reason rather than guessing", () => {
    expect(refusalReasonText("SomethingNew", "arbiter")).toBe("The chain would refuse this id (SomethingNew).");
  });
});

describe("refusalsById", () => {
  it("groups the plain-words reasons per lower-case id, without repeats", () => {
    const map = refusalsById(
      [
        { requestId: `0x${B}`, reason: "SlashNotPending" },
        { requestId: `0x${B.toLowerCase()}`, reason: "SlashNotPending" },
        { requestId: `0x${B}`, reason: "DuplicateId" },
      ],
      "provider",
    );
    expect([...map.keys()]).toEqual([`0x${B.toLowerCase()}`]);
    expect(map.get(`0x${B.toLowerCase()}`)).toHaveLength(2);
  });
});
