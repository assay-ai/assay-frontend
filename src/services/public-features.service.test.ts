import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

const get = vi.fn();
vi.mock("@/services/public-api", () => ({
  publicApi: { get: (...args: unknown[]) => get(...args), post: vi.fn() },
}));

const { getDemoStatus } = await import("./demo.service");
const { getPublicReserves } = await import("./reserves.service");

const paths = () => get.mock.calls.map(([path]) => path);

/** The API of a deployment with `features` on; every other route is not registered. */
function deployment(features: { reserves: boolean; demo: boolean }) {
  get.mockImplementation((path: string) => {
    if (path === "/public/features") return Promise.resolve(features);
    if (path === "/public/reserves" && features.reserves) return Promise.resolve({ state: "OK" });
    if (path === "/public/demo/compensation" && features.demo) return Promise.resolve(null);
    return Promise.reject(new ApiError("NOT_FOUND", "Cannot GET", 404));
  });
}

beforeEach(() => {
  get.mockReset();
});

describe("optional public pages (BUG-R5-02)", () => {
  it("never calls the reserves or demo routes on a deployment without them", async () => {
    deployment({ reserves: false, demo: false });

    expect(await getPublicReserves()).toBeNull();
    expect(await getDemoStatus()).toEqual({ configured: false, compensation: null });
    expect(paths()).toEqual(["/public/features", "/public/features"]);
  });

  it("reads them where they exist", async () => {
    deployment({ reserves: true, demo: true });

    expect(await getPublicReserves()).toEqual({ state: "OK" });
    expect(await getDemoStatus()).toEqual({ configured: true, compensation: null });
  });

  it("does not hide a real failure behind 'not available'", async () => {
    get.mockRejectedValue(new ApiError("INTERNAL", "boom", 500));
    await expect(getPublicReserves()).rejects.toMatchObject({ status: 500 });
  });
});
