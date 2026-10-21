import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ApiClient, {
  ApiError,
  forgetSessionRequests,
  onUnauthorized,
  onWalletNotLinked,
  parseRetryAfter,
  registerSessionTokenProvider,
  sessionRequestsSentAs,
  sessionTokenSubject,
} from "@/libs/ApiClient";

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

/** A Privy-shaped access token for `sub` (unsigned: only the payload is read). */
function jwtFor(sub: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "ES256", typ: "JWT" })}.${part({ sub, iss: "privy.io" })}.sig`;
}

function okServer(): AxiosAdapter {
  return async (config) => ({ data: { data: { ok: true } }, status: 200, statusText: "OK", headers: {}, config });
}

/*
  F3: on a reload the screens fetch before Privy is ready, with the token it
  already holds. When every one of those carried the token of the identity
  Privy then resolves to, the cache is that identity's data and the bridge
  does not refetch it.
*/
describe("who the shared client's requests went out as", () => {
  beforeEach(() => forgetSessionRequests());
  afterEach(() => {
    registerSessionTokenProvider(null);
    forgetSessionRequests();
  });

  it("reads the subject of a Privy access token, and nothing from anything else", () => {
    expect(sessionTokenSubject(jwtFor("did:privy:a"))).toBe("did:privy:a");
    expect(sessionTokenSubject("not-a-jwt")).toBeNull();
    expect(sessionTokenSubject("a.%%%.c")).toBeNull();
    expect(sessionTokenSubject(`x.${Buffer.from(JSON.stringify({ sub: 7 })).toString("base64url")}.y`)).toBeNull();
  });

  it("is \"only\" when every request carried the identity's token, \"other\" against anyone else", async () => {
    registerSessionTokenProvider(async () => jwtFor("did:privy:a"));
    const api = client(okServer());
    await Promise.all([api.get("/a"), api.get("/b")]);

    expect(sessionRequestsSentAs("did:privy:a")).toBe("only");
    expect(sessionRequestsSentAs("did:privy:b")).toBe("other");
  });

  it("is \"only\" before any request went out", () => {
    expect(sessionRequestsSentAs("did:privy:a")).toBe("only");
  });

  it("is \"unknown\" once a request went out with no token or an unreadable one", async () => {
    const provider = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(jwtFor("did:privy:a"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("opaque");
    registerSessionTokenProvider(provider);
    const api = client(okServer());
    await api.get("/a");
    await api.get("/b");
    expect(sessionRequestsSentAs("did:privy:a")).toBe("unknown");
    await api.get("/c");
    expect(sessionRequestsSentAs("did:privy:a")).toBe("unknown");
  });

  it("is \"other\" once a request went out with someone else's token, whatever else went out", async () => {
    const provider = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(jwtFor("did:privy:other"))
      .mockResolvedValueOnce(jwtFor("did:privy:a"));
    registerSessionTokenProvider(provider);
    const api = client(okServer());
    await api.get("/a");
    await api.get("/b");
    await api.get("/c");
    expect(sessionRequestsSentAs("did:privy:a")).toBe("other");
  });

  it("is \"unknown\" while a request is still waiting for its token", async () => {
    let release: (token: string) => void = () => undefined;
    registerSessionTokenProvider(() => new Promise<string>((resolve) => (release = resolve)));
    const pending = client(okServer()).get("/a");
    await Promise.resolve();
    expect(sessionRequestsSentAs("did:privy:a")).toBe("unknown");

    release(jwtFor("did:privy:a"));
    await pending;
    expect(sessionRequestsSentAs("did:privy:a")).toBe("only");
  });

  it("ignores a client with its own token (the operator console)", async () => {
    const operator = new ApiClient("http://api.test", { getToken: () => "operator-token" });
    operator.raw().defaults.adapter = okServer();
    await operator.get("/operator/me");
    expect(sessionRequestsSentAs("did:privy:a")).toBe("only");
  });
});

describe("AUTH_WALLET_NOT_LINKED is reported, and still reaches the caller", () => {
  afterEach(() => onWalletNotLinked(null));

  function refusing(code: string, status: number): AxiosAdapter {
    return async (config) => {
      const response: AxiosResponse = {
        data: { success: false, error: { code, message: "x", statusCode: status } },
        status,
        statusText: "Refused",
        headers: {},
        config,
      };
      throw new AxiosError("Refused", "ERR_BAD_REQUEST", config, null, response);
    };
  }

  it("calls the handler for a 424 on the shared client", async () => {
    const seen = vi.fn();
    onWalletNotLinked(seen);
    await expect(client(refusing("AUTH_WALLET_NOT_LINKED", 424)).get("/a")).rejects.toMatchObject({
      code: "AUTH_WALLET_NOT_LINKED",
    });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("not for another refusal, and not on a client with its own token", async () => {
    const seen = vi.fn();
    onWalletNotLinked(seen);
    await expect(client(refusing("NOT_FOUND", 404)).get("/a")).rejects.toBeInstanceOf(ApiError);
    const operator = new ApiClient("http://api.test", { getToken: () => "operator-token" });
    operator.raw().defaults.adapter = refusing("AUTH_WALLET_NOT_LINKED", 424);
    await expect(operator.get("/a")).rejects.toBeInstanceOf(ApiError);
    expect(seen).not.toHaveBeenCalled();
  });
});

/*
  The API is getting per-caller rate limits that answer 429 with Retry-After.
  Nothing retries a 429; a person reads the wait; a poll stops reaching the
  server until the wait is over.
*/
describe("429 Too Many Requests", () => {
  afterEach(() => {
    registerSessionTokenProvider(null);
    vi.useRealTimers();
  });

  /** Answers 429 (with `body` and `retryAfter`) until `limited` is turned off, 200 after. */
  function limiter(options: { body?: unknown; retryAfter?: string } = {}) {
    const state = { limited: true, requests: [] as string[] };
    const adapter: AxiosAdapter = async (config) => {
      state.requests.push(`${(config.method ?? "get").toUpperCase()} ${config.url}`);
      if (!state.limited) return { data: { data: { ok: true } }, status: 200, statusText: "OK", headers: {}, config };
      const response: AxiosResponse = {
        data: options.body ?? { success: false, error: { code: "TOO_MANY_REQUESTS", message: "Too many requests from this address. Try again shortly.", statusCode: 429 } },
        status: 429,
        statusText: "Too Many Requests",
        headers: options.retryAfter === undefined ? {} : { "retry-after": options.retryAfter },
        config,
      };
      throw new AxiosError("Too Many Requests", "ERR_BAD_REQUEST", config, null, response);
    };
    return { adapter, state };
  }

  it("reads Retry-After as seconds or a date, within bounds", () => {
    const now = Date.parse("2026-10-20T00:00:00Z");
    expect(parseRetryAfter("30", now)).toBe(30);
    expect(parseRetryAfter(" 7 ", now)).toBe(7);
    expect(parseRetryAfter("0", now)).toBe(1);
    expect(parseRetryAfter("86400", now)).toBe(300);
    expect(parseRetryAfter("Tue, 20 Oct 2026 00:00:45 GMT", now)).toBe(45);
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter(undefined, now)).toBeNull();
  });

  it("fails at once with the wait in the sentence, and is never retried", async () => {
    const { adapter, state } = limiter({ retryAfter: "30" });
    const provider = vi.fn(async () => "t");
    registerSessionTokenProvider(provider);

    const refusal = await client(adapter).post("/escrow/limits", {}).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ApiError);
    expect(refusal).toMatchObject({ code: "TOO_MANY_REQUESTS", status: 429, retryAfterSeconds: 30 });
    expect((refusal as ApiError).message).toBe("Too many requests. Try again in 30 s.");
    expect(state.requests).toEqual(["POST /escrow/limits"]);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("a poll inside the wait is refused without a request, then reaches the server again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-20T00:00:00Z"));
    const { adapter, state } = limiter({ retryAfter: "20" });
    registerSessionTokenProvider(async () => "t");
    const api = client(adapter);

    await expect(api.get("/receipts/summary", { from: "a" })).rejects.toMatchObject({ retryAfterSeconds: 20 });
    vi.setSystemTime(Date.parse("2026-10-20T00:00:05Z"));
    const local = await api.get("/receipts/summary", { from: "b" }).catch((error: unknown) => error);
    expect(local).toMatchObject({ code: "TOO_MANY_REQUESTS", status: 429, retryAfterSeconds: 15 });
    expect((local as ApiError).message).toBe("Too many requests. Try again in 15 s.");
    expect(state.requests).toHaveLength(1);

    // Another route, and a write to this one, still go to the server.
    await expect(api.get("/balances")).rejects.toMatchObject({ status: 429 });
    await expect(api.post("/receipts/summary", {})).rejects.toMatchObject({ status: 429 });
    expect(state.requests).toEqual(["GET /receipts/summary", "GET /balances", "POST /receipts/summary"]);

    state.limited = false;
    vi.setSystemTime(Date.parse("2026-10-20T00:00:21Z"));
    await expect(api.get("/receipts/summary", { from: "c" })).resolves.toEqual({ ok: true });
    expect(state.requests).toHaveLength(4);
  });

  it("one caller's wait does not hold up another token", async () => {
    const { adapter, state } = limiter({ retryAfter: "60" });
    const provider = vi.fn<() => Promise<string>>().mockResolvedValueOnce("alice").mockResolvedValueOnce("bob");
    registerSessionTokenProvider(provider);
    const api = client(adapter);

    await expect(api.get("/escrow")).rejects.toMatchObject({ status: 429 });
    await expect(api.get("/escrow")).rejects.toMatchObject({ status: 429 });
    expect(state.requests).toEqual(["GET /escrow", "GET /escrow"]);
  });

  it("without Retry-After: no cooldown, a plain sentence", async () => {
    const { adapter, state } = limiter();
    registerSessionTokenProvider(async () => "t");
    const api = client(adapter);

    const refusal = await api.get("/escrow").catch((error: unknown) => error);
    expect((refusal as ApiError).message).toBe("Too many requests. Wait a moment and try again.");
    await expect(api.get("/escrow")).rejects.toMatchObject({ status: 429 });
    expect(state.requests).toHaveLength(2);
  });

  it("a 429 with a domain code keeps its code and its sentence", async () => {
    const { adapter } = limiter({
      body: { success: false, error: { code: "TOOLSET_LIMIT_EXCEEDED", message: "At most 5 always-loaded tools", statusCode: 429 } },
    });
    registerSessionTokenProvider(async () => "t");

    await expect(client(adapter).post("/toolsets", {})).rejects.toMatchObject({
      code: "TOOLSET_LIMIT_EXCEEDED",
      message: "At most 5 always-loaded tools",
      status: 429,
    });
  });

  it("a 429 with no API body (an edge limiter's page) is TOO_MANY_REQUESTS", async () => {
    const { adapter } = limiter({ body: "<html>rate limited</html>", retryAfter: "10" });
    registerSessionTokenProvider(async () => "t");

    await expect(client(adapter).get("/escrow")).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Try again in 10 s.",
      retryAfterSeconds: 10,
    });
  });
});
