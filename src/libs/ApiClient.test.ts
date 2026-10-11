import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ApiClient, { ApiError, onUnauthorized, registerSessionTokenProvider } from "@/libs/ApiClient";

/**
 * A fake transport: the server accepts exactly the tokens in `valid` and
 * answers 401 to anything else. Records the bearer token of every request.
 */
function fakeServer(valid: Set<string>) {
  const seen: (string | undefined)[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const header = config.headers.Authorization as string | undefined;
    seen.push(header);
    const token = header?.replace(/^Bearer /, "");
    const ok = token !== undefined && valid.has(token);
    const response: AxiosResponse = {
      data: ok
        ? { data: { ok: true }, statusCode: 200, message: "ok" }
        : { success: false, error: { code: "AUTH_INVALID", message: "nope", statusCode: 401 } },
      status: ok ? 200 : 401,
      statusText: ok ? "OK" : "Unauthorized",
      headers: {},
      config,
    };
    if (!ok) throw new AxiosError("Unauthorized", "ERR_BAD_REQUEST", config, null, response);
    return response;
  };
  return { adapter, seen };
}

function client(adapter: AxiosAdapter): ApiClient {
  const api = new ApiClient("http://api.test");
  api.raw().defaults.adapter = adapter;
  return api;
}

describe("ApiClient session token", () => {
  let handler: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    handler = vi.fn<() => void>();
    onUnauthorized(handler);
  });

  afterEach(() => {
    registerSessionTokenProvider(null);
    vi.unstubAllGlobals();
  });

  it("asks the registered provider for the token on every request", async () => {
    const { adapter, seen } = fakeServer(new Set(["t1", "t2"]));
    const provider = vi.fn().mockResolvedValueOnce("t1").mockResolvedValueOnce("t2");
    registerSessionTokenProvider(provider);
    const api = client(adapter);

    await api.get("/a");
    await api.get("/b");

    expect(provider).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(["Bearer t1", "Bearer t2"]);
  });

  it("keeps localStorage accessToken in sync with the provider's token", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    });
    const { adapter } = fakeServer(new Set(["fresh"]));
    registerSessionTokenProvider(async () => "fresh");

    await client(adapter).get("/a");

    expect(store.get("accessToken")).toBe("fresh");
  });

  it("falls back to the stored token when no provider is registered", async () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => "static", setItem: () => {}, removeItem: () => {} },
    });
    const { adapter, seen } = fakeServer(new Set(["static"]));

    await client(adapter).get("/a");

    expect(seen).toEqual(["Bearer static"]);
  });

  it("on a 401 refreshes the token once and retries without signing out", async () => {
    const { adapter, seen } = fakeServer(new Set(["fresh"]));
    const provider = vi.fn().mockResolvedValueOnce("expired").mockResolvedValue("fresh");
    registerSessionTokenProvider(provider);

    await expect(client(adapter).get("/a")).resolves.toEqual({ ok: true });

    expect(seen).toEqual(["Bearer expired", "Bearer fresh"]);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the unauthorized handler once when the refresh fails", async () => {
    const { adapter, seen } = fakeServer(new Set());
    const provider = vi.fn().mockResolvedValueOnce("expired").mockRejectedValue(new Error("refresh failed"));
    registerSessionTokenProvider(provider);

    await expect(client(adapter).get("/a")).rejects.toBeInstanceOf(ApiError);

    expect(seen).toEqual(["Bearer expired"]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("calls the unauthorized handler once when the retried request still 401s", async () => {
    const { adapter, seen } = fakeServer(new Set());
    registerSessionTokenProvider(async () => "dead");

    await expect(client(adapter).get("/a")).rejects.toMatchObject({ status: 401 });

    expect(seen).toEqual(["Bearer dead", "Bearer dead"]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("shares one refresh between concurrent 401s", async () => {
    const { adapter } = fakeServer(new Set(["fresh"]));
    let current = "expired";
    let refreshes = 0;
    const provider = vi.fn(async () => current);
    registerSessionTokenProvider(provider);
    const api = client(adapter);

    // The first three calls are the original requests. Any later call made
    // while the token is still the expired one is a refresh; without
    // single-flight, each 401 would start its own.
    provider.mockImplementation(async () => {
      if (provider.mock.calls.length > 3 && current === "expired") {
        refreshes += 1;
        await new Promise((r) => setTimeout(r, 5));
        current = "fresh";
      }
      return current;
    });

    const results = await Promise.all([api.get("/a"), api.get("/b"), api.get("/c")]);

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("leaves a 424 untouched: no refresh, no handler", async () => {
    const adapter: AxiosAdapter = async (config) => {
      const response: AxiosResponse = {
        data: { success: false, error: { code: "AUTH_WALLET_NOT_LINKED", message: "x", statusCode: 424 } },
        status: 424,
        statusText: "Failed Dependency",
        headers: {},
        config,
      };
      throw new AxiosError("Failed Dependency", "ERR_BAD_REQUEST", config, null, response);
    };
    const provider = vi.fn(async () => "t");
    registerSessionTokenProvider(provider);

    await expect(client(adapter).get("/a")).rejects.toMatchObject({ code: "AUTH_WALLET_NOT_LINKED" });

    expect(provider).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });
});
