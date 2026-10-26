"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { providerQueries } from "@/features/provider-home/queries";
import { getSessionToken } from "@/libs/ApiClient";
import { demoEnabled } from "@/libs/demo/demo-api";

import { providerEntryFor, type ProviderEntry } from "./entry";

export interface ProviderEntryState {
  entry: ProviderEntry | null;
  /** Signed in and the registration is still being read: the entry is coming (keep its place). */
  pending: boolean;
}

/**
 * The provider entry for the signed-in account. Reads the same
 * `GET /providers/me/registration` key the provider console and setup use,
 * so it costs one request per session, shared. Never fires before Privy has a
 * session: an unauthenticated read 401s, and a 401 signs the user out.
 */
export function useProviderEntryState(options: { enabled?: boolean } = {}): ProviderEntryState {
  const { ready, authenticated } = usePrivy();
  const signedIn = demoEnabled() || (ready && authenticated);
  const enabled = (options.enabled ?? true) && signedIn;
  const query = useQuery({
    ...providerQueries.registration(),
    enabled,
    networkMode: "always",
    staleTime: 60_000,
  });
  const notRegistered = query.error?.status === 404;
  const entry = providerEntryFor({ state: query.data, notRegistered });
  // Kept only on the client (the server render has no session): a signed-in person, or one with a stored
  // session while Privy gets ready, whose registration is still being read.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const maybeSignedIn = demoEnabled() || (ready ? authenticated : mounted && getSessionToken() !== null);
  const pending = mounted && entry === null && (options.enabled ?? true) && maybeSignedIn && query.isPending && !query.isError;
  return { entry, pending };
}

export function useProviderEntry(options: { enabled?: boolean } = {}): ProviderEntry | null {
  return useProviderEntryState(options).entry;
}
