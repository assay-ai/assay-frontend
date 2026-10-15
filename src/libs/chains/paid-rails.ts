import { ApiError } from "@/libs/ApiClient";

import { namespaceOf } from "./registry";

/**
 * Whether this deployment serves PAID calls on a chain, keyed on the namespace
 * like everything in `registry.ts`.
 *
 * The backend lists the paid rails per chain in `chain-metadata.ts`
 * (`ChainMetadata.rails`), and Solana lists none today: rail B is off until the
 * Anchor program delays a buyer's tightening, and rail A is off for as long as
 * rail B is (review 2026-10-15, C1). Every paid call on Solana is refused with
 * `409 CHAIN_RAIL_NOT_OFFERED`; free calls still work.
 *
 * `GET /chains` does not serve the rails, so this is a mirror of that one
 * fact. When the chains DTO carries `rails`, read it here instead and keep
 * the callers as they are.
 */
const FREE_ONLY_NAMESPACES: ReadonlySet<string> = new Set(["solana"]);

export function servesPaidCalls(chainId: string): boolean {
  return !FREE_ONLY_NAMESPACES.has(namespaceOf(chainId));
}

/** The one sentence every screen says about a free-calls-only chain. */
export function freeCallsOnlyText(chainName: string): string {
  return (
    `${chainName} currently serves free calls only. Paid calls are not offered on it, so ` +
    `money in escrow there is not spent on calls.`
  );
}

/** The backend's refusal of a paid call (or a paid rail) on a chain that does not offer it. */
export const CHAIN_RAIL_NOT_OFFERED = "CHAIN_RAIL_NOT_OFFERED";

export function isRailNotOffered(error: unknown): boolean {
  return error instanceof ApiError && error.code === CHAIN_RAIL_NOT_OFFERED;
}

/**
 * The 409 in plain words. The backend's message names the chain by its CAIP-2
 * id; a person reads the chain's name instead, when the caller has one.
 */
export function railNotOfferedText(chainName: string | null): string {
  const chain = chainName ?? "This chain";
  return (
    `${chain} currently serves free calls only, so this paid action is not available on it. ` +
    `Nothing was charged. Use a chain that serves paid calls, or call a free tool.`
  );
}
