import { QueryClient, type QueryClientConfig } from "@tanstack/react-query";

import { setSharedReader } from "@/services/shared-reads";

/**
 * How long a read counts as fresh, per kind of data.
 *
 * The API caches its answers per tenant for a few seconds (money and agents
 * 5 s, notifications 15 s, disputes 10 s, bindings, verdicts and provider
 * tools 15 s, SLA windows and tool sets 30 s, settings 60 s, operator lists
 * 15-30 s), and what a person sees can be as old as the two added together. So
 * money and live data are fresh here for 2 s only — enough that every reader
 * mounting with a screen shares one request instead of each refetching on
 * mount — and the rest for about half the server's time. A person's own write
 * invalidates the keys it changed, which refetches whatever the staleness.
 * Static data (chains, the tool catalogue) sets its own on the query.
 */
export const LIVE_STALE_MS = 2_000;

/** Key prefix → staleTime, applied with `setQueryDefaults` (a query's own `staleTime` still wins). */
export const STALE_TIMES: ReadonlyArray<readonly [readonly unknown[], number]> = [
  // Notifications: server 15 s. The bell's count is on `/me/status` (money, 2 s).
  [["notifications"], 7_500],
  [["notification-deliveries"], 7_500],
  // Call disputes: server 10 s.
  [["call-disputes"], 5_000],
  // A provider's bindings, verdicts and tools: server 15 s.
  [["provider", "tool-bindings"], 7_500],
  [["provider", "tool-binding"], 7_500],
  [["provider", "verdicts"], 7_500],
  [["provider", "verdict"], 7_500],
  [["provider", "own-tools"], 7_500],
  // SLA windows: server 30 s.
  [["provider", "sla-windows"], 15_000],
  [["provider", "sla-window"], 15_000],
  // Tool sets and an agent's access: server 30 s.
  [["toolsets"], 15_000],
  [["agent-access"], 15_000],
  [["org-handle"], 30_000],
  // Settings: server 60 s.
  [["notification-channels"], 30_000],
  [["notification-preferences"], 30_000],
  // Operator lists: server 15-30 s.
  [["operator"], 7_500],
];

/**
 * `networkMode: "always"` is the important one, and it is not a preference.
 *
 * React Query's default is "online": when a fetch fails at the transport layer
 * it PAUSES the query instead of failing it. The observed result is
 * `status:"pending", fetchStatus:"paused"` forever, while the underlying
 * request has already rejected — so a screen whose data never arrives sits on
 * "Loading…" indefinitely and never reaches its error branch. That is the worst
 * possible failure for this product: a person waiting on a spinner cannot tell
 * whether they were charged.
 *
 * "always" makes a failed request an error the UI can render. `retry: 0` keeps
 * a dead API from being retried three times before the screen admits it.
 */
export const QUERY_CLIENT_CONFIG: QueryClientConfig = {
  defaultOptions: {
    queries: {
      // See `STALE_TIMES`: money and live data by default.
      staleTime: LIVE_STALE_MS,
      refetchOnWindowFocus: false,
      networkMode: "always",
      retry: 0,
    },
    mutations: {
      networkMode: "always",
    },
  },
};

/** The app's one client, with {@link QUERY_CLIENT_CONFIG} and {@link STALE_TIMES}. Tests make their own the same way. */
export function createAppQueryClient(): QueryClient {
  const client = new QueryClient(QUERY_CLIENT_CONFIG);
  for (const [queryKey, staleTime] of STALE_TIMES) client.setQueryDefaults(queryKey, { staleTime });
  // Services' own reads (the display asset, the chain list) join this cache.
  setSharedReader((queryKey, read, staleTime) => client.fetchQuery({ queryKey, queryFn: read, staleTime }));
  return client;
}
