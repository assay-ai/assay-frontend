import type { AgentHealth, AgentRow, AgentsWithKeysPage, KeyRow } from "@/components/buyer-money/use-agents";

/**
 * `GET /agents?include=credentials,health` for data the demo (and the tests)
 * already hold as agents plus a keys map: the health worked out from the keys
 * the way assay-backend `account/domain/agent-health.ts` does. The app never
 * computes health itself; it reads the API's.
 */

/** The key fields health reads; a fixture may leave any of them out. */
type HealthKey = Partial<Pick<KeyRow, "revokedAt" | "expiresAt" | "lastUsedAt" | "delegateAccount">>;

function usedAt(keys: readonly HealthKey[]): number[] {
  return keys.map((key) => (key.lastUsedAt ? Date.parse(key.lastUsedAt) : NaN)).filter((at) => Number.isFinite(at));
}

function latest(keys: readonly HealthKey[]): string | null {
  const times = usedAt(keys);
  return times.length === 0 ? null : new Date(Math.max(...times)).toISOString();
}

function earliest(keys: readonly HealthKey[]): string | null {
  const times = usedAt(keys);
  return times.length === 0 ? null : new Date(Math.min(...times)).toISOString();
}

export function demoAgentHealth(keys: readonly HealthKey[], nowMs: number = Date.now()): AgentHealth {
  const live = keys.filter((key) => !key.revokedAt && (!key.expiresAt || Date.parse(key.expiresAt) > nowMs));
  const unrevoked = keys.filter((key) => !key.revokedAt);
  const bound = live.filter((key) => key.delegateAccount);
  return {
    evaluatedAt: new Date(nowMs).toISOString(),
    liveKeyCount: live.length,
    unrevokedKeyCount: unrevoked.length,
    keyBound: bound.length > 0,
    boundKeyCount: bound.length,
    firstCallSeen: unrevoked.some((key) => Boolean(key.lastUsedAt)),
    lastUsedAt: latest(live),
    earliestLastUsedAt: earliest(unrevoked),
    lastUsedAtAnyKey: latest(keys),
  };
}

/** An agents page and a keys map as fixtures write them: loosely typed, like the wire. */
type AgentsLike = { readonly items: readonly object[]; readonly pageInfo?: unknown };
type KeysLike = Readonly<Record<string, readonly unknown[]>>;

/** The page `readAgentsWithKeys` reads, from an agents page and their keys (first 50 each, as the API nests them). */
export function demoAgentsWithKeys(
  page: AgentsLike,
  keys: KeysLike = {},
  nowMs: number = Date.now(),
): AgentsWithKeysPage & { pageInfo: { nextCursor: null; hasMore: false } } {
  return {
    items: (page.items as readonly AgentRow[]).map((agent) => {
      const all = (keys[agent.agentId] ?? []) as readonly HealthKey[];
      const items = all.slice(0, 50);
      return {
        ...agent,
        credentials: { items: items as KeyRow[], hasMore: all.length > 50 },
        health: demoAgentHealth(items, nowMs),
      };
    }),
    pageInfo: { nextCursor: null, hasMore: false },
  };
}

/** A `setQueryData` updater: the agents already seeded, now with these keys. */
export function withDemoKeys(keys: KeysLike) {
  return (page: AgentsLike | undefined) => demoAgentsWithKeys(page ?? { items: [] }, keys);
}
