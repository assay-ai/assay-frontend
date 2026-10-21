import { stampUtc } from "@/features/g34a/stats";
import type { ProviderSlashHold } from "@/interfaces/provider";
import { stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";
import { joinReasons, providerHoldReasonText } from "@/libs/slash-hold";
import { chainLabel } from "@/utils/chain";

/**
 * The provider's slash-hold banner, as data (`GET /providers/me` →
 * `slashHolds`). Pure, so the words are tested without React.
 */

/** A chain's display name when this build pins it, else its short CAIP-2 label. */
export function holdChainName(chainId: string): string {
  return stakeDeploymentFor(chainId)?.displayName ?? chainLabel(chainId);
}

/** One sentence per held chain: where, since when, and why. */
export function holdSentence(hold: ProviderSlashHold): string {
  const since = stampUtc(hold.heldSince);
  const reasons = joinReasons(hold.reasons.map(providerHoldReasonText));
  const why = reasons ? `, because ${reasons}` : "";
  return `Paid calls are not being routed to you on ${holdChainName(hold.chainId)} since ${since} UTC${why}.`;
}

export const HOLD_WHAT_TO_DO =
  "Wait for the pending penalties to clear, add stake, or dispute any wrong penalty on";
export const HOLD_RESUMES = "Routing resumes automatically once the chain shows the condition has cleared.";

export interface SlashHoldBannerModel {
  readonly title: string;
  readonly lines: readonly string[];
}

/** `null` when nothing is held (an empty or absent list). Oldest hold first. */
export function slashHoldBanner(holds: readonly ProviderSlashHold[] | null | undefined): SlashHoldBannerModel | null {
  if (!holds || holds.length === 0) return null;
  const sorted = [...holds].sort((a, b) => Date.parse(a.heldSince) - Date.parse(b.heldSince));
  return {
    title:
      sorted.length === 1
        ? `Paid calls are paused on ${holdChainName(sorted[0].chainId)}`
        : `Paid calls are paused on ${sorted.length} chains`,
    lines: sorted.map(holdSentence),
  };
}
