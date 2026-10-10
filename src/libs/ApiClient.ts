import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";

import type { ApiEnvelope, ApiErrorBody } from "@/interfaces";
import { demoEnabled, demoResponse } from "@/libs/demo/demo-api";

const SESSION_TOKEN_KEY = "accessToken";

/**
 * The typed error every caller gets. The API's failure body is
 * `{ success:false, error:{ code, message, statusCode, path, timestamp } }` —
 * a different shape from its success body, and NOT wrapped by the transform
 * interceptor. `code` is the part worth branching on; `message` is for people.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly path?: string;

  constructor(code: string, message: string, status: number, path?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.path = path;
  }
}

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    /* storage disabled; the request will 401 and say so */
  }
}

export function clearSessionToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
}

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Registered by `PrivySessionBridge` — the one place with a router and a
 * query client. `ApiClient` cannot import either itself: this module is
 * imported from Server Components too, and `next/navigation`'s router hooks
 * are client-only. The response interceptor calls this instead of touching
 * either directly.
 *
 * Only a 401 (expired/invalid session) reaches this. A 424
 * (`AUTH_WALLET_NOT_LINKED` — authenticated, just no wallet yet) is a
 * different condition entirely and must never trigger it — it reaches no
 * handler at all; see the response interceptor below.
 */
export function onUnauthorized(handler: UnauthorizedHandler): void {
  unauthorizedHandler = handler;
}

function toApiError(error: AxiosError): ApiError {
  const body = error.response?.data as Partial<ApiErrorBody> | undefined;
  const inner = body?.error;
  if (inner?.code) {
    return new ApiError(inner.code, inner.message, inner.statusCode ?? error.response?.status ?? 0, inner.path);
  }
  return new ApiError(
    error.code ?? "NETWORK_ERROR",
    error.message || "The request could not be completed",
    error.response?.status ?? 0,
  );
}

export interface ApiClientOptions {
  /**
   * Where this instance's bearer token comes from. Defaults to the Privy
   * session token in `localStorage["accessToken"]`.
   *
   * The operator console passes its own reader: that surface is a second
   * authentication path by decision, and the two tokens must not be able to
   * stand in for one another.
   */
  readonly getToken?: () => string | null;
  /**
   * Whether a 401 on this instance triggers the app-wide unauthorized handler
   * — which clears the Privy session and redirects to `/login`.
   *
   * Defaults to `true` for the shared client. The operator client passes
   * `false`: an operator token expiring must not sign a buyer out of the same
   * browser. Its own shell reads the `ApiError` and re-prompts.
   */
  readonly triggerGlobalUnauthorized?: boolean;
}

/**
 * One axios instance for the whole app.
 *
 * Three things this deliberately does differently from the scaffold it
 * replaces:
 *
 *  - It UNWRAPS the envelope. Every success is `{ data, statusCode, message }`
 *    (backend `src/bootstrap/api/main.ts` registers `TransformInterceptor`), so
 *    without this every call site would write `res.data.data` and one of them
 *    would eventually forget.
 *  - It REJECTS on failure. The scaffold returned a value from the rejection
 *    handler, which resolves the promise — a caller could not tell a 401 from a
 *    result, and `try/catch` never fired.
 *  - It never touches `localStorage` outside the browser, so it can be imported
 *    from a Server Component without crashing the render.
 */

class ApiClient {
  private readonly instance: AxiosInstance;
  private readonly getToken: () => string | null;
  private readonly triggerGlobalUnauthorized: boolean;

  constructor(baseURL?: string, options: ApiClientOptions = {}) {
    this.getToken = options.getToken ?? getSessionToken;
    this.triggerGlobalUnauthorized = options.triggerGlobalUnauthorized ?? true;
    this.instance = axios.create({
      baseURL: baseURL || process.env.NEXT_PUBLIC_API_BASE_URL || "",
      timeout: 30000,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      /*
        Axios serialises arrays as `status[]=SETTLED` by default. The API's
        validation rejects that outright — "property status[] should not
        exist" — so every list filter that takes an array (tool-calls `status`
        and `verdict`, and anything added later) failed with a 400 that looked
        like a caller mistake. It wants repeated keys: `status=A&status=B`.
        Undefined and null are dropped rather than sent as the string
        "undefined".
      */
      paramsSerializer: {
        serialize: (params) => {
          const search = new URLSearchParams();
          for (const [key, value] of Object.entries(params ?? {})) {
            if (value === undefined || value === null || value === "") continue;
            if (Array.isArray(value)) {
              for (const entry of value) {
                if (entry === undefined || entry === null) continue;
                search.append(key, String(entry));
              }
            } else {
              search.append(key, String(value));
            }
          }
          return search.toString();
        },
      },
    });

    this.instance.interceptors.request.use((config) => {
      const token = this.getToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    this.instance.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        // 401 only — a 424 (AUTH_WALLET_NOT_LINKED) is an authenticated
        // caller with no linked wallet yet, not an invalid session, and must
        // fall straight through to the caller as an ApiError untouched.
        //
        // A 424 is now observed by nothing at all. It used to notify
        // `WalletProvisioningGate`, which was verified in a browser against an
        // agent whose wallet was genuinely unlinked and never activated once;
        // it is gone, and so is the handler slot it registered into. Each
        // screen sees the 424 itself again.
        /*
          DEMO ONLY: never sign a visitor out. On a demo host the screens are
          drawn from fixtures, but any path WITHOUT a fixture still reaches the
          real API — and a 401 from one of those (a Privy identity this dev
          backend has never provisioned, which is every new account) would log
          the visitor out and bounce them to /login mid-demo, with nothing on
          screen explaining why. The request still fails; only the eviction is
          suppressed.
        */
        if (error.response?.status === 401 && this.triggerGlobalUnauthorized && !demoEnabled()) {
          unauthorizedHandler?.();
        }
        return Promise.reject(toApiError(error));
      },
    );
  }

  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    /*
      DEMO ONLY — both branches are `undefined` unless `NEXT_PUBLIC_DEMO_CHAINS`
      is set at build time, in which case this is the whole of the demo data
      layer's reach into the client. See `libs/demo/demo-api.ts`, which also
      says what it is not allowed to become.
    */
    /*
      Answered BEFORE the network, not after it. The dev API is reachable but
      slow and half-implemented, and a fixture that only lands once the real
      request has resolved inherits every one of its stalls — screens sat on
      "Loading your account…" for as long as the API took to answer a route
      whose answer was going to be discarded. A stage set that waits for the
      stage is not a stage set.
    */
    const canned = demoResponse(config.method, config.url, config.params);
    if (canned !== undefined) return canned as T;

    const response = await this.instance.request<ApiEnvelope<T>>(config);
    return response.data.data;
  }

  get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>({ method: "GET", url, params });
  }

  /**
   * A GET that revalidates past the browser's HTTP cache.
   *
   * Provider GETs are served `private, max-age=10, stale-while-revalidate=3600`,
   * so a plain refetch straight after a write is answered with the pre-write
   * body. `no-cache` means "revalidate before serving", and the ETag turns an
   * unchanged body into a 304. Only `Cache-Control` is sent — this is not a
   * per-call header escape hatch.
   */
  getRevalidated<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>({ method: "GET", url, params, headers: { "Cache-Control": "no-cache" } });
  }

  /**
   * `headers` exists for exactly one caller: the operator console's two
   * two-person actions, which carry the approver's own bearer token in
   * `X-Operator-Approver`. Deliberately not on `get`/`put`/`patch` — a
   * per-call header escape hatch on every verb is how a token ends up
   * somewhere nobody expects it.
   */
  post<T>(url: string, data?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>({ method: "POST", url, data, headers });
  }

  put<T>(url: string, data?: unknown): Promise<T> {
    return this.request<T>({ method: "PUT", url, data });
  }

  patch<T>(url: string, data?: unknown): Promise<T> {
    return this.request<T>({ method: "PATCH", url, data });
  }

  delete<T>(url: string): Promise<T> {
    return this.request<T>({ method: "DELETE", url });
  }

  /** Escape hatch for anything that needs the raw axios instance. */
  raw(): AxiosInstance {
    return this.instance;
  }
}

export default ApiClient;
