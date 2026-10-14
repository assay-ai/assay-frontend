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
 * How a closed case ended, for the provider:
 *
 * - `executed` — the penalty was taken from stake (the record was executed);
 * - `compensated` — executed, then Assay deposited it back (`REVERSED`);
 * - `overturned` — Assay ruled for the provider, nothing taken;
 * - `waived` — below the de-minimis floor, never levied;
 * - `released` — the on-chain record was cancelled or expired, its
 *   reservation released, nothing taken;
 * - `cancelled` — closed without a penalty (suspended, or voided by the chain).
 */
export type ClosedOutcome = "executed" | "compensated" | "overturned" | "waived" | "released" | "cancelled";

/**
 * A case nothing more happens to: no deadline runs, nothing is executed, and
 * the provider has nothing to do.
 */
export interface ClosedStage {
  readonly kind: "closed";
  readonly outcome: ClosedOutcome;
  /** When the penalty was executed on chain, for `executed` and `compensated`. */
  readonly executedAt: string | null;
  /**
   * The decision is final but the on-chain record still stands (`PENDING`,
   * `DISPUTED` or `CANCEL_REQUESTED`): its cancellation has not landed yet.
   */
  readonly recordStanding: boolean;
}

export type CaseStage = CaseChainStage | ClosedStage;

/** The case statuses that are final: nothing moves a case out of them but a compensation. */
export const TERMINAL_CASE_STATUSES: readonly string[] = [
  "OVERTURNED",
  "EXECUTED",
  "REVERSED",
  "WAIVED",
  "CANCELLED",
];

const STANDING_CHAIN_STATUSES: readonly string[] = ["PENDING", "DISPUTED", "CANCEL_REQUESTED"];

/**
 * The case's stage: `closed` when the case status is final or the on-chain
 * record is closed (`EXECUTED`, or `CANCELLED` — cancelled by the arbiter or
 * expired), else the on-chain stage ({@link caseChainStageOf}).
 */
export function caseStageOf(proposal: SlashProposalSummary): CaseStage {
  const { status, clocks } = proposal;
  const chain = clocks.chainStatus;
  const terminal = TERMINAL_CASE_STATUSES.includes(status);
  if (!terminal && chain !== "EXECUTED" && chain !== "CANCELLED") return caseChainStageOf(clocks);

  const executed = status === "EXECUTED" || chain === "EXECUTED" || proposal.executedAt !== null;
  const outcome: ClosedOutcome =
    status === "REVERSED"
      ? "compensated"
      : executed
        ? "executed"
        : status === "WAIVED"
          ? "waived"
          : status === "OVERTURNED"
            ? "overturned"
            : chain === "CANCELLED"
              ? "released"
              : "cancelled";
  return {
    kind: "closed",
    outcome,
    executedAt: proposal.executedAt,
    recordStanding: chain !== undefined && STANDING_CHAIN_STATUSES.includes(chain),
  };
}

/**
 * Whether "Respond by" is still a deadline the provider is running against.
 * Not once the case is disputed (on chain or in the app) or decided: the
 * provider's response is in, or no longer matters.
 */
export function respondByApplies(proposal: SlashProposalSummary, stage: CaseStage): boolean {
  return stage.kind === "open" && proposal.status === "PROPOSED";
}

/**
 * Whether to offer "Acknowledge". It only records that the case was seen, so
 * it is not offered once the provider disputed on chain (they have plainly
 * seen the case) or once the case is closed: the button would read like a
 * step still to take.
 */
export function mayAcknowledge(proposal: SlashProposalSummary, stage: CaseStage): boolean {
  return proposal.clocks.acknowledgedAt === null && stage.kind === "open";
}

/** The one word for a closed case, as the header's figure shows it. */
export const CLOSED_HEADLINE: Readonly<Record<ClosedOutcome, string>> = {
  executed: "Executed",
  compensated: "Compensated",
  overturned: "Overturned",
  waived: "Waived",
  released: "Released",
  cancelled: "Closed",
};

/**
 * What happened, in a sentence, and that nothing more will. `when` formats a
 * timestamp (the screen's `stampUtc`), so this stays free of the screen's
 * formatting module.
 */
export function closedSentence(stage: ClosedStage, when: (iso: string) => string): string {
  const executedOn = stage.executedAt ? ` on ${when(stage.executedAt)} UTC` : "";
  const base: Record<ClosedOutcome, string> = {
    executed: `This case is closed. The penalty was executed on chain${executedOn} and taken from your stake.`,
    compensated: `This case is closed. The penalty was executed on chain${executedOn}, and Assay has since deposited it back into your stake.`,
    overturned: "This case is closed. Assay overturned the penalty in your favour, so nothing is taken from your stake.",
    waived: "This case is closed. The penalty was below the minimum Assay levies, so it was waived and nothing is taken.",
    released:
      "This case is closed. Its on-chain record was cancelled or expired, the reserved stake is released, and nothing is taken.",
    cancelled: "This case is closed without a penalty. Nothing is taken from your stake.",
  };
  const standing = stage.recordStanding
    ? " Its on-chain record still stands until its cancellation lands; the penalties on chain page shows it."
    : "";
  return `${base[stage.outcome]}${standing} There is no deadline and nothing for you to do.`;
}

/**
 * Whether the case's dispute is the on-chain one (EVM): the provider sends
 * `disputeSlash` from its own stake wallet and Assay's arbiter rules on chain.
 * There is no in-app objection, extension or platform deadline for it. An
 * older backend that does not say is read as on chain.
 */
export function disputesOnChain(clocks: SlashProposalClocks): boolean {
  return clocks.disputeOnChain !== false;
}

/** The one deadline to dispute on chain: the record's `executableAt`. Null when none stands. */
export function disputeDeadlineOf(clocks: SlashProposalClocks): string | null {
  return clocks.disputeBy ?? clocks.chainExecutableAt ?? null;
}

/**
 * Whether the provider can still dispute on chain: the case is `PROPOSED`, its
 * record stands `PENDING` and was never disputed, and its door has not opened.
 */
export function mayDisputeOnChain(proposal: SlashProposalSummary, stage: CaseStage, nowMs: number): boolean {
  if (!disputesOnChain(proposal.clocks) || stage.kind !== "open" || proposal.status !== "PROPOSED") return false;
  if (proposal.clocks.chainStatus !== "PENDING" || proposal.clocks.chainDisputedAt) return false;
  const by = disputeDeadlineOf(proposal.clocks);
  const byMs = by ? new Date(by).getTime() : Number.NaN;
  return Number.isFinite(byMs) && byMs > nowMs;
}

/** The penalties-on-chain page, with this case's records selected for the dispute. */
export function onChainDisputeHref(proposalId: string): string {
  return `/provider/capital/penalties?case=${encodeURIComponent(proposalId)}`;
}

/** The plain rule, said everywhere a provider can dispute. `when` formats a timestamp. */
export function onChainDisputeSentence(deadline: string | null, when: (iso: string) => string): string {
  return deadline
    ? `Disputing freezes the penalty on chain until the arbiter decides; you must dispute before ${when(deadline)} UTC.`
    : "Disputing freezes the penalty on chain until the arbiter decides; you can dispute once its record is on chain, and you must dispute before the time the record can execute.";
}
