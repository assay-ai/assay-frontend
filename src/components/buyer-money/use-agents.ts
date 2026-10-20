"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { splitDebts } from "@/features/buyer-debt/debt-copy";
import { useBuyerDebtsQuery } from "@/features/buyer-debt/settle-debt-sheet";

import { agentReadiness, type AgentReadiness } from "@/features/buyer-money/agent-readiness";
import type { CredentialLike } from "@/features/buyer-money/mcp-config";
import { supportsDelegation } from "@/features/delegation/delegation-form";
import { useChains } from "@/hooks/useChains";
import type { EscrowDelegate } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { servesPaidCalls } from "@/libs/chains/paid-rails";
import { chainDisplayName } from "@/services/chains.service";
import { getSpendPolicyTyped, type SpendPolicy } from "@/services/limits.service";
import { chainIdOfAccount } from "@/utils/chain";

import { AGENTS_WITH_KEYS_KEY, readAgentsWithKeys } from "@/features/agents/agent-list";

import { useEscrowQuery } from "./use-buyer-money";
import { useDelegatesQuery } from "./use-delegates";

export interface AgentRow {
  agentId: string;
  label?: string;
  agentAccount?: string;
}

/** `AgentCredentialDto.oauthClient` (spec §7.10 item 4). */
export interface KeyOAuthClient {
  /** The public `client_id`: a CIMD URL, `dcr_…`, or the built-in client's URL. */
  clientId: string;
  /** Its own name, or its listed name when verified. Self-declared otherwise. */
  name: string;
  /** eTLD+1 of a CIMD client's host; null when no domain is proven (DCR, built-in). */
  registrableDomain: string | null;
  verified: boolean;
  /** May hold a payment key (`OAUTH_PAYMENT_CLIENTS`: the built-in `assay-mcp` only). Every other app is free-only. */
  paymentClient: boolean;
}

export interface KeyRow extends CredentialLike {
  id: string;
  agentId: string;
  name: string;
  /** How the credential was obtained; everything else about it is the same. */
  issuedVia: "API_KEY" | "OAUTH";
  /** The app an OAuth grant was issued to; null for an API key. */
  oauthClient?: KeyOAuthClient | null;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  delegateAccount?: string | null;
  delegateBoundAt?: string | null;
  createdAt: string;
}

/**
 * An agent's key health, worked out by the API from exactly the keys in
 * `credentials` (`GET /agents?include=health`). Two meanings of "live" are
 * kept apart: the readiness line's (`liveKeyCount`: not revoked, not past
 * `expiresAt`) and Get started / Connect's (`unrevokedKeyCount`: not revoked).
 */
export interface AgentHealth {
  evaluatedAt: string;
  liveKeyCount: number;
  unrevokedKeyCount: number;
  keyBound: boolean;
  boundKeyCount: number;
  /** A key that is not revoked has been used. */
  firstCallSeen: boolean;
  /** Latest `lastUsedAt` over live keys. */
  lastUsedAt: string | null;
  /** Earliest `lastUsedAt` over keys that are not revoked. */
  earliestLastUsedAt: string | null;
  /** Latest `lastUsedAt` over every key, revoked ones included. */
  lastUsedAtAnyKey: string | null;
}

/** `GET /agents?include=credentials,health`: an agent row with its first 50 keys and their health. */
export interface AgentWithKeys extends AgentRow {
  credentials: { items: KeyRow[]; hasMore: boolean };
  health: AgentHealth;
}

export interface AgentsWithKeysPage {
  items: AgentWithKeys[];
}

export { AGENTS_WITH_KEYS_KEY, readAgentsWithKeys };

/** The keys map the screens read, by agent id. */
export function keysByAgent(page: AgentsWithKeysPage): Record<string, KeyRow[]> {
  return Object.fromEntries((page.items ?? []).map((agent) => [agent.agentId, agent.credentials.items]));
}

/** Each agent's key health, by agent id. */
export function healthByAgent(page: AgentsWithKeysPage): Record<string, AgentHealth> {
  return Object.fromEntries((page.items ?? []).map((agent) => [agent.agentId, agent.health]));
}

/** The query's state, for one of its two readings (the agents, or their keys). */
export interface QueryPart<T> {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => Promise<unknown>;
}

export function useSpendPolicyQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["spend-policy"],
    enabled: options.enabled ?? true,
    retry: false,
    queryFn: async (): Promise<SpendPolicy | null> => {
      try {
        return await getSpendPolicyTyped();
      } catch (error) {
        if (error instanceof ApiError && error.code === "SPEND_POLICY_NOT_FOUND") return null;
        throw error;
      }
    },
  });
}

/**
 * Agents, their keys, the on-chain pay permissions and the escrow, with each
 * agent's readiness worked out. `pollMs` turns on the live listener (first
 * call, key bound) used by Get started and while an agent waits for a key.
 */
export function useAgentsAndKeys(options: { pollMs?: number | false } = {}) {
  const poll = options.pollMs ?? false;
  const query = useQuery<AgentsWithKeysPage, unknown>({
    queryKey: AGENTS_WITH_KEYS_KEY,
    retry: false,
    refetchInterval: poll,
    queryFn: readAgentsWithKeys,
  });
  const { data: page, refetch } = query;
  const agents = React.useMemo(() => page?.items ?? [], [page]);
  const keys = React.useMemo(() => (page ? keysByAgent(page) : undefined), [page]);
  const health = React.useMemo(() => (page ? healthByAgent(page) : {}), [page]);
  // Agents and keys come in one answer. The agents read as failed only when
  // there is nothing to show; a failed refresh (a poll) marks the keys
  // unreadable and keeps the agents on screen, as the separate keys poll did.
  const agentsQuery: QueryPart<AgentsWithKeysPage> = {
    data: page,
    error: query.isLoadingError ? query.error : null,
    isPending: query.isPending,
    isError: query.isLoadingError,
    isSuccess: page !== undefined,
    refetch,
  };
  const keysQuery: QueryPart<Record<string, KeyRow[]>> = {
    data: keys,
    error: query.error,
    isPending: query.isPending,
    isError: query.isError,
    isSuccess: query.isSuccess,
    refetch,
  };

  const delegationOn = agents.some((a) => supportsDelegation(a.agentAccount));
  const delegatesQuery = useDelegatesQuery({ enabled: delegationOn, pollMs: poll });
  const escrowQuery = useEscrowQuery();
  const policyQuery = useSpendPolicyQuery();
  const debtsQuery = useBuyerDebtsQuery();
  const debtOwed = splitDebts(debtsQuery.data).own.length > 0;

  const delegates: EscrowDelegate[] | undefined = delegatesQuery.data?.delegates;
  const { chains } = useChains();
  const freeOnlyChainName = React.useCallback(
    (account: string | null | undefined): string | null => {
      const chainId = chainIdOfAccount(account);
      return chainId && !servesPaidCalls(chainId) ? chainDisplayName(chains, chainId) : null;
    },
    [chains],
  );
  const readiness = React.useMemo(() => {
    const map: Record<string, AgentReadiness> = {};
    for (const agent of agents) {
      map[agent.agentId] = agentReadiness({
        agentAccount: agent.agentAccount,
        credentials: keys?.[agent.agentId],
        credentialsUnreadable: keysQuery.isError,
        delegates,
        delegatesUnreadable: delegatesQuery.isError,
        escrow: escrowQuery.data,
        escrowUnreadable: escrowQuery.isError,
        paused: policyQuery.data?.paused === true,
        freeOnlyChain: freeOnlyChainName(escrowQuery.data?.account ?? agent.agentAccount),
        debtOwed,
      });
    }
    return map;
  }, [agents, keys, keysQuery.isError, delegates, delegatesQuery.isError, escrowQuery.data, escrowQuery.isError, policyQuery.data, freeOnlyChainName, debtOwed]);

  return {
    agentsQuery,
    keysQuery,
    delegatesQuery,
    escrowQuery,
    policyQuery,
    agents,
    keys: keys ?? {},
    /** Each agent's key health (`GET /agents?include=health`), by agent id. */
    health,
    delegates,
    readiness,
    /** The escrow's chain name when it serves free calls only, else `null`. */
    freeOnlyChainName: freeOnlyChainName(escrowQuery.data?.account),
    refetchKeys: () => void refetch(),
    refetchDelegates: () => void delegatesQuery.refetch(),
  };
}
