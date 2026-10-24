import type { StatusTimelineStep } from "@/components/patterns/status-timeline";
import { caseChainStageOf } from "@/features/provider-slash-case/chain-stage";
import type { Money } from "@/interfaces/api";
import type { OperatorCaseBrief, OperatorIdentity, SlashProposalStatus } from "@/interfaces/operator";
import { formatMoney } from "@/utils/money";
import { DISPUTE_TIMEOUT_SECONDS } from "@/libs/chains/evm/stake-slashes/abi";

import { DISPUTE_RED_FROM_DAY, disputeUrgency } from "./inbox";
import { capabilitiesFor, checkAction, rolesPhrase, type ConsoleAction } from "./roles";
import { asProposalStatus, isLegalInStatus, may } from "./state";
import { askLabel } from "./why-not";

/**
 * The penalty's on-chain process, as the case screen draws it:
 *
 *   Proposed → dispute window (72 h) → [Disputed → Arbiter rules, 30 days] → Executed | Cancelled
 *
 * and the single next step THIS operator can take on it. Pure, so the rules
 * are tested without the screen.
 */

export type CaseStage =
  | "not-on-chain"
  | "window-open"
  | "executable"
  | "disputed"
  | "upheld"
  | "cancel-requested"
  | "executed"
  | "compensated"
  | "cancelled";

const CLOSED_CANCELLED: readonly SlashProposalStatus[] = ["OVERTURNED", "WAIVED", "CANCELLED"];

export interface CaseFacts {
  stage: CaseStage;
  status: SlashProposalStatus | null;
  /** When the penalty becomes executable on chain (anyone can execute it from then). */
  executableAt: string | null;
  disputedAt: string | null;
  /** disputedAt + 30 days: unruled by then, it can be expired and the stake is released. */
  disputeExpiresAt: string | null;
  /** Cancelled because the dispute went unruled for 30 days and lapsed (`AUTO_CHAIN_VOIDED` after a dispute). */
  expired: boolean;
  /**
   * While a cancel waits for the arbiter (`cancel-requested`): the instant it
   * must be signed by, and what happens if nobody signs. A record still
   * `Disputed` on chain can never be executed — its one deadline is the
   * dispute's 30-day timeout (the same instant the Arbiter page counts down),
   * after which anyone can expire it and the stake is released. A `Pending`
   * record becomes executable by anyone at `executableAt`. `null` otherwise.
   */
  cancel: { deadline: string | null; ifUnsigned: "expires" | "executes" } | null;
  /**
   * The backend read that nothing of the case is Pending or Disputed on chain
   * (`chainRecord: GONE`): nobody can execute it and a cancel has nothing
   * to act on.
   */
  nothingOnChain: boolean;
  /**
   * The backend could not confirm what stands on chain (`chainRecord:
   * UNKNOWN`: the live read failed, or found no record where one was
   * written). Nothing may then say "anyone can execute": that is said only
   * when the record STANDS (V1-15).
   */
  chainUnconfirmed: boolean;
  /**
   * The record (or a part) was executed on chain while this platform's cancel
   * waited (`chainRecord: EXECUTED` under a `CANCEL_REQUESTED` mirror): the
   * stake was taken. Never read as "nothing was taken".
   */
  executedWhileCancelWaited: boolean;
  /**
   * The chain side still reads "cancel requested" though nothing stands.
   * There is nothing to sign; when the brief's read allows it, the B18
   * actions below close it or propose it again. False otherwise.
   */
  closeOutstanding: boolean;
  /**
   * B18: which stuck-cancel action the brief's live chain read allows
   * (`manualActions`). The backend reads the chain again before it acts and
   * refuses if the guard no longer holds. All false when the brief offers none.
   */
  manual: { close: boolean; record: boolean; repropose: boolean; appliedMinor: string | null };
  /**
   * Not on chain yet, and its computed dates have passed: "Not on chain after
   * 5 days", counted from the proposal. Null otherwise.
   */
  notOnChainForDays: number | null;
  /**
   * Not on chain yet and the last attempt to put it there failed: the reason in
   * plain words (`chainLastError`, BUG-OPS-CASES-02). Null otherwise, and on an
   * older backend that does not send it.
   */
  chainFailure: string | null;
}

/**
 * The plain reason behind a stored `chain_last_error`, for the operator. A
 * code this file does not know is named as it is, so it can still be looked up.
 */
export function chainErrorText(code: string): string {
  switch (code) {
    case "transport":
      return "Assay could not reach the chain, or the chain gave no usable answer.";
    case "PROVIDER_STAKE_AUTHORITY_UNPROVEN":
      return "The provider has no proved stake wallet on this chain, so no transaction can be built that names its stake.";
    case "SLASH_NO_HARMED_AGENTS":
      return "No harmed agent could be named for this penalty, so there is nobody to pay it to.";
    case "SLASH_BENEFICIARY_EVIDENCE_REFUSED":
      return "The evidence for who is paid was refused.";
    case "SLASH_PLAN_EVIDENCE_MISMATCH":
      return "The penalty's plan does not match its evidence.";
    default:
      // A local SLASH_* / PROVIDER_* refusal never reached the chain (fe-followup M6); a
      // contract's custom error is CamelCase (`ProposalAlreadyExists`); anything else is not blamed on either.
      if (/^(SLASH|PROVIDER)_/.test(code)) return `Assay did not send it (${code}).`;
      if (/^[A-Z][a-z]+[A-Za-z0-9]*$/.test(code)) return `The chain refused it (${code}).`;
      return `The last attempt failed (${code}).`;
  }
}

function plusSeconds(iso: string | null, seconds: number): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms + seconds * 1000).toISOString();
}

export function caseFacts(brief: OperatorCaseBrief, now: number = Date.now()): CaseFacts {
  const proposal = brief.case.proposal;
  const status = asProposalStatus(proposal.status);
  const clocks = {
    ...proposal.clocks,
    chainStatus: brief.chainStatus,
    chainExecutableAt: brief.chainExecutableAt,
    chainDisputedParts: brief.chainDisputedParts,
  };
  const chain = clocks.chainStatus;
  const chainStage = caseChainStageOf(clocks);
  const disputedAt = clocks.chainDisputedAt;
  const executableAt = clocks.chainExecutableAt ?? clocks.earliestExecutionAt;

  // Only GONE means nothing stands and nothing was taken. EXECUTED is money moved; UNKNOWN reads as standing.
  const record = brief.chainRecord;
  const nothingOnChain = record === "GONE";
  const executedWhileCancelWaited = record === "EXECUTED" && chain === "CANCEL_REQUESTED";

  let stage: CaseStage;
  // Executed on chain, then paid back by the treasury: the chain still reads EXECUTED.
  if (status === "REVERSED") stage = "compensated";
  else if (chain === "EXECUTED" || status === "EXECUTED" || status === "EXECUTING") stage = "executed";
  // A closed case whose cancel has nothing on chain to act on is simply cancelled: no signature step.
  else if (chain === "CANCEL_REQUESTED" && nothingOnChain && status !== null && CLOSED_CANCELLED.includes(status)) stage = "cancelled";
  else if (chain === "CANCEL_REQUESTED") stage = "cancel-requested";
  else if (chain === "CANCELLED" || (status !== null && CLOSED_CANCELLED.includes(status))) stage = "cancelled";
  else if (chainStage.kind === "disputed" || (chainStage.kind === "open" && chainStage.disputedParts > 0)) stage = "disputed";
  else if (chainStage.kind === "upheld") stage = "upheld";
  else if (chain === "PENDING") {
    const at = executableAt ? Date.parse(executableAt) : Number.NaN;
    stage = !Number.isNaN(at) && at <= now ? "executable" : "window-open";
  } else stage = "not-on-chain";

  const disputeExpiresAt = plusSeconds(disputedAt, DISPUTE_TIMEOUT_SECONDS);
  // The record under the cancel is still disputed when the chain still counts disputed parts.
  const recordDisputed = disputedAt !== null && clocks.chainDisputedParts > 0;
  const cancel =
    stage !== "cancel-requested"
      ? null
      : recordDisputed
        ? { deadline: disputeExpiresAt, ifUnsigned: "expires" as const }
        : { deadline: executableAt, ifUnsigned: "executes" as const };

  const expired = stage === "cancelled" && disputedAt !== null && proposal.resolutionKind === "AUTO_CHAIN_VOIDED";

  const computedAt = executableAt ? Date.parse(executableAt) : Number.NaN;
  const proposedAt = proposal.clocks.proposedAt ? Date.parse(proposal.clocks.proposedAt) : Number.NaN;
  const notOnChainForDays =
    stage === "not-on-chain" && !Number.isNaN(computedAt) && computedAt <= now && !Number.isNaN(proposedAt)
      ? Math.max(1, Math.floor((now - proposedAt) / 86_400_000))
      : null;

  return {
    stage,
    status,
    executableAt,
    disputedAt,
    disputeExpiresAt,
    expired,
    cancel,
    nothingOnChain,
    chainUnconfirmed: record === "UNKNOWN",
    executedWhileCancelWaited,
    closeOutstanding: nothingOnChain && chain === "CANCEL_REQUESTED",
    manual: {
      close: brief.manualActions?.closeNothingStanding.allowed === true,
      record: brief.manualActions?.recordExecution.allowed === true,
      repropose: brief.manualActions?.repropose.allowed === true,
      appliedMinor: brief.manualActions?.recordExecution.appliedMinor ?? null,
    },
    notOnChainForDays,
    chainFailure: stage === "not-on-chain" && brief.chainLastError ? chainErrorText(brief.chainLastError) : null,
  };
}

/** The dispute window's length in hours, from the chain's slash delay when known. */
export function windowHours(slashDelaySeconds: number | null | undefined): number | null {
  if (!slashDelaySeconds || slashDelaySeconds <= 0) return null;
  return Math.round(slashDelaySeconds / 3600);
}

/** The status timeline's steps. */
export function caseTimelineSteps(
  brief: OperatorCaseBrief,
  facts: CaseFacts,
  options: { slashDelaySeconds?: number | null; now?: number } = {},
): StatusTimelineStep[] {
  const now = options.now ?? Date.now();
  const proposal = brief.case.proposal;
  const hours = windowHours(options.slashDelaySeconds);
  const windowLabel = hours ? `${hours} h dispute window` : "Dispute window";
  const { stage } = facts;
  const wasDisputed = facts.disputedAt !== null || stage === "disputed";
  const closed = stage === "executed" || stage === "cancelled" || stage === "compensated";
  // A penalty cancelled inside its window ends there: the window step stops at the cancel, not at a later date.
  const before = (a: string | null | undefined, b: string | null | undefined) =>
    Boolean(a && b) && Date.parse(a!) < Date.parse(b!);
  const cutShort = !wasDisputed && stage === "cancelled" && before(proposal.resolvedAt, facts.executableAt);

  const steps: StatusTimelineStep[] = [
    { id: "proposed", label: "Proposed", state: "done", date: proposal.clocks.proposedAt },
  ];

  /*
    A step is never done in the future. A cancel waiting for the arbiter's
    signature on an undisputed record leaves the window running: it ends at
    the very instant the cancel must be signed by (after it anyone can
    execute), so the window points at that deadline instead of repeating it,
    and the signature step below carries the date and the countdown.
  */
  const executableMs = facts.executableAt ? Date.parse(facts.executableAt) : Number.NaN;
  const windowRunsToSignDeadline =
    stage === "cancel-requested" && !wasDisputed && !Number.isNaN(executableMs) && executableMs > now;

  // The window: open until the record is executable, unless a dispute froze it first.
  steps.push(
    windowRunsToSignDeadline
      ? { id: "window", label: windowLabel, state: "current", dateLabel: "open until the signing deadline" }
      : {
          id: "window",
          label: windowLabel,
          state: stage === "window-open" ? "current" : stage === "not-on-chain" ? "upcoming" : "done",
          // Not on chain past its computed dates: no date that is already gone (operator review E).
          date: facts.notOnChainForDays !== null ? null : wasDisputed ? facts.disputedAt : cutShort ? proposal.resolvedAt : facts.executableAt,
          dateLabel:
            stage === "not-on-chain"
              ? facts.notOnChainForDays !== null
                ? `not on chain after ${daysText(facts.notOnChainForDays)}`
                : "starts once it is on chain"
              : wasDisputed
                ? "provider disputed"
                : cutShort
                  ? "ended early by the cancel"
                  : undefined,
          countdown: stage === "window-open",
          description: stage === "window-open" ? "The provider can dispute on chain until then." : undefined,
        },
  );

  const day = facts.disputedAt ? Math.floor((now - Date.parse(facts.disputedAt)) / 86_400_000) : null;
  if (wasDisputed) {
    const ruled = stage === "upheld" || closed || stage === "cancel-requested";
    // When it was ruled: the uphold on record, the cancel that closed it, or the 30 days running out.
    const upheldAt = brief.timeline.find((event) => event.kind === "CHAIN_UPHELD")?.occurredAt ?? null;
    const ruledAt = facts.expired ? facts.disputeExpiresAt : stage === "cancelled" ? proposal.resolvedAt : upheldAt;
    steps.push({
      id: "ruling",
      label: stage === "upheld" ? "Arbiter upheld it" : facts.expired ? "Not ruled in 30 days" : "Arbiter rules",
      state: ruled ? (facts.expired ? "skipped" : "done") : "current",
      date: ruled ? ruledAt : facts.disputeExpiresAt,
      // "7 days left · rule by Oct 23": the same days-left as the Deadline elsewhere, not a second countdown.
      dateLabel: ruled
        ? facts.expired
          ? "lapsed"
          : undefined
        : `${disputeUrgency({ disputedAt: facts.disputedAt, expiresAt: facts.disputeExpiresAt }, now).label} · rule by`,
      countdown: false,
      urgent: !ruled && day !== null && day >= DISPUTE_RED_FROM_DAY,
      description: ruled ? undefined : "If nobody rules by then, the penalty lapses.",
    });
  } else {
    steps.push({
      id: "ruling",
      label: "Disputed → arbiter rules",
      state: stage === "window-open" || stage === "not-on-chain" ? "upcoming" : "skipped",
      dateLabel: stage === "window-open" || stage === "not-on-chain" ? "only if the provider disputes" : "not disputed",
    });
  }

  if (stage === "executed") {
    steps.push({ id: "end", label: "Executed", state: "done", date: proposal.executedAt ?? proposal.resolvedAt });
  } else if (stage === "compensated") {
    steps.push({ id: "end", label: "Executed, then compensated", state: "done", date: proposal.resolvedAt });
  } else if (stage === "cancelled") {
    steps.push({ id: "end", label: facts.expired ? "Expired" : "Cancelled", state: "done", date: proposal.resolvedAt });
  } else if (stage === "cancel-requested" && facts.executedWhileCancelWaited) {
    steps.push({
      id: "end",
      label: "Executed on chain while the cancel waited",
      state: "current",
      urgent: true,
      description: "The stake was taken. Nothing can be cancelled any more.",
    });
  } else if (stage === "cancel-requested" && facts.nothingOnChain) {
    steps.push({
      id: "end",
      label: "Nothing on chain to cancel",
      state: "done",
      description: "Nothing is on chain: nothing can be executed, and there is nothing to sign.",
    });
  } else if (stage === "cancel-requested") {
    const disputedRecord = facts.cancel?.ifUnsigned === "expires";
    steps.push({
      id: "end",
      label: "Cancel waits for the arbiter's signature",
      state: "current",
      date: facts.cancel?.deadline ?? null,
      // A disputed record reads the same "Day N of 30" as the Arbiter page; it cannot be executed meanwhile.
      dateLabel: disputedRecord
        ? `${disputeUrgency({ disputedAt: facts.disputedAt, expiresAt: facts.disputeExpiresAt }, now).label} · sign by`
        : "sign by",
      countdown: !disputedRecord,
      urgent: !disputedRecord,
      description: disputedRecord
        ? "Still disputed on chain, so it cannot be executed. Unsigned by then, anyone can expire it and the stake is released."
        : undefined,
    });
  } else {
    steps.push({
      id: "end",
      label: "Executed or cancelled",
      state: stage === "executable" ? "current" : "upcoming",
      // While disputed, the old executable time no longer applies: it moves with the ruling.
      // Not on chain past its computed date: that date is gone and means nothing yet.
      date: stage === "disputed" || facts.notOnChainForDays !== null ? null : facts.executableAt,
      dateLabel: stage === "disputed" ? "after the ruling" : facts.notOnChainForDays !== null ? "once it is on chain" : "executable from",
      // Upheld but not yet executable: say what the wait is (the contract runs it from max(frozen executableAt, uphold)).
      description:
        stage === "upheld" && !Number.isNaN(executableMs) && executableMs > now
          ? `The ${hours ? `${hours} h ` : ""}on-chain timelock from the proposal still runs; an uphold never shortens it.`
          : undefined,
    });
  }
  return steps;
}

// ── The next step ───────────────────────────────────────────────────────────

export type CaseActionId =
  | "rule"
  | "cancel"
  | "compensate"
  | "block"
  | "approve"
  | "open-request"
  // B18: the stuck-cancel actions, each shown only when its guard holds on the brief's read.
  | "close-cancel"
  | "record-execution"
  | "repropose";

export interface CaseNextStep {
  kind: "action" | "waiting" | "done";
  title: string;
  description: string;
  /** The primary action, when `kind` is "action". */
  action: CaseActionId | null;
  /** A quiet action next to a waiting card. */
  secondary: CaseActionId | null;
  /** Money moved that should not have: drawn as an alert, never a calm card. */
  alert?: boolean;
  /** The instant the description points at, for a countdown. */
  until: string | null;
  /** A short line under the description, e.g. who must approve. Never the deadline again. */
  meta?: string | null;
}

export interface CaseAuthority {
  rule: boolean;
  cancel: boolean;
  compensate: boolean;
  block: boolean;
  /** B18: may close a cancel with nothing standing (`S-15`): role, and the brief's read allows it. */
  closeCancel: boolean;
  /** B18: may ask to record an execution while the cancel waited (`S-16`, two-person). */
  recordExecution: boolean;
  /** B18: may ask to propose an upheld penalty again (`S-17`, two-person). */
  repropose: boolean;
}

export function caseAuthority(
  brief: OperatorCaseBrief,
  identity: Pick<OperatorIdentity, "roles" | "authorityLimit">,
  facts: CaseFacts,
): CaseAuthority {
  const caps = capabilitiesFor(identity.roles);
  const status = facts.status;

  return {
    rule: caps.rule,
    cancel: may(identity.roles, "cancel") && facts.stage === "cancel-requested" && !facts.nothingOnChain && !facts.executedWhileCancelWaited,
    compensate: may(identity.roles, "compensate") && status !== null && isLegalInStatus("compensate", status),
    block: caps.block,
    closeCancel: may(identity.roles, "closeCancel") && facts.manual.close,
    recordExecution: may(identity.roles, "recordExecution") && facts.manual.record,
    repropose: may(identity.roles, "repropose") && facts.manual.repropose,
  };
}

/** "1 day", "5 days". */
function daysText(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

function when(iso: string | null, format: (iso: string) => string): string {
  return iso ? format(iso) : "a time the chain has not reported yet";
}

/**
 * What THIS operator does next. `format` renders an instant for the sentence
 * (UTC on screen, labelled; a fixed formatter in tests).
 */
export function caseNextStep(
  facts: CaseFacts,
  authority: CaseAuthority,
  format: (iso: string) => string,
): CaseNextStep {
  if (facts.executedWhileCancelWaited && authority.recordExecution) {
    return {
      kind: "action",
      title: "Executed on chain while the cancel waited",
      description:
        "The stake was taken: the penalty was executed on chain before the cancel landed. Record the execution on the case; a second Lead adjudicator or Treasury approves it.",
      action: "record-execution",
      secondary: null,
      until: null,
      alert: true,
    };
  }
  if (facts.executedWhileCancelWaited && facts.manual.record) {
    return {
      kind: "waiting",
      title: "Executed on chain while the cancel waited",
      description:
        "The stake was taken: the penalty was executed on chain before the cancel landed. A Lead adjudicator or Treasury records it on the case, with a second approver.",
      action: null,
      secondary: null,
      until: null,
      alert: true,
    };
  }
  if (facts.executedWhileCancelWaited) {
    return {
      kind: "waiting",
      title: "Executed on chain while the cancel waited",
      description:
        "The stake was taken: the penalty was executed on chain before the cancel landed. Nothing can be cancelled any more. Operations has been alerted to record it and decide on paying it back.",
      action: null,
      secondary: null,
      until: null,
      alert: true,
    };
  }
  if (facts.closeOutstanding && facts.manual.repropose) {
    return authority.repropose
      ? {
          kind: "action",
          title: "Propose the upheld penalty again",
          description:
            "Its earlier record was cancelled on chain, so nothing stands and the decided penalty is not on chain. Propose it again; a second adjudicator approves it.",
          action: "repropose",
          secondary: null,
          until: null,
        }
      : {
          kind: "waiting",
          title: "The upheld penalty is not on chain",
          description:
            "Its earlier record was cancelled on chain, so nothing stands. A Lead adjudicator or Treasury proposes it again, with a second approver.",
          action: null,
          secondary: null,
          until: null,
        };
  }
  if (facts.closeOutstanding && authority.closeCancel) {
    return {
      kind: "action",
      title: "Close the cancel: nothing stands on chain",
      description:
        "Its record reads cancelled on chain: nothing can be executed, and there is nothing to sign. Nothing was taken from the provider's stake. Close the cancel so it leaves Waiting for signature.",
      action: "close-cancel",
      secondary: null,
      until: null,
    };
  }
  if (facts.closeOutstanding) {
    return {
      kind: "done",
      title: "Nothing is on chain",
      description:
        "Nothing is on chain: nothing can be executed, and there is nothing to sign. Nothing was taken from the provider's stake. It still shows under Waiting for signature until its on-chain side is closed.",
      action: null,
      secondary: null,
      until: null,
    };
  }
  // "Anyone can execute" only while something stands on chain (B11).
  if (facts.nothingOnChain && ["cancel-requested", "executable", "upheld", "window-open", "disputed"].includes(facts.stage)) {
    return {
      kind: "done",
      title: "Nothing is on chain",
      description: "Nothing is on chain: nothing can be executed, and there is nothing to sign.",
      action: null,
      secondary: null,
      until: null,
    };
  }
  switch (facts.stage) {
    case "cancel-requested":
      return cancelNextStep(facts, authority, format);
    case "disputed":
      return authority.rule
        ? {
            kind: "action",
            title: "Rule on this dispute",
            description: `Uphold or cancel by ${when(facts.disputeExpiresAt, format)}. Unruled, the stake is freed.`,
            action: "rule",
            secondary: null,
            until: facts.disputeExpiresAt,
          }
        : {
            kind: "waiting",
            title: "Waiting for the arbiter",
            description: `The ruling is due by ${when(facts.disputeExpiresAt, format)}.`,
            action: null,
            secondary: null,
            until: facts.disputeExpiresAt,
          };
    case "window-open":
      return {
        kind: "waiting",
        title: "Dispute window open",
        description: `The provider can dispute until ${when(facts.executableAt, format)}; undisputed, it becomes executable then.`,
        action: null,
        secondary: null,
        until: facts.executableAt,
      };
    case "upheld":
      return {
        kind: "waiting",
        title: "Upheld by the arbiter",
        description: `Anyone can execute it from ${when(facts.executableAt, format)}.`,
        action: null,
        secondary: null,
        until: facts.executableAt,
      };
    case "executable":
      return {
        kind: "waiting",
        title: "Executable now",
        description: "The dispute window has closed; it executes when anyone sends it.",
        action: null,
        secondary: null,
        until: null,
      };
    case "not-on-chain":
      // The last attempt failed: say why, so a stuck proposal never reads as a healthy wait.
      if (facts.chainFailure) {
        return {
          kind: "waiting",
          title:
            facts.notOnChainForDays !== null
              ? `Not on chain after ${daysText(facts.notOnChainForDays)}: the last attempt failed`
              : "Not on chain yet: the last attempt failed",
          description: `${facts.chainFailure} Assay tries again on its next pass; nothing can be executed until it is on chain.`,
          action: null,
          secondary: null,
          until: null,
        };
      }
      if (facts.notOnChainForDays !== null) {
        return {
          kind: "waiting",
          title: `Not on chain after ${daysText(facts.notOnChainForDays)}`,
          description: "Its dates were computed for when it lands, and they have passed: nothing can be executed until it is on chain.",
          action: null,
          secondary: null,
          until: null,
        };
      }
      return {
        kind: "waiting",
        title: "Going on chain",
        description: "The provider's dispute window starts once it lands.",
        action: null,
        secondary: null,
        until: null,
      };
    case "executed":
      return {
        kind: "done",
        title: "Penalty executed",
        description: authority.compensate
          ? "The stake was taken. If it was wrong, pay the provider back from the ⋯ menu."
          : "The stake was taken. Nothing is left to do on this penalty.",
        action: null,
        secondary: null,
        until: null,
      };
    case "compensated":
        return {
          kind: "done",
          title: "Provider compensated",
          description: "The penalty executed and the treasury paid it back into the provider's stake. Nothing is left to do.",
          action: null,
          secondary: null,
          until: null,
        };
    case "cancelled":
      if (facts.expired) {
        return {
          kind: "done",
          title: "Penalty expired",
          description: "Nobody ruled within 30 days, so it lapsed. Nothing was taken from the provider's stake.",
          action: null,
          secondary: null,
          until: null,
        };
      }
      return {
        kind: "done",
        title: "Penalty cancelled",
        description: facts.nothingOnChain
          ? "Nothing is on chain: nothing can be executed. Nothing was taken from the provider's stake, and there is nothing to sign."
          : "Nothing was taken from the provider's stake. Nothing is left to do.",
        action: null,
        secondary: null,
        until: null,
      };
  }
}

// ── A two-person request already waiting on this penalty ────────────────────

/** What each two-person request on a penalty is called, and what it does. */
const REQUEST_WORDS: Record<string, { noun: string; does: string }> = {
  "slash.compensated": { noun: "pay-back", does: "pay the penalty back into the provider's stake" },
  "slash.record_execution": { noun: "execution record", does: "record the execution the chain made while the cancel waited" },
  "slash.repropose": { noun: "re-proposal", does: "propose this upheld penalty on chain again" },
};

export interface PendingRequest {
  action: string;
  /** The requester's name. */
  requestedBy: string;
  createdAt: string;
  expiresAt: string;
  /** This operator asked for it. */
  mine: boolean;
  /** This operator may approve it (someone else's, and their roles cover it). */
  canApprove: boolean;
  /** Who may approve it, the requester left out. */
  approvers: readonly string[];
}

/** "Riley Brooks", "Riley Brooks or Iris Park", "Jordan Blake, Riley Brooks or Iris Park". Pure. */
export function namesOr(names: readonly string[], none: string): string {
  if (names.length === 0) return none;
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** "Pay-back", "Suspension": the noun for a request, capitalised. Pure. */
export function requestNoun(action: string): string {
  const noun = REQUEST_WORDS[action]?.noun ?? "request";
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

/**
 * The next step while a two-person request on this penalty waits: approve it
 * when this operator may, else who it waits for. It replaces a "done" or
 * "waiting" step (a pay-back pending on an executed penalty), never an action
 * the operator could take themselves. Pure.
 */
export function pendingRequestStep(
  request: PendingRequest,
  format: (iso: string) => string,
  now: number = Date.now(),
): CaseNextStep {
  const words = REQUEST_WORDS[request.action] ?? { noun: "request", does: "act on this penalty" };
  const noun = requestNoun(request.action);
  const who = namesOr(request.approvers, "a second approver");
  const end = Date.parse(request.expiresAt);
  if (!Number.isNaN(end) && end <= now) {
    // Past its deadline it waits for nobody: never "Lapses <a time already gone>".
    return {
      kind: "done",
      title: `${noun} request expired`,
      description: `${request.mine ? "You" : request.requestedBy} asked ${format(request.createdAt)} to ${words.does}. Nobody approved it in time, so nothing changed.`,
      action: null,
      secondary: null,
      until: null,
      meta: `Expired ${format(request.expiresAt)}.`,
    };
  }
  const meta = `Lapses ${format(request.expiresAt)} if nobody decides.`;
  if (request.canApprove) {
    return {
      kind: "action",
      title: `Approve the ${words.noun}`,
      description: `${request.requestedBy} asked ${format(request.createdAt)} to ${words.does}. It needs a second person, and you can approve it.`,
      action: "approve",
      secondary: null,
      until: request.expiresAt,
      meta,
    };
  }
  return {
    kind: "waiting",
    title: request.mine ? `Your ${words.noun} is waiting for approval` : `${noun} waiting for approval`,
    description: request.mine
      ? `You asked ${format(request.createdAt)} to ${words.does}. Waiting for ${who} to approve it.`
      : `${request.requestedBy} asked ${format(request.createdAt)} to ${words.does}. Waiting for ${who} to approve it.`,
    action: null,
    secondary: "open-request",
    until: request.expiresAt,
    meta,
  };
}

/** Why a ⋯ item is held back while the same request already waits. Null when none does. Pure. */
export function alreadyWaiting(action: string, pendingActions: readonly string[]): string | null {
  if (!pendingActions.includes(action)) return null;
  return `A ${REQUEST_WORDS[action]?.noun ?? "request"} request is already waiting`;
}

/**
 * The sentence for what a missing cancel signature leads to, for the cancel
 * sheet and the next-step card. Never says "anyone can execute" for a record
 * still disputed on chain: the contract refuses to execute those.
 */
export function cancelDeadlineSentence(facts: CaseFacts, format: (iso: string) => string): string {
  const deadline = facts.cancel?.deadline ?? null;
  if (facts.cancel?.ifUnsigned === "expires") {
    return `Have it signed before ${when(deadline, format)}. The provider's dispute keeps the penalty frozen meanwhile: it cannot be executed, and unsigned by then anyone can expire it and the stake is released.`;
  }
  if (facts.chainUnconfirmed) {
    return `Have it signed before ${when(deadline, format)}. We could not confirm what stands on chain: signing reads the chain first and says whether there is anything to cancel.`;
  }
  return `Have it signed before ${when(deadline, format)}; after that anyone can execute the penalty.`;
}

function cancelNextStep(facts: CaseFacts, authority: CaseAuthority, format: (iso: string) => string): CaseNextStep {
  const deadline = facts.cancel?.deadline ?? null;
  const executes = facts.cancel?.ifUnsigned !== "expires";
  const passed = deadline !== null && Date.parse(deadline) <= Date.now();

  if (passed && executes && facts.chainUnconfirmed) {
    // Past the deadline, but the chain read did not confirm a standing record:
    // never "anyone can execute" (V1-15). The action reads the chain first.
    return {
      kind: authority.cancel ? "action" : "waiting",
      title: authority.cancel ? "Check the chain and get the cancel signed now" : "Waiting for the cancel signature",
      description: authority.cancel
        ? "If the penalty still stands on chain, its deadline has passed. We could not confirm what stands there: Get the cancel signed reads the chain first, says whether there is anything to sign, and changes nothing if there is not."
        : "If the penalty still stands on chain, the deadline for the cancel has passed. We could not confirm what stands there: a Lead adjudicator or Treasury has to check it and get the cancel signed now.",
      action: authority.cancel ? "cancel" : null,
      secondary: null,
      until: null,
    };
  }
  if (passed && executes) {
    // Truly the on-chain state: a Pending record past its executable time.
    return {
      kind: authority.cancel ? "action" : "waiting",
      title: authority.cancel ? "Get the cancel signed now" : "Waiting for the cancel signature",
      description: authority.cancel
        ? "The deadline has passed: anyone can execute this penalty now. Have the arbiter sign the cancel as soon as possible."
        : "The deadline for the cancel has passed and anyone can execute the penalty. A Lead adjudicator or Treasury has to get the cancel signed now.",
      action: authority.cancel ? "cancel" : null,
      secondary: null,
      until: null,
    };
  }
  if (passed) {
    return {
      kind: "waiting",
      title: "Dispute timed out",
      description: "Nobody signed the cancel before the dispute timed out, so anyone can now expire it and the stake is released. Nothing is taken from the provider.",
      action: null,
      secondary: null,
      until: null,
    };
  }
  return authority.cancel
    ? {
        kind: "action",
        title: "Get the cancel signed",
        description: `Cancelled here; on chain it stands until the arbiter key signs the cancel. ${cancelDeadlineSentence(facts, format)}`,
        action: "cancel",
        secondary: null,
        until: deadline,
      }
    : {
        kind: "waiting",
        title: "Waiting for the cancel signature",
        description: `A Lead adjudicator or Treasury gets the arbiter to sign it. ${cancelDeadlineSentence(facts, format)}`,
        action: null,
        secondary: null,
        until: deadline,
      };
}

/** "Your limit is $0 · Ask Jordan": why an action is refused, in one line. Pure. */
export function shortWhyNot(
  me: Pick<OperatorIdentity, "roles" | "authorityLimit">,
  action: ConsoleAction,
  amount: Money | null,
  names: readonly string[] | null,
): string | null {
  const check = checkAction(me, action, amount);
  if (check.allowed) return null;
  const limit = me.authorityLimit;
  const why = !check.limitOnly
    ? `Needs ${rolesPhrase(check.roles)}`
    : limit && limit.amount === "0"
      ? "Your limit is $0"
      : `Above your ${limit ? formatMoney(limit) : ""} limit`.replace("  ", " ");
  return names === null ? why : `${why} · ${askLabel(names, rolesPhrase(check.roles))}`;
}


// ── B18: the stuck-cancel actions ───────────────────────────────────────────

export type ManualActionKind = "close" | "record" | "repropose";

/** One line of a manual action's "What happens": money, chain, approver, undo. */
export interface ManualActionLine {
  kind: "money" | "chain" | "approver" | "undo";
  text: string;
}

export interface ManualActionCopy {
  /** Register code: `S-15`, `S-16`, `S-17`. */
  code: "S-15" | "S-16" | "S-17";
  /** The approval action it is queued as; null for the one-person close. */
  approvalAction: string | null;
  twoPerson: boolean;
  title: string;
  lines: ManualActionLine[];
  /** The confirmation the operator ticks before the button enables. */
  confirm: string;
  submit: string;
}

/**
 * What each B18 action does, said before it is sent: whether money moves,
 * whether anything is written on chain, whether it can be undone, and who
 * approves it. Pure. Each line states what the backend guarantees, never an
 * outcome it does not (the chain is read again first, and refused if it
 * changed).
 */
export function manualActionCopy(
  kind: ManualActionKind,
  amounts: { penalty: string; applied: string | null },
  /** Closed here with no penalty (overturned, cancelled, waived): the stake was owed nothing. */
  closed = true,
): ManualActionCopy {
  switch (kind) {
    case "close":
      return {
        code: "S-15",
        approvalAction: null,
        twoPerson: false,
        title: "Close the cancel: nothing stands on chain",
        lines: [
          { kind: "money", text: `No money moves. The ${amounts.penalty} penalty was never taken, and it stays that way.` },
          { kind: "chain", text: "Nothing is sent on chain. The record is read again first; unless it still reads cancelled, nothing changes." },
          { kind: "approver", text: "One person: no second approver. Recorded in Activity under your name." },
          { kind: "undo", text: "It can't be undone: the penalty leaves Waiting for signature for good." },
        ],
        confirm: "I checked that this penalty's record reads cancelled on chain and that nothing of it stands.",
        submit: "Close the cancel",
      };
    case "record":
      return {
        code: "S-16",
        approvalAction: "slash.record_execution",
        twoPerson: true,
        title: "Record the execution on the penalty",
        lines: [
          {
            kind: "money",
            text: closed
              ? `${amounts.applied ? `${amounts.applied} was` : "The penalty was"} already taken from the provider's stake on chain. Recording it moves no money now; paying it back is a separate request.`
              : `${amounts.applied ? `${amounts.applied} was` : "The penalty was"} already taken from the provider's stake on chain. Recording it moves no money; the penalty closes as executed.`,
          },
          { kind: "chain", text: "Nothing is sent on chain. The record is read again when it is approved; unless it still reads executed, nothing is written." },
          { kind: "approver", text: "Needs a second approver: a Lead adjudicator or Treasury other than you." },
          { kind: "undo", text: "It can't be undone." },
        ],
        confirm: "I checked that this penalty's record reads executed on chain, and who it paid.",
        submit: "Send for approval",
      };
    case "repropose":
      return {
        code: "S-17",
        approvalAction: "slash.repropose",
        twoPerson: true,
        title: "Propose the upheld penalty again",
        lines: [
          {
            kind: "money",
            text: `Once it is on chain, up to ${amounts.penalty} of the provider's stake is reserved again. Nothing is taken until it becomes executable.`,
          },
          {
            kind: "chain",
            text: "Written on chain as a new record by the next proposal pass, with every usual check (stake, caps, the provider's dispute window). The old record is read again first; unless it still reads cancelled, nothing changes.",
          },
          { kind: "approver", text: "Needs a second approver: an Adjudicator or Lead adjudicator other than you." },
          { kind: "undo", text: "It can't be undone here. The provider can dispute the new record on chain." },
        ],
        confirm: "I checked that the earlier record reads cancelled on chain and was never disputed.",
        submit: "Send for approval",
      };
  }
}
