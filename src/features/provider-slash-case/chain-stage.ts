import type { SlashProposalClocks, SlashProposalSummary } from "@/interfaces/provider-disputes";
import { DISPUTE_TIMEOUT_SECONDS } from "@/libs/chains/evm/stake-slashes/abi";
import { caseChainDisputePhase } from "@/libs/chains/status-labels";

/**
 * Where a provider's case stands once the chain is involved, as the case
 * screen has to say it. Pure, so the screen and the tests read the same rules.
 *
 * The case's own clocks (`respondByAt`, `earliestExecutionAt`) are Assay's
 * promises; the on-chain record (`chainStatus`, `chainExecutableAt`,
 * `chainDisputedAt`, mirrored by the backend) is what actually decides when
 * stake can be taken. Once the provider disputed on chain, the off-chain
 * "respond by" and "what happens if you do nothing" no longer describe what
 * happens next, so the screen switches to this.
 */

export type CaseChainStage =
  /** Every live part is `Disputed` on chain: frozen until the arbiter rules or it expires. */
  | {
      readonly kind: "disputed";
      readonly disputedAt: string | null;
      /** `disputedAt` + 30 days: unruled, anyone can expire it from then. */
      readonly expiresAt: string | null;
    }
  /** `Pending` again after a dispute: the arbiter upheld it. It can only be executed now. */
  | { readonly kind: "upheld"; readonly disputedAt: string | null; readonly executableAt: string }
  /** Anything else: the off-chain clocks still describe the case. */
  | {
      readonly kind: "open";
      readonly executableAt: string;
      /** Parts disputed on chain while the case's other parts stay `Pending`; 0 when none. */
      readonly disputedParts: number;
    };

/**
 * The one execution date to plan against: the LATER of Assay's
 * `earliestExecutionAt` and the chain's own `chainExecutableAt`. Nothing is
 * taken before both have passed, so this can only overstate the wait.
 *
 * An absent or unparseable chain date loses the comparison. The winner is
 * returned as the original string, so an unparseable value still reaches
 * `stampUtc` and renders as a dash instead of throwing.
 */
export function executionFloorOf(clocks: SlashProposalClocks): string {
  const offChain = new Date(clocks.earliestExecutionAt).getTime();
  const onChain = clocks.chainExecutableAt
    ? new Date(clocks.chainExecutableAt).getTime()
    : Number.NEGATIVE_INFINITY;
  return onChain > offChain && clocks.chainExecutableAt
    ? clocks.chainExecutableAt
    : clocks.earliestExecutionAt;
}

function plusSeconds(iso: string, seconds: number): string | null {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? new Date(ms + seconds * 1000).toISOString() : null;
}

export function caseChainStageOf(clocks: SlashProposalClocks): CaseChainStage {
  const phase = caseChainDisputePhase(clocks);
  const disputedAt = clocks.chainDisputedAt ?? null;
  if (phase === "disputed") {
    return {
      kind: "disputed",
      disputedAt,
      expiresAt: disputedAt ? plusSeconds(disputedAt, DISPUTE_TIMEOUT_SECONDS) : null,
    };
  }
  if (phase === "upheld") {
    return { kind: "upheld", disputedAt, executableAt: executionFloorOf(clocks) };
  }
  return {
    kind: "open",
    executableAt: executionFloorOf(clocks),
    disputedParts: phase === "partly-disputed" ? (clocks.chainDisputedParts ?? 0) : 0,
  };
}

/**
 * Whether "Respond by" is still a deadline the provider is running against.
 * Not once the case is disputed (on chain or in the app) or decided: the
 * provider's response is in, or no longer matters.
 */
export function respondByApplies(proposal: SlashProposalSummary, stage: CaseChainStage): boolean {
  return stage.kind === "open" && proposal.status === "PROPOSED";
}

/**
 * Whether to offer "Acknowledge". It only records that the case was seen, so
 * it is not offered once the provider disputed on chain: they have plainly
 * seen the case, and the button would read like a step still to take.
 */
export function mayAcknowledge(proposal: SlashProposalSummary, stage: CaseChainStage): boolean {
  return proposal.clocks.acknowledgedAt === null && stage.kind === "open";
}
