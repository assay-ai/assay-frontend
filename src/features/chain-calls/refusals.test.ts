import { describe, expect, it } from "vitest";

import { ApiError } from "@/libs/ApiClient";

import { refusalReasonText, refusalsById, refusalsOf, refusedFunctionOf } from "./refusals";

const A = "a".repeat(64);
const B = "B".repeat(64);

/** The backend's own message for `SLASH_CHAIN_BATCH_REFUSED` (`slash.errors.ts`). */
const MESSAGE =
  `2 of the request ids would make the chain revert the whole disputeSlashBatch; nothing was built: ` +
  `0x${A} (SlashNotPending), 0x${B} (DisputeWindowClosed)`;

describe("refusalsOf", () => {
  it("reads error.context as the backend sends it: bare-hex ids, the contract reason, its detail", () => {
    const error = new ApiError("SLASH_CHAIN_BATCH_REFUSED", "not parsed", 422, undefined, {
      functionName: "upholdSlashBatch",
      refusals: [
        { requestId: A, reason: "DisputeTimedOut", detail: "disputed more than 30 days ago" },
        { requestId: B, reason: "SlashAlreadyDisputed", detail: "already disputed once" },
      ],
    });
    expect(refusalsOf(error)).toEqual([
      { requestId: `0x${A}`, reason: "DisputeTimedOut", detail: "disputed more than 30 days ago" },
      { requestId: `0x${B.toLowerCase()}`, reason: "SlashAlreadyDisputed", detail: "already disputed once" },
    ]);
  });

  it("falls back to parsing the message when the backend sends no context", () => {
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
      "DisputeTimedOut",
      "SlashAlreadyDisputed",
    ];
    for (const reason of reasons) {
      const text = refusalReasonText(reason, "provider");
      expect(text).not.toContain(reason);
      expect(text.endsWith(".")).toBe(true);
    }
    expect(refusalReasonText("DisputeWindowClosed", "provider")).toMatch(/window has closed/);
    expect(refusalReasonText("NotSlashedProvider", "provider")).toMatch(/not your stake wallet/);
    expect(refusalReasonText("DisputeTimedOut", "arbiter")).toMatch(/30 days/);
    expect(refusalReasonText("SlashAlreadyDisputed", "provider")).toMatch(/already disputed this penalty once/);
  });

  it("uses the contract-error sentence for a reason it has no case for", () => {
    expect(refusalReasonText("SlashWindowNotDrained", "arbiter")).toMatch(/^Waiting until today's penalty limit has room; it will be paid in full\./);
  });

  it("names an unknown reason rather than guessing", () => {
    expect(refusalReasonText("SomethingNew", "arbiter")).toBe("The chain would refuse this id (SomethingNew).");
  });
});

describe("refusedFunctionOf", () => {
  it("prefers context.functionName and falls back to the message", () => {
    const withContext = new ApiError("SLASH_CHAIN_BATCH_REFUSED", MESSAGE, 422, undefined, {
      functionName: "cancelSlashBatch",
    });
    expect(refusedFunctionOf(withContext)).toBe("cancelSlashBatch");
    expect(refusedFunctionOf(new ApiError("SLASH_CHAIN_BATCH_REFUSED", MESSAGE, 422))).toBe("disputeSlashBatch");
    expect(
      refusedFunctionOf(new ApiError("SLASH_CHAIN_BATCH_REFUSED", MESSAGE, 422, undefined, { functionName: "x y" })),
    ).toBe("disputeSlashBatch");
  });

  it("is null for another error, or a message that names none", () => {
    expect(refusedFunctionOf(new ApiError("CHAIN_PROGRAM_PAUSED", MESSAGE, 503))).toBeNull();
    expect(refusedFunctionOf(new ApiError("SLASH_CHAIN_BATCH_REFUSED", "nope", 422))).toBeNull();
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
