import { describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/services/api", () => ({
  api: { get: (...args: unknown[]) => get(...args), post: vi.fn() },
}));

const { getDemoStatus } = await import("./demo.service");

describe("getDemoStatus", () => {
  it("is not configured where the deployment says it has no demo, without calling it", async () => {
    get.mockResolvedValueOnce({ reserves: false, demo: false });
    expect(await getDemoStatus()).toEqual({ configured: false, compensation: null });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("is configured when the route answers, with or without a pinned slash", async () => {
    get.mockResolvedValueOnce({ reserves: false, demo: true }).mockResolvedValueOnce(null);
    expect(await getDemoStatus()).toEqual({ configured: true, compensation: null });
  });
});
