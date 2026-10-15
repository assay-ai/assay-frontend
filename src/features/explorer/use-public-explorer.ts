"use client";

import { useQueries, useQuery } from "@tanstack/react-query";

import { ApiError } from "@/libs/ApiClient";
import { getPublicFeatures } from "@/services/public-features.service";
import {
  getPublicNotCharged,
  getPublicProvider,
  listPublicProviders,
  listPublicTools,
} from "@/services/public-explorer.service";

/**
 * React Query wrappers for the public Explorer. Cached briefly (the server
 * caches 30–60 s too) and retried once — never on a 4xx, so a 429 or a 404 is
 * shown at once instead of being hammered.
 */

const retryOnce = (count: number, error: unknown) =>
  count < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500);

const BASE = { staleTime: 60_000, retry: retryOnce } as const;

export function usePublicTools() {
  return useQuery({ queryKey: ["public", "tools"], queryFn: listPublicTools, ...BASE });
}

export function usePublicProviders() {
  return useQuery({ queryKey: ["public", "providers"], queryFn: listPublicProviders, ...BASE });
}

export function usePublicProvider(providerId: string) {
  return useQuery({
    queryKey: ["public", "provider", providerId],
    queryFn: () => getPublicProvider(providerId),
    enabled: Boolean(providerId),
    ...BASE,
  });
}

/** Provider details for several ids at once (a tool page's providers, for their free allowance). */
export function usePublicProviderDetails(providerIds: readonly string[]) {
  return useQueries({
    queries: providerIds.map((id) => ({
      queryKey: ["public", "provider", id],
      queryFn: () => getPublicProvider(id),
      ...BASE,
    })),
  });
}

export function usePublicNotCharged() {
  return useQuery({ queryKey: ["public", "not-charged"], queryFn: getPublicNotCharged, ...BASE });
}

/**
 * Which optional public features this deployment serves. While unknown, and on
 * failure, the demo reads as off: a demo CTA that leads to "not available" is a
 * dead end, a missing one is not.
 */
export function usePublicFeatures() {
  const query = useQuery({ queryKey: ["public", "features"], queryFn: getPublicFeatures, ...BASE });
  return { demo: query.data?.demo === true, reserves: query.data?.reserves === true, isPending: query.isPending };
}

/** A plain sentence for a failed public read; the raw code goes under Details. */
export function publicErrorText(error: unknown, what: string): string {
  if (error instanceof ApiError && error.status === 429) {
    return `Too many people are looking right now. Wait a minute, then try again.`;
  }
  return `We could not load ${what}. Check your connection and try again.`;
}
