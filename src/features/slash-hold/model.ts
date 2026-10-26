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

/**
 * What the banner knows beyond the hold. `penaltyPending: false` means the
 * provider's own penalty list was read and has no open penalty: then
 * `BONDED_BELOW_MINIMUM` is a stake below the minimum, said without
 * "pending penalties" (onboarding wave item 3). Left out, the words stay
 * the backend's, penalties included.
 */
export interface HoldContext {
  penaltyPending?: boolean;
  /** The minimum the stake has to reach, e.g. "$50.00". */
  minimum?: string | null;
}

/** The hold reasons that only a penalty can cause. */
const PENALTY_REASONS: ReadonlySet<string> = new Set(["SLASH_WINDOW_FULL", "STAKE_FULLY_RESERVED"]);

function reasonText(reason: string, context: HoldContext): string {
  if (reason === "BONDED_BELOW_MINIMUM" && context.penaltyPending === false) {
    return context.minimum ? `your stake is below the ${context.minimum} minimum` : "your stake is below the minimum";
  }
  return providerHoldReasonText(reason);
}

/** One sentence per held chain: where, since when, and why. */
export function holdSentence(hold: ProviderSlashHold, context: HoldContext = {}): string {
  const since = stampUtc(hold.heldSince);
  const reasons = joinReasons(hold.reasons.map((reason) => reasonText(reason, context)));
  const why = reasons ? `, because ${reasons}` : "";
  return `Paid calls are not being routed to you on ${holdChainName(hold.chainId)} since ${since} UTC${why}.`;
}

export const HOLD_WHAT_TO_DO =
  "Wait for the pending penalties to clear, add stake, or dispute any wrong penalty on";
/** What to do when no penalty is behind the hold: the stake is just short. */
export const HOLD_ADD_STAKE = "Add stake to bring it back to the minimum.";
export const HOLD_RESUMES = "Routing resumes automatically once the chain shows the condition has cleared.";

export interface SlashHoldBannerModel {
  readonly title: string;
  readonly lines: readonly string[];
  /** A penalty is (or may be) behind the hold: say what to do about penalties. */
  readonly penaltyRelated: boolean;
}

/** `null` when nothing is held (an empty or absent list). Oldest hold first. */
export function slashHoldBanner(
  holds: readonly ProviderSlashHold[] | null | undefined,
  context: HoldContext = {},
): SlashHoldBannerModel | null {
  if (!holds || holds.length === 0) return null;
  const sorted = [...holds].sort((a, b) => Date.parse(a.heldSince) - Date.parse(b.heldSince));
  const penaltyRelated =
    context.penaltyPending !== false || sorted.some((hold) => hold.reasons.some((reason) => PENALTY_REASONS.has(reason)));
  return {
    penaltyRelated,
    title:
      sorted.length === 1
        ? `Paid calls are paused on ${holdChainName(sorted[0].chainId)}`
        : `Paid calls are paused on ${sorted.length} chains`,
    lines: sorted.map((hold) => holdSentence(hold, context)),
  };
}
