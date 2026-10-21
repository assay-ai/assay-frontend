import { describe, expect, it } from "vitest";

import { ApiError } from "@/libs/ApiClient";
import { isRecordMissing } from "@/libs/record-missing";

describe("isRecordMissing", () => {
  it("is true for a 404 and for a malformed id (400 VALIDATION_FAILED)", () => {
    expect(isRecordMissing(new ApiError("NOT_FOUND", "x", 404))).toBe(true);
    expect(isRecordMissing(new ApiError("VALIDATION_FAILED", "id must be a UUID", 400))).toBe(true);
  });

  it("is false for other failures, which may pass on a retry", () => {
    expect(isRecordMissing(new ApiError("INTERNAL", "x", 500))).toBe(false);
    expect(isRecordMissing(new ApiError("BAD_THING", "x", 400))).toBe(false);
    expect(isRecordMissing(new Error("network"))).toBe(false);
    expect(isRecordMissing(null)).toBe(false);
  });
});
