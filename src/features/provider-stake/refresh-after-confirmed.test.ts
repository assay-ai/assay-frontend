import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { PROVIDER_BINDINGS_KEY, PROVIDER_REGISTRATION_KEY } from "@/features/provider-home/use-listing-progress";
import { caseKey } from "@/features/provider-penalties/use-penalties";

import { REFRESH_AFTER_CONFIRMED, type ProviderPendingKind } from "./pending-chain-tx";
import { PROVIDER_STAKE_KEY } from "./use-stake-status";

function refreshed(kind: ProviderPendingKind, keys: QueryKey[]): Map<string, boolean> {
  const queryClient = new QueryClient();
  for (const key of keys) queryClient.setQueryData(key, "data");
  for (const queryKey of REFRESH_AFTER_CONFIRMED[kind]) void queryClient.invalidateQueries({ queryKey });
  return new Map(keys.map((key) => [JSON.stringify(key), queryClient.getQueryState(key)?.isInvalidated === true]));
}

const STAKE_DERIVED: QueryKey[] = [
  PROVIDER_STAKE_KEY,
  ["provider", "stake-wallet-balances", "eip155:46630", "0xabc"],
  ["provider", "me"],
  PROVIDER_BINDINGS_KEY,
  ["provider", "tool-binding", "b-1"],
  ["provider", "tool-binding", "b-1", "publish-check"],
  ["chain-slashes", "eip155:46630", "0xstake", "0xabc"],
];
const UNMOVED: QueryKey[] = [
  PROVIDER_REGISTRATION_KEY,
  ["provider", "earnings", "tool", "2026-10-01", "2026-10-31"],
  ["provider", "payouts", "all"],
  ["provider", "verdicts", "b-1", "all", "all"],
  ["provider", "sla-windows", "open"],
  ["provider", "credentials", ["a-1"], 0, 0],
];

describe("REFRESH_AFTER_CONFIRMED", () => {
  it.each(["stake", "unstake", "withdraw"] as const)("%s: the stake and what derives from it, nothing else", (kind) => {
    const result = refreshed(kind, [...STAKE_DERIVED, ...UNMOVED]);
    for (const key of STAKE_DERIVED) expect(result.get(JSON.stringify(key)), JSON.stringify(key)).toBe(true);
    for (const key of UNMOVED) expect(result.get(JSON.stringify(key)), JSON.stringify(key)).toBe(false);
  });

  it("dispute: the penalty's case, the on-chain penalties, the stake and the slash hold", () => {
    const moved: QueryKey[] = [caseKey("p-1"), ["chain-slashes", "assay-match", "0xabc", ["r-1"]], PROVIDER_STAKE_KEY, ["provider", "me"]];
    const result = refreshed("dispute", [...moved, ...UNMOVED]);
    for (const key of moved) expect(result.get(JSON.stringify(key)), JSON.stringify(key)).toBe(true);
    for (const key of UNMOVED) expect(result.get(JSON.stringify(key)), JSON.stringify(key)).toBe(false);
  });
});
