import type { StatusTimelineStep } from "@/components/patterns/status-timeline";
import { caseChainStageOf } from "@/features/provider-slash-case/chain-stage";
import type { Money } from "@/interfaces/api";
import type { OperatorCaseBrief, OperatorIdentity, SlashProposalStatus } from "@/interfaces/operator";
import { formatMoney } from "@/utils/money";
import { DISPUTE_TIMEOUT_SECONDS } from "@/libs/chains/evm/stake-slashes/abi";

import { DISPUTE_RED_FROM_DAY, disputeUrgency } from "./inbox";
import { capabilitiesFor, checkAction, rolesPhrase, type ConsoleAction } from "./roles";
import { asProposalStatus, isLegalInStatus, may, suspendIsTwoPerson } from "./state";
import { askLabel } from "./why-not";

/**
 * The penalty's on-chain process, as the case screen draws it:
 *
 *   Proposed → dispute window (72 h) → [Disputed → Arbiter rules, 30 days] → Executed | Cancelled
 *
 * and the single next step THIS operator can take on it. Pure, so the rules
 * are tested without the screen. The off-chain objection process (claim,
 * decide, second signature, extend) is gone from the product; a case still in
 * one of its statuses is read by where its on-chain record stands.
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
  /** True when the case still carries a status of the retired off-chain objection process. */
  legacyStatus: boolean;
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
    chainStatus: brief.chainStatus ?? proposal.clocks.chainStatus,
    chainExecutableAt: brief.chainExecutableAt ?? proposal.clocks.chainExecutableAt ?? null,
    chainDisputedParts: brief.chainDisputedParts ?? proposal.clocks.chainDisputedParts,
  };
  const chain = clocks.chainStatus;
  const chainStage = caseChainStageOf(clocks);
  const disputedAt = clocks.chainDisputedAt ?? (chainStage.kind === "disputed" ? chainStage.disputedAt : null) ?? null;
  const executableAt = clocks.chainExecutableAt ?? clocks.earliestExecutionAt ?? null;
  const legacyStatus = status === "DISPUTED" || status === "UNDER_REVIEW" || status === "AWAITING_SECOND";

  let stage: CaseStage;
  // Executed on chain, then paid back by the treasury: the chain still reads EXECUTED.
  if (status === "REVERSED") stage = "compensated";
  else if (chain === "EXECUTED" || status === "EXECUTED" || status === "EXECUTING") stage = "executed";
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
  const recordDisputed = disputedAt !== null && (clocks.chainDisputedParts ?? 0) > 0;
  const cancel =
    stage !== "cancel-requested"
      ? null
      : recordDisputed
        ? { deadline: disputeExpiresAt, ifUnsigned: "expires" as const }
        : { deadline: executableAt, ifUnsigned: "executes" as const };

  const expired = stage === "cancelled" && disputedAt !== null && proposal.resolutionKind === "AUTO_CHAIN_VOIDED";

  return {
    stage,
    status,
    executableAt,
    disputedAt,
    disputeExpiresAt,
    legacyStatus,
    expired,
    cancel,
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
          date: wasDisputed ? facts.disputedAt : cutShort ? proposal.resolvedAt : facts.executableAt,
          dateLabel:
            stage === "not-on-chain"
              ? "starts once it is on chain"
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
      date: stage === "disputed" ? null : facts.executableAt,
      dateLabel: stage === "disputed" ? "after the ruling" : "executable from",
    });
  }
  return steps;
}

// ── The next step ───────────────────────────────────────────────────────────

export type CaseActionId = "suspend" | "rule" | "cancel" | "compensate" | "sweep" | "block" | "approve" | "open-request";

export interface CaseNextStep {
  kind: "action" | "waiting" | "done";
  title: string;
  description: string;
  /** The primary action, when `kind` is "action". */
  action: CaseActionId | null;
  /** A quiet action next to a waiting card (e.g. Suspend while the window is open). */
  secondary: CaseActionId | null;
  /** The instant the description points at, for a countdown. */
  until: string | null;
  /** A short line under the description, e.g. who must approve. Never the deadline again. */
  meta?: string | null;
}

export interface CaseAuthority {
  /**
   * May suspend: role, status and authority limit all allow it. `open` is the
   * status half alone — the penalty can still be suspended by someone — which
   * is when a "who can" line is worth drawing.
   */
  suspend: { allowed: boolean; open: boolean; twoPerson: boolean; reason: string | null };
  rule: boolean;
  cancel: boolean;
  compensate: boolean;
  block: boolean;
}

export function caseAuthority(
  brief: OperatorCaseBrief,
  identity: Pick<OperatorIdentity, "roles" | "authorityLimit">,
  facts: CaseFacts,
): CaseAuthority {
  const caps = capabilitiesFor(identity.roles);
  const penalty: Money = brief.case.proposal.penaltyAmount;
  const status = facts.status;
  // Role and authority limit: the same check the Home banner reads.
  const check = checkAction(identity, "suspend", penalty);
  const legal = Boolean(status && isLegalInStatus("suspend", status)) && facts.stage !== "executed" && facts.stage !== "cancelled";
  const suspendReason = !legal ? "This penalty can no longer be suspended." : check.why;

  return {
    suspend: { allowed: legal && check.allowed, open: legal, twoPerson: status ? suspendIsTwoPerson(status) : false, reason: suspendReason },
    rule: caps.rule,
    cancel: may(identity.roles, "cancel") && facts.stage === "cancel-requested",
    compensate: may(identity.roles, "compensate") && status !== null && isLegalInStatus("compensate", status),
    block: caps.block,
  };
}

function when(iso: string | null, format: (iso: string) => string): string {
  return iso ? format(iso) : "a time the chain has not reported yet";
}

/**
 * What THIS operator does next. `format` renders an instant for the sentence
 * (local time on screen; a fixed formatter in tests).
 */
export function caseNextStep(
  facts: CaseFacts,
  authority: CaseAuthority,
  format: (iso: string) => string,
): CaseNextStep {
  const suspendSecondary = authority.suspend.allowed ? ("suspend" as const) : null;
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
        secondary: suspendSecondary,
        until: facts.executableAt,
      };
    case "upheld":
      return {
        kind: "waiting",
        title: "Upheld by the arbiter",
        description: `Anyone can execute it from ${when(facts.executableAt, format)}.`,
        action: null,
        secondary: suspendSecondary,
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
      return {
        kind: "waiting",
        title: "Going on chain",
        description: "The provider's dispute window starts once it lands.",
        action: null,
        secondary: suspendSecondary,
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
        description: "Nothing was taken from the provider's stake. Nothing is left to do.",
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
  "slash.suspend": { noun: "suspension", does: "suspend this penalty" },
  "slash.sweep": { noun: "fleet sweep", does: "decide every case with the same defect the way this one was decided" },
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
  return `Have it signed before ${when(deadline, format)}; after that anyone can execute the penalty.`;
}

function cancelNextStep(facts: CaseFacts, authority: CaseAuthority, format: (iso: string) => string): CaseNextStep {
  const deadline = facts.cancel?.deadline ?? null;
  const executes = facts.cancel?.ifUnsigned !== "expires";
  const passed = deadline !== null && Date.parse(deadline) <= Date.now();

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
        description: `Suspended here; on chain it stands until the arbiter key signs the cancel. ${cancelDeadlineSentence(facts, format)}`,
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

