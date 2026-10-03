import type { PolicyChange } from "@/interfaces/provider-policy-changes";

import { api } from "./api";

/**
 * `GET /providers/me/policy-changes` (the policy change notice,
 * MVP slice only).
 *
 * Not paginated — the response is bounded by how many distinct tools this
 * provider has bound. Returns `[]` when no tool this provider is bound to has
 * a pending `SHADOW` version; that is the honest common case against seed
 * data, not a loading placeholder.
 */
export function listPolicyChanges(): Promise<PolicyChange[]> {
  return api.get<PolicyChange[]>("/providers/me/policy-changes");
}
