"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import * as React from "react";

import { shortId } from "@/components/patterns/copy-chip";
import type { OperatorDirectoryEntry } from "@/interfaces/operator";
import { listCatalogueProviders, type CatalogueProvider } from "@/services/catalogue.service";
import { getOperatorCase, listOperators } from "@/services/operator.service";
import { formatMoney } from "@/utils/money";

import { penaltyPhrase } from "./approvals";
import { operatorLabel } from "./inbox";

/**
 * Names for the ids the operator console shows, from endpoints the operator
 * session can reach:
 *
 *   provider  GET /catalogue/providers   the public catalogue (no session needed) → `legalName`
 *   operator  GET /operator/operators    the directory → display name
 *
 * `useEntityNames` cannot be used here: its other lists need the Privy
 * session. A provider that is not listed in the catalogue (unlisted, or no
 * live tool) has no public name, so it falls back to its short id.
 */
export function useProviderNames(): {
  name: (providerId: string) => string;
  lookup: (providerId: string | null | undefined) => string | null;
  providers: readonly CatalogueProvider[];
  isPending: boolean;
} {
  const query = useQuery({
    queryKey: ["catalogue", "providers"],
    queryFn: listCatalogueProviders,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  return React.useMemo(() => {
    const providers = query.data?.providers ?? [];
    const map = new Map(providers.map((p) => [p.providerId, p.legalName]));
    return {
      providers,
      lookup: (id) => (id ? (map.get(id) ?? null) : null),
      name: (id) => map.get(id) ?? `Provider ${shortId(id)}`,
      isPending: query.isPending,
    };
  }, [query.data, query.isPending]);
}

const DIRECTORY_LIMIT = 100;

/** The operator directory (first page, which is the whole team in practice), for names and approvers. */
export function useOperatorDirectory(): {
  operators: readonly OperatorDirectoryEntry[];
  /** "Riley Brooks", from a subject (`riley@`) or an id. Falls back to what was given. */
  nameOf: (subjectOrId: string | null | undefined) => string;
  isPending: boolean;
  isError: boolean;
} {
  const query = useQuery({
    queryKey: ["operator", "operators", "directory"],
    queryFn: () => listOperators({ limit: DIRECTORY_LIMIT }),
    staleTime: 60_000,
    retry: 0,
  });
  return React.useMemo(() => {
    const operators = query.data?.items ?? [];
    const bySubject = new Map(operators.map((op) => [op.subject, op]));
    const byId = new Map(operators.map((op) => [op.id, op]));
    return {
      operators,
      nameOf: (key) => {
        if (!key) return "someone";
        const op = bySubject.get(key) ?? byId.get(key);
        return op ? operatorLabel(op) : key;
      },
      isPending: query.isPending,
      isError: query.isError,
    };
  }, [query.data, query.isPending, query.isError]);
}

/** At most this many penalties are read to name them; the rest keep a short id. */
const CASE_LOOKUP_MAX = 30;

/**
 * "Northwind Geo's $28.47 penalty" for each penalty id given, read from the
 * penalty itself (the same query the penalty page uses, so it is cached
 * both ways). An id still loading, or not found, has no entry; callers fall
 * back to a short id.
 */
export function usePenaltyNames(ids: readonly string[]): ReadonlyMap<string, string> {
  const providers = useProviderNames();
  const unique = React.useMemo(() => [...new Set(ids.filter(Boolean))].slice(0, CASE_LOOKUP_MAX), [ids]);
  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: ["operator", "case", id],
      queryFn: () => getOperatorCase(id),
      staleTime: 60_000,
      retry: 0,
    })),
  });
  // Cheap to rebuild: a handful of entries.
  const map = new Map<string, string>();
  unique.forEach((id, index) => {
    const brief = results[index]?.data;
    if (!brief) return;
    const proposal = brief.case.proposal;
    map.set(id, penaltyPhrase(providers.name(proposal.providerId), formatMoney(proposal.penaltyAmount)));
  });
  return map;
}
