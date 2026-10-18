import { useQuery } from "@tanstack/react-query";

import { getProviderTool, getProviderToolGate } from "@/services/provider-tools.service";

/** Query keys of "Publish your own API": invalidating `all` refreshes the list, a tool and its gate. */
export const providerToolKeys = {
  all: ["provider", "own-tools"] as const,
  list: ["provider", "own-tools", "list"] as const,
  invitations: ["provider", "own-tools", "invitations"] as const,
  one: (id: string) => ["provider", "own-tools", "tool", id] as const,
  gate: (id: string) => ["provider", "own-tools", "tool", id, "gate"] as const,
};

export function useProviderTool(id: string | null) {
  return useQuery({ queryKey: providerToolKeys.one(id ?? ""), queryFn: () => getProviderTool(id!), enabled: Boolean(id), retry: 0 });
}

/** The publish gate is read only once a version exists: before that it can only say "publish a version". */
export function useProviderToolGate(id: string | null, enabled = true) {
  return useQuery({ queryKey: providerToolKeys.gate(id ?? ""), queryFn: () => getProviderToolGate(id!), enabled: Boolean(id) && enabled, retry: 0 });
}
