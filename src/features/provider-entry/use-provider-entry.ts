"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";

import { providerQueries } from "@/features/provider-home/queries";
import { demoEnabled } from "@/libs/demo/demo-api";

import { providerEntryFor, type ProviderEntry } from "./entry";

/**
 * The provider entry for the signed-in account. Reads the same
 * `GET /providers/me/registration` key the provider console and setup use,
 * so it costs one request per session, shared. Never fires before Privy has a
 * session: an unauthenticated read 401s, and a 401 signs the user out.
 */
export function useProviderEntry(options: { enabled?: boolean } = {}): ProviderEntry | null {
  const { ready, authenticated } = usePrivy();
  const query = useQuery({
    ...providerQueries.registration(),
    enabled: (options.enabled ?? true) && (demoEnabled() || (ready && authenticated)),
    networkMode: "always",
    staleTime: 60_000,
  });
  const notRegistered = query.error?.status === 404;
  return providerEntryFor({ state: query.data, notRegistered });
}
