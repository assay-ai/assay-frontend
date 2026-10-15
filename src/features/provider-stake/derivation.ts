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

const FORMULA = /floor\s+\$?([\d.,]+)\s*,\s*([\d,]+)\s*×\s*\$?([\d.,]+)\s*\)/;

function dollars(text: string, decimals = 2): string {
  const n = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(n)) return `$${text}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 4) })}`;
}

/**
 * Why one tool needs the stake it needs, as a sentence — never the wire's
 * `max(floor 50.000000, 1000 × 0.450000)` formula:
 *
 *   "price $0.45 × 1,000 calls"         when the price drives it
 *   "the $50.00 minimum for a paid tool" when the floor does
 *
 * An asset mismatch keeps `readableDerivation`'s plain sentence. Anything it
 * cannot read becomes a neutral line rather than the raw formula.
 */
export function stakeReason(derivation: string, chains: readonly Chain[]): string {
  if (MISMATCH.test(derivation)) return readableDerivation(derivation, chains);
  const match = FORMULA.exec(derivation);
  if (!match) return "the minimum for this tool";
  const floor = Number(match[1]!.replace(/,/g, ""));
  const calls = Number(match[2]!.replace(/,/g, ""));
  const price = Number(match[3]!.replace(/,/g, ""));
  if (calls * price >= floor) {
    return `price ${dollars(match[3]!)} × ${calls.toLocaleString("en-US")} calls`;
  }
  return `the ${dollars(match[1]!)} minimum for a paid tool`;
}
