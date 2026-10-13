import { beforeEach, describe, expect, it, vi } from "vitest";

let ApiError: typeof import("@/libs/ApiClient").ApiError;

const get = vi.fn();
vi.mock("@/services/api", () => ({ api: { get: (...args: unknown[]) => get(...args) } }));

const EVM = "eip155:46630/erc20:0xDbbC";
const SOL = "solana:EtWT/token:4zMM";
const query = { from: "2026-10-01T00:00:00Z", to: "2026-11-01T00:00:00Z", groupBy: "tool" as const };

type Params = { asset?: string } | undefined;

/** The API as it answers a provider with calls in `earned`: 422 without `asset` once two are spanned. */
function apiFor(earned: readonly string[]) {
  return (path: string, params: Params) => {
    if (path === "/chains") {
      return Promise.resolve({ chains: [{ settlementAsset: EVM }, { settlementAsset: SOL }] });
    }
    if (!params?.asset && earned.length > 1) {
      return Promise.reject(new ApiError("PROVIDER_MULTIPLE_ASSETS", "spans more than one", 422));
    }
    const asset = params?.asset ?? earned[0] ?? null;
    return Promise.resolve({ asset, totals: { calls: asset && earned.includes(asset) ? 3 : 0 } });
  };
}

/** A fresh module per test: the asset list is memoised for a few seconds. */
async function load() {
  vi.resetModules();
  ({ ApiError } = await import("@/libs/ApiClient"));
  return import("./provider-reports.service");
}

const earningsCalls = () => get.mock.calls.filter(([path]) => path === "/providers/me/earnings");

beforeEach(() => {
  get.mockReset();
});

describe("getProviderEarnings — a provider paid in two assets (BUG-R5-01)", () => {
  it("never asks without an asset, so no request fails", async () => {
    get.mockImplementation(apiFor([EVM, SOL]));
    const { getProviderEarnings } = await load();

    await expect(getProviderEarnings(query)).resolves.toMatchObject({ asset: EVM });
    await expect(getProviderEarnings({ ...query, groupBy: "day" })).resolves.toMatchObject({
      asset: EVM,
    });

    expect(earningsCalls().every(([, params]) => Boolean((params as Params)?.asset))).toBe(true);
    // One look per settlement asset, shared by both calls, then one request each.
    expect(earningsCalls()).toHaveLength(4);
  });

  it("asks a one-asset provider's question as it was put", async () => {
    get.mockImplementation(apiFor([SOL]));
    const { getProviderEarnings } = await load();

    await expect(getProviderEarnings(query)).resolves.toMatchObject({ asset: SOL });
    expect(get).toHaveBeenLastCalledWith("/providers/me/earnings", query);
  });

  it("still answers a window wider than the look-back that spans two assets", async () => {
    get.mockImplementation((path: string, params: Params) => {
      if (path === "/chains") {
        return Promise.resolve({ chains: [{ settlementAsset: EVM }, { settlementAsset: SOL }] });
      }
      // The look-back sees one asset; the caller's own window spans two.
      if (params?.asset) {
        return Promise.resolve({ asset: params.asset, totals: { calls: params.asset === EVM ? 1 : 0 } });
      }
      return Promise.reject(new ApiError("PROVIDER_MULTIPLE_ASSETS", "spans more than one", 422));
    });
    const { getProviderEarnings } = await load();

    await expect(getProviderEarnings(query)).resolves.toMatchObject({ asset: EVM });
  });

  it("leaves every other failure alone", async () => {
    const { getProviderEarnings } = await load();
    get.mockImplementation(() => Promise.reject(new ApiError("PROVIDER_INVALID_RANGE", "no", 422)));
    await expect(getProviderEarnings(query)).rejects.toMatchObject({ code: "PROVIDER_INVALID_RANGE" });
  });
});

describe("providerEarningAssets — whether to offer the asset selector", () => {
  it("offers nothing to a provider paid in one asset", async () => {
    get.mockImplementation(apiFor([SOL]));
    const { providerEarningAssets } = await load();
    expect(await providerEarningAssets()).toEqual([]);
  });

  it("offers the assets the provider has calls in, learned from requests that succeed", async () => {
    get.mockImplementation(apiFor([EVM, SOL]));
    const { providerEarningAssets } = await load();
    expect(await providerEarningAssets()).toEqual([EVM, SOL]);
    expect(earningsCalls().every(([, params]) => Boolean((params as Params)?.asset))).toBe(true);
  });

  it("offers nothing when the look itself fails", async () => {
    get.mockImplementation(() => Promise.reject(new Error("offline")));
    const { providerEarningAssets } = await load();
    expect(await providerEarningAssets()).toEqual([]);
  });
});
