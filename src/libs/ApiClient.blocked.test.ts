import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ApiClient, {
  ApiError,
  classifyAuthFailure,
  isAccountBlockedError,
  onAccountBlocked,
  onUnauthorized,
  registerSessionTokenProvider,
  registerWriteGuard,
} from "@/libs/ApiClient";

/** A server that refuses every request with one status and code. */
function refusing(status: number, code: string) {
  const calls: string[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    calls.push(`${config.method?.toUpperCase()} ${config.url}`);
    const response: AxiosResponse = {
      data: { success: false, error: { code, message: `refused: ${code}`, statusCode: status } },
      status,
      statusText: "refused",
      headers: {},
      config,
    };
    throw new AxiosError("refused", "ERR_BAD_REQUEST", config, null, response);
  };
  return { adapter, calls };
}

function accepting() {
  const calls: string[] = [];
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    calls.push(`${config.method?.toUpperCase()} ${config.url}`);
    return {
      data: { data: { ok: true }, statusCode: 200, message: "ok" },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  };
  return { adapter, calls };
}

function client(adapter: AxiosAdapter, options?: ConstructorParameters<typeof ApiClient>[1]) {
  const api = new ApiClient("http://api.test", options);
  api.raw().defaults.adapter = adapter;
  return api;
}

describe("classifyAuthFailure", () => {
  it("never signs out on the two blocked codes, whatever the status", () => {
    expect(classifyAuthFailure(403, "ACCOUNT_BLOCKED")).toBe("account-blocked");
    expect(classifyAuthFailure(403, "AUTH_ORGANIZATION_SUSPENDED")).toBe("account-blocked");
    expect(classifyAuthFailure(401, "ACCOUNT_BLOCKED")).toBe("account-blocked");
    expect(classifyAuthFailure(401, "AUTH_ORGANIZATION_SUSPENDED")).toBe("account-blocked");
  });

  it("signs out on any other 401 only", () => {
    expect(classifyAuthFailure(401, "MCP_CREDENTIAL_INVALID")).toBe("sign-out");
    expect(classifyAuthFailure(401, undefined)).toBe("sign-out");
    expect(classifyAuthFailure(403, "FORBIDDEN")).toBe("none");
    expect(classifyAuthFailure(424, "AUTH_WALLET_NOT_LINKED")).toBe("none");
  });
});

describe("ApiClient on a blocked account", () => {
  let unauthorized: ReturnType<typeof vi.fn<() => void>>;
  let blocked: ReturnType<typeof vi.fn<(error: ApiError) => void>>;

  beforeEach(() => {
    unauthorized = vi.fn<() => void>();
    blocked = vi.fn<(error: ApiError) => void>();
    onUnauthorized(unauthorized);
    onAccountBlocked(blocked);
  });

  afterEach(() => {
    onAccountBlocked(null);
    registerWriteGuard(null);
    registerSessionTokenProvider(null);
  });

  it.each(["ACCOUNT_BLOCKED", "AUTH_ORGANIZATION_SUSPENDED"])(
    "a 403 %s on a write shows the banner and never signs out",
    async (code) => {
      const { adapter } = refusing(403, code);
      const error = await client(adapter).post("/payment-intents", {}).catch((e: unknown) => e);

      expect(isAccountBlockedError(error)).toBe(true);
      expect((error as ApiError).status).toBe(403);
      expect(blocked).toHaveBeenCalledTimes(1);
      expect(blocked.mock.calls[0][0].code).toBe(code);
      expect(unauthorized).not.toHaveBeenCalled();
    },
  );

  it("words an organization refusal as blocked, like the banner, never suspended", async () => {
    const { adapter } = refusing(403, "AUTH_ORGANIZATION_SUSPENDED");
    const error = (await client(adapter).patch("/spend-policy", {}).catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe("AUTH_ORGANIZATION_SUSPENDED");
    expect(error.message).toMatch(/blocked/);
    expect(error.message).not.toMatch(/suspended/i);
    expect(blocked.mock.calls[0][0].message).toBe(error.message);
  });

  it("does not refresh the session token on a blocked refusal, even a 401-shaped one", async () => {
    const provider = vi.fn(async () => "t");
    registerSessionTokenProvider(provider);
    const { adapter, calls } = refusing(401, "AUTH_ORGANIZATION_SUSPENDED");

    await client(adapter).post("/x").catch(() => undefined);

    // One call to resolve the token for the request, none to refresh it.
    expect(provider).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(unauthorized).not.toHaveBeenCalled();
    expect(blocked).toHaveBeenCalledTimes(1);
  });

  it("still signs out on a genuine 401", async () => {
    const { adapter } = refusing(401, "MCP_CREDENTIAL_INVALID");
    await client(adapter).get("/x").catch(() => undefined);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    expect(blocked).not.toHaveBeenCalled();
  });

  it("the operator client reports neither", async () => {
    const { adapter } = refusing(403, "ACCOUNT_BLOCKED");
    const operator = client(adapter, { getToken: () => "op", triggerGlobalUnauthorized: false });
    await operator.post("/operator/blocks").catch(() => undefined);
    expect(blocked).not.toHaveBeenCalled();
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it("the write guard refuses writes before they leave, and lets reads through", async () => {
    const { adapter, calls } = accepting();
    registerWriteGuard((method) =>
      method === "GET" || method === "HEAD" ? null : new ApiError("ACCOUNT_BLOCKED", "blocked", 403),
    );
    const api = client(adapter);

    await expect(api.get("/account/block-status")).resolves.toEqual({ ok: true });
    const error = await api.post("/funding/deposit", {}).catch((e: unknown) => e);

    expect(isAccountBlockedError(error)).toBe(true);
    expect(calls).toEqual(["GET /account/block-status"]);
    expect(blocked).toHaveBeenCalledTimes(1);
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it("the write guard does not apply to the operator client", async () => {
    const { adapter, calls } = accepting();
    registerWriteGuard(() => new ApiError("ACCOUNT_BLOCKED", "blocked", 403));
    const operator = client(adapter, { getToken: () => "op", triggerGlobalUnauthorized: false });
    await expect(operator.post("/operator/blocks", {})).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["POST /operator/blocks"]);
  });
});
