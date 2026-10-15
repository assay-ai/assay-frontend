import type { StatusTimelineStep } from "@/components/patterns/status-timeline";
import { caseChainStageOf } from "@/features/provider-slash-case/chain-stage";
import type { Money } from "@/interfaces/api";
import type { OperatorCaseBrief, OperatorIdentity, SlashProposalStatus } from "@/interfaces/operator";
import { DISPUTE_TIMEOUT_SECONDS } from "@/libs/chains/evm/stake-slashes/abi";

import { DISPUTE_RED_FROM_DAY, disputeDayText } from "./inbox";
import { capabilitiesFor, checkAction } from "./roles";
import { asProposalStatus, isLegalInStatus, may, suspendIsTwoPerson } from "./state";

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

  return {
    stage,
    status,
    executableAt,
    disputedAt,
    disputeExpiresAt: plusSeconds(disputedAt, DISPUTE_TIMEOUT_SECONDS),
    legacyStatus,
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

  const steps: StatusTimelineStep[] = [
    { id: "proposed", label: "Proposed", state: "done", date: proposal.clocks.proposedAt },
  ];

  // The window: open until the record is executable, unless a dispute froze it first.
  steps.push({
    id: "window",
    label: windowLabel,
    state:
      stage === "window-open" ? "current" : stage === "not-on-chain" ? "upcoming" : "done",
    date: wasDisputed ? facts.disputedAt : facts.executableAt,
    dateLabel: stage === "not-on-chain" ? "starts once it is on chain" : wasDisputed ? "provider disputed" : undefined,
    countdown: stage === "window-open",
    description: stage === "window-open" ? "The provider can dispute on chain until then." : undefined,
  });

  const day = facts.disputedAt ? Math.floor((now - Date.parse(facts.disputedAt)) / 86_400_000) : null;
  if (wasDisputed) {
    const ruled = stage === "upheld" || closed || stage === "cancel-requested";
    steps.push({
      id: "ruling",
      label: stage === "upheld" ? "Arbiter upheld it" : "Arbiter rules",
      state: ruled ? "done" : "current",
      date: ruled ? null : facts.disputeExpiresAt,
      // The same "Day N of 30 · X days left" as Home, Penalties and Arbiter — not a second countdown.
      dateLabel: ruled ? undefined : `${disputeDayText({ disputedAt: facts.disputedAt, expiresAt: facts.disputeExpiresAt }, now)} · ends`,
      countdown: false,
      urgent: !ruled && day !== null && day >= DISPUTE_RED_FROM_DAY,
      description: ruled ? undefined : "Unruled by then, anyone can expire it and the stake is released.",
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
    steps.push({ id: "end", label: "Cancelled", state: "done", date: proposal.resolvedAt });
  } else if (stage === "cancel-requested") {
    steps.push({
      id: "end",
      label: "Cancel waiting for the arbiter",
      state: "current",
      date: facts.executableAt,
      dateLabel: "sign before",
      countdown: true,
      urgent: true,
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

export type CaseActionId = "suspend" | "rule" | "cancel" | "compensate" | "sweep" | "block";

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
  /** A short mono line under the description, e.g. "Day 24 of 30 · 7 days left". */
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
    case "cancel-requested": {
      const passed = facts.executableAt !== null && Date.parse(facts.executableAt) <= Date.now();
      if (passed) {
        return {
          kind: authority.cancel ? "action" : "waiting",
          title: authority.cancel ? "Get the cancel signed now" : "Nothing for you",
          description: authority.cancel
            ? "The deadline has passed: anyone can execute this penalty now. Have the arbiter sign the cancel as soon as possible."
            : "The deadline for the cancel has passed and anyone can execute the penalty. A Lead adjudicator or Treasury has to get the cancel signed now.",
          action: authority.cancel ? "cancel" : null,
          secondary: null,
          until: null,
        };
      }
      return authority.cancel
        ? {
            kind: "action",
            title: "Get the cancel signed",
            description: `The penalty was cancelled here, but its record still stands on chain. Prepare the cancel for the arbiter and have it signed before ${when(facts.executableAt, format)}; after that anyone can execute the penalty.`,
            action: "cancel",
            secondary: null,
            until: facts.executableAt,
          }
        : {
            kind: "waiting",
            title: "Nothing for you",
            description: `Waiting for a Lead adjudicator or Treasury to have the arbiter sign the cancel, before ${when(facts.executableAt, format)}.`,
            action: null,
            secondary: null,
            until: facts.executableAt,
          };
    }
    case "disputed":
      return authority.rule
        ? {
            kind: "action",
            title: "Rule on this dispute",
            description: `The provider disputed this penalty on chain. Uphold it or cancel it before ${when(facts.disputeExpiresAt, format)}; unruled, anyone can expire it and the stake is released.`,
            action: "rule",
            secondary: null,
            until: facts.disputeExpiresAt,
            meta: disputeDayText({ disputedAt: facts.disputedAt, expiresAt: facts.disputeExpiresAt }),
          }
        : {
            kind: "waiting",
            title: "Nothing for you",
            description: `Waiting for the arbiter to rule, by ${when(facts.disputeExpiresAt, format)}.`,
            action: null,
            secondary: null,
            until: facts.disputeExpiresAt,
            meta: disputeDayText({ disputedAt: facts.disputedAt, expiresAt: facts.disputeExpiresAt }),
          };
    case "window-open":
      return {
        kind: "waiting",
        title: "Nothing needed from you",
        description: `The provider can dispute on chain until ${when(facts.executableAt, format)}. Undisputed, it becomes executable then.${
          suspendSecondary ? " Suspend it only if it was proposed in error." : ""
        }`,
        action: null,
        secondary: suspendSecondary,
        until: facts.executableAt,
      };
    case "upheld":
      return {
        kind: "waiting",
        title: "Nothing needed from you",
        description: `The arbiter upheld the penalty. It is executable from ${when(facts.executableAt, format)}, by anyone.`,
        action: null,
        secondary: suspendSecondary,
        until: facts.executableAt,
      };
    case "executable":
      return {
        kind: "waiting",
        title: "Nothing needed from you",
        description: "The dispute window has closed. The penalty is executable now and executes when anyone sends it.",
        action: null,
        secondary: null,
        until: null,
      };
    case "not-on-chain":
      return {
        kind: "waiting",
        title: "Nothing needed from you",
        description: "The penalty is being written on chain. The provider's dispute window starts once it lands.",
        action: null,
        secondary: suspendSecondary,
        until: null,
      };
    case "executed":
      return {
        kind: "done",
        title: "Penalty executed",
        description: authority.compensate
          ? "The stake was taken. If it was wrong, compensate the provider under More actions."
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
