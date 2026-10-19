import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";

import type { ApiEnvelope, ApiErrorBody } from "@/interfaces";
import { clearKeptTestInputs } from "@/features/provider-binding/wizard/test-input-store";
import { debtRefusalSentence } from "@/libs/buyer-debt";
import { demoEnabled, demoResponse } from "@/libs/demo/demo-api";
import { SLASH_HOLD_ERROR_CODES, slashHoldAudienceOf, slashHoldErrorText } from "@/libs/slash-hold";

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
  /** `error.context` from the body, when the backend sends one (see `ApiErrorBody`). */
  readonly context?: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    status: number,
    path?: string,
    context?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.path = path;
    this.context = context;
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

/** Every logout path calls this, so per-session leftovers are cleared here too. */
export function clearSessionToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
  clearKeptTestInputs();
}

/**
 * Where the shared client gets a fresh session token, asked once per request.
 *
 * Registered by `PrivySessionBridge` as Privy's `getAccessToken`, which
 * returns the cached token and refreshes it itself when it is near expiry.
 * Reading a token once at login and storing it signed every user out after
 * about an hour (Privy's access-token TTL): nothing ever refreshed it.
 *
 * Unregistered (no Privy session mounted) or answering `null`, the client
 * falls back to the token stored in `localStorage["accessToken"]`, so a token
 * placed there by hand still works.
 */
export type SessionTokenProvider = () => Promise<string | null>;

let sessionTokenProvider: SessionTokenProvider | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function registerSessionTokenProvider(provider: SessionTokenProvider | null): void {
  sessionTokenProvider = provider;
  refreshInFlight = null;
}

/**
 * The current session token: the provider's when it has one — written back to
 * `localStorage` for anything that still reads it there — else the stored one.
 * A provider that throws is treated as having no token.
 */
async function resolveSessionToken(): Promise<string | null> {
  if (sessionTokenProvider) {
    try {
      const token = await sessionTokenProvider();
      if (token) {
        if (token !== getSessionToken()) setSessionToken(token);
        return token;
      }
    } catch {
      /* fall back to the stored token; a dead one 401s and is handled there */
    }
  }
  return getSessionToken();
}

/**
 * Asks the provider again after a 401. Single-flight: a screen fires many
 * requests in parallel, so their 401s arrive together and must share one
 * refresh rather than each starting its own. `null` when there is no provider
 * or it could not produce a token — the 401 then stands.
 */
function refreshSessionToken(): Promise<string | null> {
  const provider = sessionTokenProvider;
  if (!provider) return Promise.resolve(null);
  if (!refreshInFlight) {
    refreshInFlight = provider()
      .then((token) => {
        if (token) setSessionToken(token);
        return token || null;
      })
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
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

/**
 * The two refusals that mean "this account is blocked by Assay".
 *
 * `AUTH_ORGANIZATION_SUSPENDED` is a blocked (or suspended) organization's own
 * session; `ACCOUNT_BLOCKED` is a blocked wallet — the session's own, or
 * another party to the request (a provider's payout wallet, say). Both are
 * 403s: the caller IS signed in, and signing in again changes nothing. So
 * neither may ever sign the user out or send them to `/login` — a blocked
 * person keeps read-only access by decision, precisely so they can see that
 * and why they are blocked.
 */
export const ACCOUNT_BLOCKED_CODES: ReadonlySet<string> = new Set([
  "ACCOUNT_BLOCKED",
  "AUTH_ORGANIZATION_SUSPENDED",
]);

export function isAccountBlockedError(error: unknown): error is ApiError {
  return error instanceof ApiError && ACCOUNT_BLOCKED_CODES.has(error.code);
}

/**
 * What a failed response means for the session, decided on the status AND the
 * code. A blocked code wins over the status, whatever it is: a gateway that
 * ever rewrote one of these to a 401 must still not sign anybody out.
 */
export type AuthFailure = "sign-out" | "account-blocked" | "none";

export function classifyAuthFailure(status: number, code: string | undefined): AuthFailure {
  if (code !== undefined && ACCOUNT_BLOCKED_CODES.has(code)) return "account-blocked";
  if (status === 401) return "sign-out";
  return "none";
}

type AccountBlockedHandler = (error: ApiError) => void;

let accountBlockedHandler: AccountBlockedHandler | null = null;

/**
 * Registered by `AccountBlockBridge`. Called for every `ACCOUNT_BLOCKED` /
 * `AUTH_ORGANIZATION_SUSPENDED` refusal on the shared (Privy) client, so the
 * blocked-account banner appears whichever screen made the request. It is
 * never the unauthorized handler: see `ACCOUNT_BLOCKED_CODES`.
 */
export function onAccountBlocked(handler: AccountBlockedHandler | null): void {
  accountBlockedHandler = handler;
}

/**
 * A client-side refusal of writes, consulted before a non-`GET`/`HEAD` request
 * on the shared client leaves the browser. Returns the error to fail with, or
 * `null` to let the request go. Registered by `AccountBlockBridge` while the
 * account is known to be blocked; the backend refuses those writes anyway, so
 * this only saves the round trip and keeps the refusal uniform.
 */
export type WriteGuard = (method: string, url: string) => ApiError | null;

let writeGuard: WriteGuard | null = null;

export function registerWriteGuard(guard: WriteGuard | null): void {
  writeGuard = guard;
}

/**
 * What a toast says for an organization refusal. The backend's message for
 * `AUTH_ORGANIZATION_SUSPENDED` says "suspended"; the banner says "blocked".
 * One word for one state: the message is reworded here, the code is kept.
 */
export const ORGANIZATION_BLOCKED_MESSAGE =
  "Your organization is blocked by Assay. You can view your data, but you cannot make payments or changes.";

function withBlockedWording(error: ApiError): ApiError {
  if (error.code !== "AUTH_ORGANIZATION_SUSPENDED") return error;
  return new ApiError(error.code, ORGANIZATION_BLOCKED_MESSAGE, error.status, error.path);
}

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * A slash-hold refusal (`TOOL_PROVIDER_SLASH_HOLD`, `PAYMENT_PROVIDER_SLASH_HOLD`)
 * in the words of whoever made the request: the provider console's own routes
 * speak to the held provider, every other route to the buyer. The code,
 * status, path and context are kept; only the sentence changes.
 */
export function withSlashHoldWording(error: ApiError, requestUrl: string | null | undefined): ApiError {
  if (!SLASH_HOLD_ERROR_CODES.has(error.code)) return error;
  const chainId = error.context?.chainId;
  const text = slashHoldErrorText(
    error.code,
    slashHoldAudienceOf(requestUrl ?? error.path),
    typeof chainId === "string" ? chainId : null,
  );
  return text ? new ApiError(error.code, text, error.status, error.path, error.context) : error;
}

/**
 * A buyer-debt refusal (`PAYMENT_DEBT_OUTSTANDING`, `PAYMENT_DEBT_NOT_FOUND`)
 * in the buyer's words. The code, status, path and context are kept.
 */
export function withDebtWording(error: ApiError): ApiError {
  const text = debtRefusalSentence(error);
  return text ? new ApiError(error.code, text, error.status, error.path, error.context) : error;
}

function toApiError(error: AxiosError): ApiError {
  const body = error.response?.data as Partial<ApiErrorBody> | undefined;
  const inner = body?.error;
  if (inner?.code) {
    const context =
      inner.context && typeof inner.context === "object" && !Array.isArray(inner.context)
        ? inner.context
        : undefined;
    return new ApiError(
      inner.code,
      inner.message,
      inner.statusCode ?? error.response?.status ?? 0,
      inner.path,
      context,
    );
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
   * session token: the registered `SessionTokenProvider`, else
   * `localStorage["accessToken"]`. Only that default refreshes and retries
   * once on a 401.
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
  /**
   * Called on every 401 from this instance, with the refused request's URL.
   * The operator client uses it to end its own session and send the operator
   * back to sign-in, whichever operator call was refused.
   */
  readonly onUnauthorized?: (error: ApiError, url: string) => void;
}

/** A body together with the HTTP status that carried it. */
export interface StatusAnswer<T> {
  readonly status: number;
  readonly data: T;
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

/** Set on a request that already got its one post-401 retry. */
type RetriableConfig = InternalAxiosRequestConfig & { _authRetried?: boolean };

class ApiClient {
  private readonly instance: AxiosInstance;
  private readonly getToken: () => string | null | Promise<string | null>;
  private readonly usesSessionToken: boolean;
  private readonly triggerGlobalUnauthorized: boolean;
  private readonly onInstanceUnauthorized?: (error: ApiError, url: string) => void;

  constructor(baseURL?: string, options: ApiClientOptions = {}) {
    this.usesSessionToken = !options.getToken;
    this.getToken = options.getToken ?? resolveSessionToken;
    this.triggerGlobalUnauthorized = options.triggerGlobalUnauthorized ?? true;
    this.onInstanceUnauthorized = options.onUnauthorized;
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

    this.instance.interceptors.request.use(async (config) => {
      const token = await this.getToken();
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    this.instance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        /*
          An expired session token is the expected 401: Privy may not have
          refreshed it yet. Refresh once and retry the request once with the
          new token before treating the session as dead. A retry that 401s
          again comes back through here marked, and falls through below.
        */
        const config = error.config as RetriableConfig | undefined;
        const apiError = withDebtWording(withSlashHoldWording(toApiError(error), error.config?.url));
        const failure = classifyAuthFailure(error.response?.status ?? apiError.status, apiError.code);

        /*
          A blocked account. Never the sign-out path, never a token refresh:
          the session is valid, it is the account that may not act. The
          handler only shows the banner. The operator client does not report
          here — its refusals are about the operator, not a buyer.
        */
        if (failure === "account-blocked") {
          const refusal = withBlockedWording(apiError);
          if (this.triggerGlobalUnauthorized) accountBlockedHandler?.(refusal);
          return Promise.reject(refusal);
        }

        if (failure === "sign-out" && this.usesSessionToken && config && !config._authRetried) {
          config._authRetried = true;
          const fresh = await refreshSessionToken();
          if (fresh) return this.instance.request(config);
        }

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
        if (failure === "sign-out" && this.triggerGlobalUnauthorized && !demoEnabled()) {
          unauthorizedHandler?.();
        }
        if (failure === "sign-out") this.onInstanceUnauthorized?.(apiError, error.config?.url ?? "");
        return Promise.reject(apiError);
      },
    );
  }

  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    return (await this.requestWithStatus<T>(config)).data;
  }

  private async requestWithStatus<T>(config: AxiosRequestConfig): Promise<StatusAnswer<T>> {
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
    const canned = demoResponse(config.method, config.url, config.params, config.data);
    if (canned !== undefined) return { status: 200, data: canned as T };

    /*
      The blocked-account guard. Only on the shared client — the operator
      console's writes are an operator's, not the blocked account's — and only
      for writes: reads stay open for a blocked person, by decision.
    */
    const method = (config.method ?? "GET").toUpperCase();
    if (this.usesSessionToken && writeGuard && !READ_METHODS.has(method)) {
      const refusal = writeGuard(method, config.url ?? "");
      if (refusal) {
        if (this.triggerGlobalUnauthorized) accountBlockedHandler?.(refusal);
        throw refusal;
      }
    }

    const response = await this.instance.request<ApiEnvelope<T>>(config);
    return { status: response.status, data: response.data?.data as T };
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
   *
   * Belt and braces since BUG-SYS-01: the backend now sends every GET that does
   * not opt in with `@CacheHeader` as `private, no-cache`, so a plain `get`
   * already revalidates and is never served stale. This helper (and
   * `revalidateEscrow` / `revalidateProviderStake`, which go through it) is
   * kept for a route that later opts in to a freshness window.
   */
  getRevalidated<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>({ method: "GET", url, params, headers: { "Cache-Control": "no-cache" } });
  }

  post<T>(url: string, data?: unknown): Promise<T> {
    return this.request<T>({ method: "POST", url, data });
  }

  /**
   * A write whose HTTP status means something: a two-person operator route
   * answers `202 { approvalId }` when it queued the action instead of running
   * it, with the same envelope as a `200`.
   */
  postWithStatus<T>(url: string, data?: unknown): Promise<StatusAnswer<T>> {
    return this.requestWithStatus<T>({ method: "POST", url, data });
  }

  patchWithStatus<T>(url: string, data?: unknown): Promise<StatusAnswer<T>> {
    return this.requestWithStatus<T>({ method: "PATCH", url, data });
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
