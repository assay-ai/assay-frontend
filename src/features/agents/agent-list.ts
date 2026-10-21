"use client";

import { useQuery, type QueryFunctionContext } from "@tanstack/react-query";

import type { AgentsWithKeysPage } from "@/components/buyer-money/use-agents";
import type { CursorPage } from "@/interfaces";
import { ACCOUNT_BLOCKED_CODES, ApiError } from "@/libs/ApiClient";
import { listAgents, type Agent } from "@/services/account.service";

/**
 * The organisation's agents: one query key for the plain list (`GET /agents`)
 * and one for the list with every agent's keys and their health (`GET
 * /agents?include=credentials,health`, `AGENTS_WITH_KEYS_KEY` in
 * `use-agents.ts`). Both sit under `["agents"]`, which every agent or key
 * write invalidates.
 */
export const AGENTS_KEY = ["agents"] as const;

/** The first page of agents, as every screen reads it. */
const AGENTS_PAGE = 50;
export const AGENTS_WITH_KEYS_KEY = ["agents", "with-keys"] as const;

/**
 * Every agent with its keys and their health, in ONE request. It replaced one
 * `GET /agents/:id/credentials` per agent on every poll. The first 50 keys
 * per agent, as each of those reads asked for.
 *
 * The same URL on every read, polls included: the API answers it
 * `private, no-cache`, so an unchanged list costs a 304.
 */
export async function readAgentsWithKeys(): Promise<AgentsWithKeysPage> {
  let page: AgentsWithKeysPage;
  try {
    page = (await listAgents({ limit: AGENTS_PAGE, include: "credentials,health" })) as unknown as AgentsWithKeysPage;
  } catch (error) {
    if (!keysRefused(error)) throw error;
    return readAgentsWithoutKeys();
  }
  // A row without its keys would read as "No key": refuse it as a failed read instead.
  if ((page.items ?? []).some((agent) => !agent.credentials || !agent.health)) {
    throw new ApiError("AGENT_KEYS_MISSING", "The agents came back without their keys", 0);
  }
  return page;
}


/** The code `useAgentsAndKeys` reports when the keys were not shown to this session. */
export const AGENT_KEYS_HIDDEN = "AGENT_KEYS_HIDDEN";

/**
 * The include was refused (403), not the list: an agent-kind session may not
 * read the keys (`AUTH_HUMAN_SESSION_REQUIRED`), while the plain list is open
 * to it (BUG-DEMO-02). A blocked account's refusal is not this case.
 */
function keysRefused(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && !ACCOUNT_BLOCKED_CODES.has(error.code);
}

const NO_HEALTH = {
  evaluatedAt: "",
  liveKeyCount: 0,
  unrevokedKeyCount: 0,
  keyBound: false,
  boundKeyCount: 0,
  firstCallSeen: false,
  lastUsedAt: null,
  earliestLastUsedAt: null,
  lastUsedAtAnyKey: null,
};

/**
 * The plain list, marked `keysHidden`: the agents show, their keys and health
 * read as "not shown to this session" (`keysByAgent`/`healthByAgent` give
 * nothing for it), never as "no key". The empty `credentials` and `health`
 * only keep the row's shape.
 */
async function readAgentsWithoutKeys(): Promise<AgentsWithKeysPage> {
  const plain = await listAgents({ limit: AGENTS_PAGE });
  return {
    keysHidden: true,
    items: plain.items.map((agent) => ({
      ...(agent as unknown as AgentsWithKeysPage["items"][number]),
      credentials: { items: [], hasMore: false },
      health: NO_HEALTH,
    })),
  };
}

/**
 * The plain list, unless the screen is reading the richer one anyway: then it
 * is that answer without the keys, so a screen with both (Overview: the agent
 * rows and the bell's limit context) asks once. Joining it reads with the
 * same function as the screen that asked for it; if that read fails, the
 * plain list is read on its own.
 */
async function readAgentList(context: QueryFunctionContext): Promise<CursorPage<Agent>> {
  const rich = context.client.getQueryCache().find({ queryKey: AGENTS_WITH_KEYS_KEY, exact: true });
  if (rich) {
    try {
      const page = (await context.client.fetchQuery({ queryKey: AGENTS_WITH_KEYS_KEY, queryFn: readAgentsWithKeys })) as unknown as CursorPage<Agent>;
      return {
        ...page,
        items: page.items.map(({ credentials: _credentials, health: _health, ...agent }) => agent as Agent),
      };
    } catch {
      // The richer read failed (its keys missing, say): the plain list does not depend on them.
    }
  }
  return listAgents({ limit: AGENTS_PAGE });
}

/** `GET /agents` (first page), shared by the bell, Explore, the entity names and the setup screens. */
export function useAgentList(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: AGENTS_KEY,
    queryFn: readAgentList,
    enabled: options.enabled ?? true,
    retry: false,
  });
}
