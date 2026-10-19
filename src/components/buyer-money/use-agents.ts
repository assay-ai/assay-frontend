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
import { listAgents, listCredentials } from "@/services/account.service";
import { chainDisplayName } from "@/services/chains.service";
import { listDelegates } from "@/services/delegation.service";
import { getSpendPolicyTyped, type SpendPolicy } from "@/services/limits.service";
import { chainIdOfAccount } from "@/utils/chain";

import { useEscrowQuery } from "./use-buyer-money";

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
 * The browser caches GETs for 10 s (`Cache-Control: max-age=10`), so a poll
 * that reuses the URL sees nothing new. Each read gets its own `from` (an
 * instant in 1970, which filters nothing out) to reach the server. See the
 * same trick in the old agents screen.
 */
let bust = 0;
function nextBust(): string {
  bust += 1;
  return new Date(bust).toISOString();
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
  const agentsQuery = useQuery({
    queryKey: ["agents"],
    retry: false,
    queryFn: () => listAgents({ limit: 50 }) as unknown as Promise<{ items: AgentRow[] }>,
  });
  const agents = React.useMemo(() => agentsQuery.data?.items ?? [], [agentsQuery.data]);
  const agentIds = React.useMemo(() => agents.map((a) => a.agentId), [agents]);

  const keysQuery = useQuery({
    queryKey: ["agent-keys", agentIds],
    enabled: agentIds.length > 0,
    retry: 0,
    refetchInterval: poll,
    queryFn: async () => {
      const lists = await Promise.all(
        agentIds.map((id) => listCredentials(id, { limit: 50, from: nextBust() } as never) as Promise<{ items: KeyRow[] }>),
      );
      return Object.fromEntries(agentIds.map((id, i) => [id, lists[i]!.items])) as Record<string, KeyRow[]>;
    },
  });

  const delegationOn = agents.some((a) => supportsDelegation(a.agentAccount));
  const delegatesQuery = useQuery({
    queryKey: ["escrow-delegates", "live"],
    enabled: delegationOn,
    retry: 0,
    refetchInterval: poll,
    queryFn: () => listDelegates(Date.now()),
  });
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
        credentials: keysQuery.data?.[agent.agentId],
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
  }, [agents, keysQuery.data, keysQuery.isError, delegates, delegatesQuery.isError, escrowQuery.data, escrowQuery.isError, policyQuery.data, freeOnlyChainName, debtOwed]);

  return {
    agentsQuery,
    keysQuery,
    delegatesQuery,
    escrowQuery,
    policyQuery,
    agents,
    keys: keysQuery.data ?? {},
    delegates,
    readiness,
    /** The escrow's chain name when it serves free calls only, else `null`. */
    freeOnlyChainName: freeOnlyChainName(escrowQuery.data?.account),
    refetchKeys: () => void keysQuery.refetch(),
    refetchDelegates: () => void delegatesQuery.refetch(),
  };
}
