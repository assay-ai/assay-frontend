"use client";

import { useQuery } from "@tanstack/react-query";

import { ApiError } from "@/libs/ApiClient";
import { getPublishCheck } from "@/services/provider-tool-bindings.service";
import { useStakeStatus } from "@/features/provider-stake/use-stake-status";

import { listingProgress, type ListingProgress } from "./progress";
import { providerQueries } from "@/features/provider-home/queries";

/** Same keys as the shell rail and the setup page, so this costs no extra request there. */
export const PROVIDER_REGISTRATION_KEY = ["provider", "registration"] as const;
export const PROVIDER_BINDINGS_KEY = ["provider", "tool-bindings", "sidebar"] as const;

export function useProviderRegistration() {
  return useQuery(providerQueries.registration());
}

export function useProviderBindings() {
  return useQuery(providerQueries.bindings());
}

/** The "Get listed" progress for Home and the header pill. */
export function useListingProgress(): ListingProgress & { isError: boolean } {
  const registration = useProviderRegistration();
  const bindings = useProviderBindings();
  const stake = useStakeStatus();

  const items = bindings.data?.items;
  const draft = items ? [...items].reverse().find((binding) => binding.status === "DRAFT") : undefined;
  const publishCheck = useQuery({
    queryKey: ["provider", "tool-binding", draft?.id, "publish-check"],
    queryFn: () => getPublishCheck(draft!.id),
    enabled: Boolean(draft),
    retry: false,
  });

  const notRegistered = registration.error instanceof ApiError && registration.error.status === 404;
  const record = registration.data?.registration;
  const progress = listingProgress({
    registration: record
      ? {
          termsAccepted: Boolean(record.acceptedTerms?.acceptedAt),
          payoutWallet: record.payoutAccounts.some((account) => account.status === "ACTIVE"),
          endpoint: record.endpoint,
        }
      : notRegistered || registration.isError
        ? null
        : undefined,
    bindings: items ?? (bindings.isError ? [] : undefined),
    draftTestPassed: publishCheck.data
      ? publishCheck.data.requirements.some((r) => r.requirement === "TESTER_PASSED" && r.met)
      : undefined,
    stakeEnough: stake.enough,
  });

  return { ...progress, isError: bindings.isError && !notRegistered };
}
