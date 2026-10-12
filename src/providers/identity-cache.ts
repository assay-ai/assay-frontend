import type { QueryClient } from "@tanstack/react-query";

/**
 * What the React Query cache does when Privy settles on an identity.
 *
 * - `"boot"`: the first identity this page load resolves to. Everything in the
 *   cache was requested by this page load, under the token this identity's
 *   session supplies, so it is marked stale and refetched in place.
 * - `"switch"`: a different identity than the one this page load had already
 *   reacted to (sign-out, sign-in, another user). Its data must not survive,
 *   so every query is reset to empty and the mounted ones refetch.
 *
 * ## Why not `queryClient.clear()`
 *
 * `clear()` removes each query and cancels its fetch **silently**. A mounted
 * `useQuery` is still subscribed to the removed query and is never told: an
 * observer caught mid-fetch keeps `isLoading` forever (BUG-J-POST-02, the
 * publish checklist sitting on "Reading the gate…" until a reload, while the
 * API had answered in 600 ms). An observer that already had data keeps it
 * until its next render, which then builds a fresh empty query — and every
 * field written as `disabled={!binding}` disables under the cursor
 * (BUG-J-POST-03, the price field losing focus on the first keystroke).
 * Privy turns ready a second or two after every full page load, so both hit a
 * signed-in provider on every fresh navigation.
 *
 * `resetQueries` and `invalidateQueries` both notify observers, so neither
 * strands a screen. Only the switch drops data, because only a switch can
 * leave another tenant's data on screen.
 */
export function settleCacheForIdentity(queryClient: QueryClient, change: "boot" | "switch"): void {
  if (change === "boot") {
    void queryClient.invalidateQueries();
  } else {
    void queryClient.resetQueries();
  }
}
