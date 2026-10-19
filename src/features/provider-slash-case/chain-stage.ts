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

/** The chain's own `executableAt` when it is known and readable, else `null`. */
export function chainExecutableOf(clocks: SlashProposalClocks): string | null {
  const at = clocks.chainExecutableAt;
  return at && Number.isFinite(new Date(at).getTime()) ? at : null;
}

/**
 * The one execution date to plan against, the same rule the operator case
 * screen (`case-flow.ts`) and the backend's listing use:
 * `chainExecutableAt ?? earliestExecutionAt`.
 *
 * Once the record is on chain, `X402Stake.executeSlash` is open to ANY caller
 * from the record's `executableAt`; Assay's own later floor
 * (`earliestExecutionAt`) only binds Assay's executor, not anyone else. So the
 * chain date wins even when it is earlier, and a provider is never told they
 * have more time than the chain gives. Assay's floor applies only while the
 * record is not on chain (no chain date, or an unreadable one).
 */
export function executionFloorOf(clocks: SlashProposalClocks): string {
  return chainExecutableOf(clocks) ?? clocks.earliestExecutionAt;
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
  /**
   * Review R2-3: an `executed` case whose other on-chain records were
   * cancelled or expired in the provider's favour (`chainState`
   * `PARTIALLY_EXECUTED`): how many, of how many. `null` otherwise.
   */
  readonly partly: { readonly cancelledRecords: number; readonly records: number } | null;
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
  const partly =
    outcome === "executed" && clocks.chainState === "PARTIALLY_EXECUTED"
      ? { cancelledRecords: clocks.cancelledRecords ?? 0, records: clocks.chainRecords ?? 0 }
      : null;
  return {
    kind: "closed",
    outcome,
    executedAt: proposal.executedAt,
    recordStanding: chain !== undefined && STANDING_CHAIN_STATUSES.includes(chain),
    partly,
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
 * Whether a record of the case can still be disputed on chain at `nowMs`.
 * Per record (review N-4): the backend's `disputeBy` is the earliest door of a
 * record still Pending and never disputed, so a sibling's dispute or a case
 * that moved on does not close it. An older backend that sends no `disputeBy`
 * keeps the case-level rule: `PROPOSED`, record `PENDING`, never disputed.
 */
export function disputeWindowOpen(proposal: SlashProposalSummary, nowMs: number): boolean {
  const { clocks } = proposal;
  if (!disputesOnChain(clocks)) return false;
  if (clocks.disputeBy !== undefined) {
    const byMs = clocks.disputeBy ? new Date(clocks.disputeBy).getTime() : Number.NaN;
    return Number.isFinite(byMs) && byMs > nowMs;
  }
  if (proposal.status !== "PROPOSED") return false;
  if (clocks.chainStatus !== "PENDING" || clocks.chainDisputedAt) return false;
  const by = disputeDeadlineOf(clocks);
  const byMs = by ? new Date(by).getTime() : Number.NaN;
  return Number.isFinite(byMs) && byMs > nowMs;
}

/** Whether to offer the on-chain dispute: the case is still open on chain and a record can be disputed. */
export function mayDisputeOnChain(proposal: SlashProposalSummary, stage: CaseStage, nowMs: number): boolean {
  return stage.kind === "open" && disputeWindowOpen(proposal, nowMs);
}

/** The plain rule, said everywhere a provider can dispute. `when` formats a timestamp. */
export function onChainDisputeSentence(deadline: string | null, when: (iso: string) => string): string {
  return deadline
    ? `Disputing freezes the penalty on chain until the arbiter decides; you must dispute before ${when(deadline)} UTC.`
    : "Disputing freezes the penalty on chain until the arbiter decides; you can dispute once its record is on chain, and you must dispute before the time the record can execute.";
}
