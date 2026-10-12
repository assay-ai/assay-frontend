import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

const get = vi.fn();
vi.mock("@/services/api", () => ({ api: { get: (...args: unknown[]) => get(...args) } }));

const { getProviderEarnings } = await import("./provider-reports.service");

const EVM = "eip155:46630/erc20:0xDbbC";
const SOL = "solana:EtWT/token:4zMM";
const query = { from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z", groupBy: "tool" as const };

describe("getProviderEarnings — a window spanning two assets (BUG-R2-V2-01)", () => {
  it("asks again in the first chain's settlement asset instead of failing the page", async () => {
    get.mockImplementation((path: string, params?: { asset?: string }) => {
      if (path === "/chains") {
        return Promise.resolve({ chains: [{ settlementAsset: EVM }, { settlementAsset: SOL }] });
      }
      return params?.asset
        ? Promise.resolve({ asset: params.asset })
        : Promise.reject(new ApiError("PROVIDER_MULTIPLE_ASSETS", "spans more than one", 422));
    });

    await expect(getProviderEarnings(query)).resolves.toEqual({ asset: EVM });
  });

  it("leaves every other failure alone", async () => {
    get.mockImplementation(() => Promise.reject(new ApiError("PROVIDER_INVALID_RANGE", "no", 422)));
    await expect(getProviderEarnings(query)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RANGE" });
  });
});
