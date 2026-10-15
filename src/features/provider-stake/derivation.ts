import type { Money } from "@/interfaces";
import type { Chain } from "@/interfaces/chain";
import type { BindingStatus } from "@/interfaces/provider-bindings";
import { assetName, chainDisplayName } from "@/services/chains.service";
import { formatMoney } from "@/utils/money";

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
      return "paused — needs stake again when it resumes";
    case "SUSPENDED":
      return "suspended — needs stake again when it resumes";
    default:
      return "draft — not live yet, needs stake when you publish it";
  }
}

/**
 * A tool's stake figure on the Stake page. A missing or zero `minimum` is "not
 * computed" (e.g. an asset mismatch, whose reason shows beside it), never
 * "$0.00", which would read as "needs no stake" (merge audit L3, the class of 80a0c15).
 */
export function requiredText(minimum: Money | null | undefined): string {
  return minimum && BigInt(minimum.amount || "0") > 0n ? formatMoney(minimum) : "—";
}
