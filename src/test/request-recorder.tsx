/**
 * TEST ONLY. Counts the API requests a mounted screen makes.
 *
 * Replaces the shared `api` client (`@/services/api`) with one that records
 * every call and answers it from the demo's fixtures — consistent data for
 * every screen, with nothing reaching a network. A path no fixture answers
 * gets an empty page. Mount the screen with `createAppQueryClient()`, the
 * app's own query defaults, so what is counted is what the app sends.
 *
 *   vi.mock("@/services/api", async () => (await import("@/test/request-recorder")).recordedApiModule());
 */
import { ROBINHOOD_TESTNET } from "@/libs/chains/demo-chains";
import { DEMO_FIXTURES } from "@/libs/demo/fixtures";

/** Answers the demo fixtures leave to the demo flag (it is off here). */
const OVERRIDES: Record<string, () => unknown> = {
  "GET /chains": () => ({ chains: [ROBINHOOD_TESTNET] }),
};

export interface RecordedRequest {
  method: string;
  path: string;
  params: Record<string, unknown>;
}

export const recorded: RecordedRequest[] = [];

function answer(method: string, url: string, params: Record<string, unknown> = {}, data?: unknown): unknown {
  const path = url.split("?")[0]!.startsWith("/") ? url.split("?")[0]! : `/${url.split("?")[0]}`;
  recorded.push({ method, path, params });
  const override = OVERRIDES[`${method} ${path}`];
  if (override) return override();
  const fixture = DEMO_FIXTURES.find(
    (f) => f.method === method && (f.match instanceof RegExp ? f.match.test(path) : f.match === path),
  );
  if (!fixture) return { items: [], pageInfo: { nextCursor: null, hasMore: false } };
  return fixture.body(path, params, (data ?? {}) as Record<string, unknown>);
}

const recordingClient = {
  get: async (url: string, params?: Record<string, unknown>) => answer("GET", url, params),
  post: async (url: string, data?: unknown) => answer("POST", url, {}, data),
  put: async (url: string, data?: unknown) => answer("PUT", url, {}, data),
  patch: async (url: string, data?: unknown) => answer("PATCH", url, {}, data),
  delete: async (url: string) => answer("DELETE", url),
};

export function recordedApiModule() {
  return { api: recordingClient };
}

/** `GET /path` → how many times it was asked, every query string counted under its path. */
export function countsByPath(requests: readonly RecordedRequest[] = recorded): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of requests) {
    const key = `${r.method} ${r.path}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** `GET /path?a=1&b=2` (params sorted) → how many times that exact request was sent. */
export function countsByRequest(requests: readonly RecordedRequest[] = recorded): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of requests) {
    const query = Object.keys(r.params)
      .filter((k) => r.params[k] !== undefined)
      .sort()
      .map((k) => `${k}=${String(r.params[k])}`)
      .join("&");
    const key = `${r.method} ${r.path}${query ? `?${query}` : ""}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function resetRecorded(): void {
  recorded.length = 0;
}

/** Privy, stubbed for a signed-in buyer with no wallet connected. */
export function privyModule() {
  const none = async () => ({ signature: "0x" });
  return {
    usePrivy: () => ({ ready: true, authenticated: true, user: { id: "did:privy:test" }, getAccessToken: async () => "token", logout: async () => undefined, login: () => undefined }),
    useWallets: () => ({ ready: true, wallets: [] }),
    useSignMessage: () => ({ signMessage: none }),
    useSignTypedData: () => ({ signTypedData: none }),
    useSignTransaction: () => ({ signTransaction: none }),
    useConnectWallet: () => ({ connectWallet: () => undefined }),
    useCreateWallet: () => ({ createWallet: async () => undefined }),
    useLogout: () => ({ logout: async () => undefined }),
    useLogin: () => ({ login: () => undefined }),
    PrivyProvider: ({ children }: { children: unknown }) => children,
  };
}

export function privySolanaModule() {
  const none = async () => ({ signature: new Uint8Array() });
  return {
    useWallets: () => ({ ready: true, wallets: [] }),
    useSignMessage: () => ({ signMessage: none }),
    useSignTransaction: () => ({ signTransaction: async () => ({ signedTransaction: new Uint8Array() }) }),
    useSignAndSendTransaction: () => ({ signAndSendTransaction: none }),
    toSolanaWalletConnectors: () => ({}),
  };
}
