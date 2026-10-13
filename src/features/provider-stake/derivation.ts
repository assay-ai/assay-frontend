import type { Chain } from "@/interfaces/chain";
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
