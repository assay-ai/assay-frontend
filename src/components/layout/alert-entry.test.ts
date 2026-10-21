import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

import { markAlertsRead } from "./alert-entry";

describe("markAlertsRead", () => {
  it("marks every copy, retries a failure once, and returns only what still failed", async () => {
    const tries = new Map<string, number>();
    const mark = vi.fn(async (id: string) => {
      tries.set(id, (tries.get(id) ?? 0) + 1);
      if (id === "flaky" && tries.get(id) === 1) throw new Error("network");
      if (id === "down") throw new Error("network");
    });
    await expect(markAlertsRead(["ok", "flaky", "down"], mark)).resolves.toEqual(["down"]);
    expect(tries).toEqual(new Map([["ok", 1], ["flaky", 2], ["down", 2]]));
  });
  it("counts a 404 as already gone", async () => {
    const mark = vi.fn(async () => {
      throw new ApiError("NOTIFICATION_NOT_FOUND", "not found", 404);
    });
    await expect(markAlertsRead(["gone"], mark)).resolves.toEqual([]);
    expect(mark).toHaveBeenCalledTimes(1);
  });
});
