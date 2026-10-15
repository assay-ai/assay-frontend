import type { Chain } from "@/interfaces/chain";
import type { BindingStatus } from "@/interfaces/provider-bindings";
import { assetName, chainDisplayName } from "@/services/chains.service";

const MISMATCH = /^priced in (\S+), stake floor in (\S+) .*STAKE_ASSET_MISMATCH/;

function assetLabel(asset: string, chains: readonly Chain[]): string {
  return `${assetName(chains, asset)} on ${chainDisplayName(chains, asset.split("/")[0])}`;
}

/**
 * The requirement line a provider reads. The API explains a binding priced in
 * another asset than the stake with raw asset ids and its internal reason
 * code; that one case is said in plain words here. Every other line is the
 * arithmetic, printed as sent.
 */
export function readableDerivation(derivation: string, chains: readonly Chain[]): string {
  const mismatch = MISMATCH.exec(derivation);
  if (!mismatch) return derivation;
  return `Priced in ${assetLabel(mismatch[1], chains)}, but stake is counted in ${assetLabel(
    mismatch[2],
    chains
  )}. This binding receives no paid traffic until both use the same asset.`;
}

/** Whether a requirement line is the asset-mismatch refusal: the binding takes no paid traffic. */
export function isAssetMismatch(derivation: string): boolean {
  return MISMATCH.test(derivation);
}

/**
 * The requirement column for a paid binding with no `requirement[]` entry.
 *
 * The API lists every ACTIVE paid binding — an asset mismatch included, with
 * its reason — so a missing ACTIVE row means the answer on screen is older than
 * the binding's state (a cached read from before it was resumed), not that it
 * is "not active" (BUG-R16-V3-01). Only a binding that really is not live
 * gets that reading, and in its own status's words.
 */
export function missingRequirementNote(status: BindingStatus): string {
  switch (status) {
    case "ACTIVE":
      return "active, but no requirement came back for it — reload to read it again";
    case "PAUSED":
      return "paused — no requirement is computed while it takes no traffic";
    case "SUSPENDED":
      return "suspended — no requirement is computed while it takes no traffic";
    default:
      return "draft — no requirement is computed until it is published";
  }
}
