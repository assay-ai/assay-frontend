import type { Chain } from "@/interfaces/chain";
import { findChain } from "@/services/chains.service";
import { chainIdOfAccount } from "@/utils/chain";

/**
 * The asset and scale the FIRST spend-policy version is written in.
 *
 * `PATCH /spend-policy` inherits `assetId`/`decimals` from the row it replaces
 * or from the organization default; when neither exists it answers
 * `SPEND_POLICY_ASSET_REQUIRED` and the caller must name them. So the create
 * path on /limits sends them — taken from `GET /chains`, keyed on the agent's
 * own chain, never a literal and never `chains[0]` (which is Solana on a
 * two-chain deployment and the wrong asset for an eip155 buyer).
 *
 * The write targets the session's own agent. There is no endpoint naming that
 * agent, so this reads the organization's agents and answers only when they
 * all sit on one chain; on two it says it cannot tell rather than pick.
 */
export type PolicyBootstrapAsset =
  | { readonly kind: "reading" }
  | { readonly kind: "unknown"; readonly reason: string }
  | {
      readonly kind: "ready";
      readonly assetId: string;
      readonly decimals: number;
      readonly symbol: string;
      readonly chainName: string;
    };

export interface BootstrapAgent {
  readonly agentId: string;
  readonly chainId?: unknown;
  readonly agentAccount?: string;
}

export function policyBootstrapAsset(
  agents: readonly BootstrapAgent[] | undefined,
  chains: readonly Chain[],
): PolicyBootstrapAsset {
  if (agents === undefined || chains.length === 0) return { kind: "reading" };

  const chainIds = [
    ...new Set(
      agents
        .map((agent) =>
          typeof agent.chainId === "string" && agent.chainId
            ? agent.chainId
            : chainIdOfAccount(agent.agentAccount),
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (chainIds.length === 0) {
    return { kind: "unknown", reason: "no agent on this account names a chain yet" };
  }
  if (chainIds.length > 1) {
    return {
      kind: "unknown",
      reason: "this account's agents are on more than one chain, so the policy's asset cannot be chosen here",
    };
  }

  const chain = findChain(chains, chainIds[0]);
  if (!chain) {
    return { kind: "unknown", reason: `${chainIds[0]} is not a chain this deployment offers` };
  }
  return {
    kind: "ready",
    assetId: chain.settlementAsset,
    decimals: chain.decimals,
    symbol: chain.settlementAssetSymbol,
    chainName: chain.displayName,
  };
}
