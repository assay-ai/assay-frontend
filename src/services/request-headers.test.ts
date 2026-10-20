import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { afterEach, describe, expect, it } from "vitest";

import { api } from "./api";
import { revalidateEscrow } from "./escrow.service";
import { operatorApi } from "./operator-api";
import { getProviderStake } from "./provider-stake.service";

/**
 * The API answers every authenticated GET `private, no-cache` (BUG-SYS-01), so
 * the browser revalidates each read on its own. A `Cache-Control` request
 * header on top of that changes nothing about freshness and is one more
 * non-safelisted header on a cross-origin call: neither client sends one.
 */
function recording(): { adapter: AxiosAdapter; headers: Record<string, unknown>[] } {
  const headers: Record<string, unknown>[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    headers.push(config.headers.toJSON());
    const response: AxiosResponse = { data: { data: {} }, status: 200, statusText: "OK", headers: {}, config };
    return response;
  };
  return { adapter, headers };
}

const cacheControl = (headers: Record<string, unknown>) =>
  Object.keys(headers).filter((name) => name.toLowerCase() === "cache-control");

describe("request headers", () => {
  const sharedAdapter = api.raw().defaults.adapter;
  const operatorAdapter = operatorApi.raw().defaults.adapter;
  afterEach(() => {
    api.raw().defaults.adapter = sharedAdapter;
    operatorApi.raw().defaults.adapter = operatorAdapter;
  });

  it("the reads right after a write send no Cache-Control header", async () => {
    const { adapter, headers } = recording();
    api.raw().defaults.adapter = adapter;

    await revalidateEscrow(null);
    await getProviderStake();

    expect(headers).toHaveLength(2);
    for (const sent of headers) expect(cacheControl(sent)).toEqual([]);
  });

  it("the operator client sends no Cache-Control header", async () => {
    const { adapter, headers } = recording();
    operatorApi.raw().defaults.adapter = adapter;

    await operatorApi.get("/operator/approvals");
    await operatorApi.post("/operator/blocks", {});

    expect(headers).toHaveLength(2);
    for (const sent of headers) expect(cacheControl(sent)).toEqual([]);
  });
});
