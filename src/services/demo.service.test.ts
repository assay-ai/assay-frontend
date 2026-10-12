import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

const get = vi.fn();
vi.mock("@/services/api", () => ({
  api: { get: (...args: unknown[]) => get(...args), post: vi.fn() },
}));

const { getDemoStatus } = await import("./demo.service");

describe("getDemoStatus", () => {
  it("reads a 404 as 'no demo on this deployment' — the routes are not mounted", async () => {
    get.mockRejectedValueOnce(new ApiError("NOT_FOUND", "Cannot GET", 404));
    expect(await getDemoStatus()).toEqual({ configured: false, compensation: null });
  });

  it("is configured when the route answers, with or without a pinned slash", async () => {
    get.mockResolvedValueOnce(null);
    expect(await getDemoStatus()).toEqual({ configured: true, compensation: null });
  });
});
