"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CodeBlock } from "@/components/ui/code-block";
import { Field } from "@/components/ui/field";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Radio } from "@/components/ui/radio";
import { signerRoleLabel } from "@/features/chain-calls/send-contract-call";
import { arbiterErrorMessage } from "@/features/operator/arbiter";
import { ContractCallPanel } from "@/features/operator/contract-call-panel";
import {
  ALL_OUTCOMES,
  DECISION_NOTE_MIN_LENGTH,
  OUTCOME_CONSEQUENCE,
  OUTCOME_LABEL,
  REASON_CODES,
  SHORT_NOTE_MIN_LENGTH,
  SWEEPABLE_OUTCOMES,
  type OutcomeConsequence,
} from "@/features/operator/reason-codes";
import {
  chainIdOf,
  runOperatorIntent,
  signerIsHolder,
} from "@/features/operator/run-operator-intent";
import { useOperatorSession } from "@/features/operator/session-context";
import {
  asProposalStatus,
  authorityRefusal,
  cancelDeadlineNotice,
  caseStatusLabel,
  exceedsAuthority,
  isCancelRequested,
  isLegalInStatus,
  isSweepable,
  may,
  RECALCULATED_AMOUNT_PATTERN,
  COMPENSATION_APPROVER_ROLES,
  suspendedNotice,
  suspendNeedsApprover,
  SUSPEND_APPROVER_ROLES,
  SWEEP_APPROVER_ROLES,
  type OperatorAction,
  type StatusGatedAction,
} from "@/features/operator/state";
import { isUserRejection, useSigner } from "@/hooks/useSigner";
import type {
  ArbitrationOutcome,
  CancelIntent,
  CompensationIntent,
  DecideCaseBody,
  ExtendDeadlineBody,
  OpenFleetSweepBody,
  OperatorCaseBrief,
  OperatorRole,
  RecordCompensationBody,
  SecondSignatureBody,
  SlashProposalStatus,
  SuspendProposalBody,
} from "@/interfaces/operator";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { ApiError } from "@/libs/ApiClient";
import { chainStatusLabel } from "@/libs/chains/status-labels";
import {
  claimCase,
  createCancelIntent,
  createCompensationIntent,
  decideCase,
  extendCaseDeadline,
  openFleetSweep,
  recordCompensation,
  secondCase,
  suspendCase,
} from "@/services/operator.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";

/**
 * The operator's action panel, mounted by the case screen.
 *
 * Everything here writes to the override register, and one of these actions
 * eventually moves money on chain. So the panel offers an action only when
 * **both** gates say yes:
 *
 *  - `may(roles, action)` — what this token's roles permit. Read off
 *    `GET /operator/me` via the session context, never a hardcoded role test.
 *  - `isLegalInStatus(action, status)` — what the proposal's current status
 *    permits. Those lists were read off the backend's own state machine.
 *    Rendering a button for a transition that does not exist is the main way
 *    this screen wastes an adjudicator's time: they compose a note, submit,
 *    and get a 409 that the screen could have known about before they typed.
 *
 * ## All seven
 *
 * 7a shipped `claim` and `suspend`; 7b added `decide`, `second` and
 * `extendDeadline`; 7c added `sweep` and `reverse`. Lean v3 replaced `reverse`
 * with `compensate` and added `cancel`.
 *
 * `sweep` is the one action **not** gated on the status: see its gate below.
 *
 * ## Two actions this console can no longer complete, and says so
 *
 * `compensate` and `cancel` are **build-only**. The program has no
 * `reverse_slash` any more, and `cancel_slash` needs `Config.admin`'s own
 * signature; putting a wrongly-taken penalty back is the treasury depositing
 * into the provider's stake with an ordinary `deposit_stake`, signed by a
 * multisig this platform holds no key for. So both sections hand over unsigned
 * base64 and the identity of who must sign it, and the primary affordance is
 * **copy**, not submit. A connected wallet that happens to *be* that identity
 * gets a sign-and-send button as a convenience; nothing depends on it.
 *
 * That is why `compensate` is a two-step act — build, then record the confirmed
 * signature — while `cancel` is one step: there is no route to record a
 * cancellation, because the reconcile sweep mirrors the on-chain record and
 * moves the case to `CANCELLED` by itself.
 *
 * ## The approver's token is held, never kept
 *
 * `sweep` and the **record half** of `compensate` collect one. The build halves
 * of `compensate` and `cancel` do not, and that asymmetry is the backend's:
 * both intent routes are `@OverrideExempt` because unsigned bytes change
 * nothing, while `compensated` is override-register row `S-5` — the same row
 * the `reverse` it replaces occupied. So the field renders on the record step
 * and not on the build step, rather than once for the whole section.
 *
 * It is written nowhere else:
 * not `localStorage`, not the query cache, not a query key, not a log line, not
 * a toast, and deliberately **not** a react-query mutation variable (those
 * outlive the call on the mutation object). Both `mutationFn`s close over the
 * state instead. It is cleared on every section toggle, on success, and on
 * unmount.
 *
 * ## What the panel deliberately does NOT predict
 *
 * Two outcomes of `decide` are decided by server-side configuration this app
 * cannot read: whether the penalty clears the materiality threshold that
 * demands a second signature, and — following from that — whether an
 * upholding decision taken from `UNDER_REVIEW` is a legal transition at all.
 * Both are **stated** next to the submit button and neither disables anything.
 * A screen that guessed here would either block a legal decision or promise a
 * resolution the backend then withholds, and the adjudicator would learn which
 * only from a refusal.
 *
 * ## One section open at a time
 *
 * `openSection` holds a single id, not a set. A half-composed decide note must
 * not sit hidden behind an expanded compensation form — these forms cause
 * different irreversible things, and two of them open at once is how the wrong
 * one gets submitted.
 *
 * ## Two error channels, split by origin
 *
 * Client-side validation renders **inline**, under the form it belongs to, so
 * it sits next to the field that is wrong. Server refusals go to a **toast**,
 * carrying the API's own `code · message` — an adjudicator quoting a refusal
 * into a ticket needs the backend's word for it, not ours.
 */

/*
  The two enums, listed once each so the "what would be needed" copy can be
  DERIVED from `may` / `isLegalInStatus` rather than re-stated by hand.

  `satisfies Record<…, 0>` is the guard: `state.ts` does not export its role or
  status tables, so these lists could otherwise drift silently. With the
  `satisfies`, a role or status added to `interfaces/operator.ts` and not added
  here fails the build instead of quietly shortening a sentence that tells an
  adjudicator which role they would need.
*/
const OPERATOR_ROLES = Object.keys({
  SRE: 0, ADJ: 0, ADJL: 0, POL: 0, POLA: 0, TRE: 0, TREA: 0,
  BD: 0, SUP: 0, CMP: 0, SEC: 0,
} satisfies Record<OperatorRole, 0>) as OperatorRole[];

const PROPOSAL_STATUSES = Object.keys({
  PROPOSED: 0, DISPUTED: 0, UNDER_REVIEW: 0, AWAITING_SECOND: 0,
  UPHELD: 0, OVERTURNED: 0, EXECUTING: 0, EXECUTED: 0,
  REVERSED: 0, WAIVED: 0, CANCEL_REQUESTED: 0, CANCELLED: 0,
} satisfies Record<SlashProposalStatus, 0>) as SlashProposalStatus[];

/** Which roles `may` this action — asked of `state.ts`, not copied from it. */
function rolesPermitting(action: OperatorAction): OperatorRole[] {
  return OPERATOR_ROLES.filter((role) => may([role], action));
}

/** Which statuses this action is legal in — asked of `state.ts`, not copied from it. */
function statusesAllowing(action: StatusGatedAction): SlashProposalStatus[] {
  return PROPOSAL_STATUSES.filter((status) => isLegalInStatus(action, status));
}

function joinWithOr(parts: readonly string[]): string {
  if (parts.length === 0) return "no status";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
}

interface Gate {
  /** True when the token's roles permit it. */
  permitted: boolean;
  /** True when the proposal's status permits it. */
  legal: boolean;
  /** Both gates. Only an offered action gets a section. */
  offered: boolean;
  /** Why it is not offered, in one sentence. Null when it is. */
  blockedBecause: string | null;
}

/** The panel's own label for each action, used in the "nothing is available" list. */
const ACTION_LABEL: Partial<Record<OperatorAction, string>> = {
  claim: "Claim",
  decide: "Decide",
  second: "Second",
  suspend: "Suspend",
  extendDeadline: "Extend deadline",
  sweep: "Open fleet sweep",
  compensate: "Compensate the provider",
  cancel: "Cancel the judgement on chain",
};

/** `AWAITING_SECOND` → "awaiting second". Same shape as `caseStatusLabel`, for outcomes. */
function outcomeLabel(outcome: string): string {
  return outcome.toLowerCase().replace(/_/g, " ");
}

/**
 * The seven booleans of `OUTCOME_CONSEQUENCE`, as sentences.
 *
 * This is the whole point of the decide form having a preview at all: the
 * adjudicator picks one of six labels and the platform then does seven
 * separate things, only one of which ("the penalty stands") is named in the
 * label. Money, the provider's strike record, routing weight, our own error
 * metric and the sampling rate all move off this single radio.
 *
 * The first four are stated in **both** polarities, because "the strikes are
 * cleared" and "the strikes stand" are equally consequential and an absent
 * line would read as an unanswered question. The last three are stated only
 * when true: they are additional things the decision sets in motion, and
 * "this does not open a fleet sweep" is noise on the four outcomes that never
 * could.
 */
function consequenceSentences(c: OutcomeConsequence): string[] {
  const lines: string[] = [
    c.penaltyStands
      ? "The penalty stands — the proposal executes and the provider's stake is slashed."
      : "The penalty does not stand — nothing is taken from the provider's stake.",
    c.recalculated
      ? "The amount is recalculated to the figure you enter below, and that figure is what executes."
      : "The amount is not recalculated — the proposed figure is the only one on record.",
    c.strikesStand
      ? "The window's strikes stand — the recorded failures stay on the provider's record."
      : "The window's strikes are cleared — the recorded failures come off the provider's record.",
    c.routingWeightStands
      ? "The binding's routing weight stands — routing is left as this window left it."
      : "The binding's routing weight is restored — the window's effect on routing is undone.",
  ];
  if (c.opensFleetSweep) {
    lines.push(
      "This opens a fleet sweep: the same defect can then be applied across every other case that shares it.",
    );
  }
  if (c.countsAsFalsePositive) {
    lines.push(
      "This counts against our own false-positive rate — it is recorded as the platform's error, not the provider's.",
    );
  }
  if (c.raisesSamplingToFull) {
    lines.push("Sampling on this binding rises to 100% until the evidence base can carry a conclusion.");
  }
  return lines;
}

export interface ActionPanelProps {
  brief: OperatorCaseBrief;
  proposalId: string;
}

export function ActionPanel({ brief, proposalId }: ActionPanelProps) {
  const identity = useOperatorSession();
  const roles = identity.roles;
  const queryClient = useQueryClient();
  /*
    Narrowed once. `SlashProposalSummary.status` is a bare `string`, and a
    status this build does not know must not be fed to `isLegalInStatus` —
    it would index the table with a missing key and read `undefined.includes`.
  */
  const status = asProposalStatus(brief.case.proposal.status);

  const [openSection, setOpenSection] = React.useState<OperatorAction | null>(null);
  /*
    One inline error for the whole panel, cleared on every open/close. Safe
    precisely BECAUSE only one section is open at a time: there is never a
    second form on screen for the message to be misread against.
  */
  const [formError, setFormError] = React.useState<string | null>(null);

  const [suspendReasonCode, setSuspendReasonCode] = React.useState("");
  const [suspendNote, setSuspendNote] = React.useState("");
  const [suspendTicketRef, setSuspendTicketRef] = React.useState("");

  const [decideOutcome, setDecideOutcome] = React.useState<ArbitrationOutcome | null>(null);
  const [decideReasonCodes, setDecideReasonCodes] = React.useState<string[]>([]);
  const [decideNote, setDecideNote] = React.useState("");
  const [decideAmount, setDecideAmount] = React.useState("");
  const [decideRootCauseKey, setDecideRootCauseKey] = React.useState("");
  const [decideTicketRef, setDecideTicketRef] = React.useState("");

  const [secondKind, setSecondKind] = React.useState<SecondSignatureBody["kind"] | null>(null);
  const [secondNote, setSecondNote] = React.useState("");

  const [extendHours, setExtendHours] = React.useState("");
  const [extendReasonCode, setExtendReasonCode] = React.useState("");
  const [extendNote, setExtendNote] = React.useState("");

  const [sweepDefectKey, setSweepDefectKey] = React.useState("");
  const [sweepLookbackHours, setSweepLookbackHours] = React.useState("");
  const [sweepReasonCode, setSweepReasonCode] = React.useState("");
  const [sweepNote, setSweepNote] = React.useState("");

  /*
    The two build-only flows. Each holds the intent the server built, plus
    whatever the browser has managed to do with it since.

    `compensationSignature` is a TEXT FIELD, not a derived value. The expected
    case is that the treasury's multisig signs somewhere else entirely and an
    operator pastes the signature back; the in-browser sign path merely fills
    the same field. One input, so the record step cannot behave differently
    depending on which route produced the signature.
  */
  const [compensation, setCompensation] = React.useState<CompensationIntent | null>(null);
  const [compensationSignature, setCompensationSignature] = React.useState("");
  /*
    The override-register paperwork, carried over from the `reverse` form this
    replaces. `compensated` is still row `S-5`: the chain signature says the
    money moved, these say why we accepted it and who agreed.
  */
  const [compensationReasonCode, setCompensationReasonCode] = React.useState("");
  const [compensationNote, setCompensationNote] = React.useState("");
  const [compensationTicketRef, setCompensationTicketRef] = React.useState("");
  const [cancelIntent, setCancelIntent] = React.useState<CancelIntent | null>(null);
  const [cancelSignature, setCancelSignature] = React.useState<string | null>(null);
  /** The wallet's own refusals, kept apart from `formError`'s validation channel. */
  /*
    "Sign as me" — there is no typed-in address to verify a signature against
    here, so the hook picks the connected wallet and the two build-only
    sections compare its address against the identity the server named. A
    console with no wallet at all is the normal case for an adjudicator: both
    sections still work, through copy.

    **The chain is `chainIdOf`, not `chainIdOfAccount`.** These two operator
    routes send a BARE base58 address, not a CAIP-10 account
    (`CompensationIntentDto.depositor`, `CancelIntentDto.admin`), so
    `chainIdOfAccount` would answer `null` for every real case and the sign
    button would never appear at all. `chainIdOf` is the same rule
    `runOperatorIntent` composes its payload with — the server's chain when an
    identity names one, this build's cluster otherwise — so the signer's
    binding and the payload's `chainId` are derived from one expression and
    cannot disagree.

    Declared immediately after the two intent states it reads, and BEFORE this
    component's early returns — `react-hooks/rules-of-hooks` is an error in
    this repo's config and it caught the first placement, which sat after
    `if (!status) return`.
  */
  const signerState = useSigner({
    chainId: chainIdOf(compensation?.depositor ?? cancelIntent?.admin ?? ""),
  });

  const [signError, setSignError] = React.useState<string | null>(null);
  const [signing, setSigning] = React.useState(false);

  /*
    ONE approver token, for `sweep` and for the record step of `compensate`.

    It belongs to a different person than the one signed in, and it is the
    only credential this screen ever holds that is not the session's own. It
    lives here and nowhere else: no `localStorage`, no query cache, no query
    key, no log line, no toast echo, and no mutation variable. The `mutationFn`
    below close over this value rather than receiving it, because react-query
    keeps `variables` on the mutation object after the call settles — a place a
    credential must not be readable from.
  */
  const [approverToken, setApproverToken] = React.useState("");

  /*
    Cleared when the panel unmounts.

    React drops component state on unmount by itself, so this is the second
    line rather than the only one — but it is the line that also runs on a Fast
    Refresh remount in development, and it is the one a reader can point at.
    A credential belonging to another person must not outlive the form that
    collected it.
  */
  React.useEffect(() => () => setApproverToken(""), []);

  /*
    Toggling ANY section drops the approver token too.

    Only one section is open at a time, so a token pasted into the sweep form
    and left there would be submitted, unseen, by the compensation form — a
    two-person control silently reusing an approval given for something else.
  */
  const toggleSection = React.useCallback((action: OperatorAction) => {
    setFormError(null);
    setSignError(null);
    setApproverToken("");
    setOpenSection((current) => (current === action ? null : action));
  }, []);

  /*
    Changing the outcome CLEARS the ticked codes.

    `REASON_CODES` is keyed by outcome and the backend validates the pair: a
    code ticked under `UPHELD` and left ticked after switching to
    `OVERTURNED_GRIEFING` is a guaranteed 422, and the adjudicator would be
    reading a refusal about a box they can no longer see. The amount goes with
    it — it only exists for `UPHELD_RECALCULATED`, and a figure typed against
    one outcome must not be submitted under another.
  */
  const chooseOutcome = React.useCallback((outcome: ArbitrationOutcome) => {
    setDecideOutcome(outcome);
    setDecideReasonCodes([]);
    if (outcome !== "UPHELD_RECALCULATED") setDecideAmount("");
    setFormError(null);
  }, []);

  const toggleReasonCode = React.useCallback((code: string) => {
    setDecideReasonCodes((current) =>
      current.includes(code) ? current.filter((c) => c !== code) : [...current, code],
    );
  }, []);

  /*
    INVALIDATE, never `setQueryData`.

    Elsewhere in this app you will find responses seeded straight into the
    cache, because those routes are HTTP-cached server-side for ~10s and an
    invalidate would refetch the stale copy it just wrote past. Neither holds
    on `/operator/*`: nothing is cached, and no action's response has the shape
    of the case summary — `claim` and `suspend` return the proposal, not
    `{ case, dispute, timeline, restoration }`. Seeding would install a wrong
    object under the case summary's key and every field on the screen would be read
    off it.
  */
  const invalidateCase = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["operator", "case", proposalId] });
    queryClient.invalidateQueries({ queryKey: ["operator", "queue"] });
  }, [queryClient, proposalId]);

  const authorityLimit = identity.authorityLimit;
  const casePenalty = brief.case.proposal.penaltyAmount;

  /** The server channel. Every mutation in this file, in 7a, 7b and 7c, uses it. */
  const reportError = React.useCallback(
    (e: unknown) => {
      if (!(e instanceof ApiError)) {
        toast.error("The action could not be completed.");
        return;
      }
      /*
        The one refusal restated here. The API's message carries both amounts
        as raw minor units with no currency ("of 0, requested 28470000"), which
        is not something an operator can read a decision off. The code stays,
        so the refusal can still be quoted into a ticket.
      */
      if (e.code === "OPERATOR_AUTHORITY_EXCEEDED" && authorityLimit) {
        toast.error(
          `${e.code} · This action is above your authority limit: ${authorityRefusal(authorityLimit, casePenalty)}.`,
        );
        return;
      }
      /*
        Only the cancel build meets this: on EVM Assay builds `cancelSlash`
        for the arbiter alone, so with none appointed there is nothing to build.
      */
      if (e.code === "CHAIN_ARBITER_NOT_SET") {
        toast.error(arbiterErrorMessage(e, "cancel"));
        return;
      }
      toast.error(`${e.code} · ${e.message}`);
    },
    [authorityLimit, casePenalty],
  );

  const claim = useMutation({
    mutationFn: () => claimCase(proposalId),
    onSuccess: () => {
      toast.success("Case assigned to you.");
      invalidateCase();
    },
    onError: reportError,
  });

  const suspend = useMutation({
    /*
      Same rule as the sweep: the approver token is closed over, not a
      mutation variable, so it never sits in the mutation cache. Sent only in
      the statuses where the backend needs it.
    */
    mutationFn: (body: SuspendProposalBody) =>
      suspendCase(
        proposalId,
        body,
        status && suspendNeedsApprover(status) ? approverToken.trim() : undefined,
      ),
    onSuccess: () => {
      /*
        A suspension closes the case and only REQUESTS the on-chain cancel. The
        record stands until the settlement admin signs, so the confirmation
        says so instead of reading as finished. `brief.chainStatus` is still the
        status from before the suspension here — the refetch below replaces it.
      */
      toast.success(suspendedNotice(brief.chainStatus));
      setOpenSection(null);
      setFormError(null);
      setSuspendReasonCode("");
      setSuspendNote("");
      setSuspendTicketRef("");
      setApproverToken("");
      invalidateCase();
    },
    onError: reportError,
  });

  const decide = useMutation({
    mutationFn: (body: DecideCaseBody) => decideCase(proposalId, body),
    onSuccess: () => {
      /*
        NO outcome is asserted here.

        Where this decision lands is a server-side question: a penalty at or
        above the materiality threshold — a figure this app cannot read — or
        any sweep-opening outcome defers to a second signature and leaves the
        case `AWAITING_SECOND` instead of resolving it. "Case upheld" would be
        wrong on exactly the cases where being wrong matters most. The
        refetched brief is the only honest answer, so the toast points at it.
      */
      toast.success("Decision recorded. The case now shows where it landed.");
      setOpenSection(null);
      setFormError(null);
      setDecideOutcome(null);
      setDecideReasonCodes([]);
      setDecideNote("");
      setDecideAmount("");
      setDecideRootCauseKey("");
      setDecideTicketRef("");
      invalidateCase();
    },
    onError: reportError,
  });

  const second = useMutation({
    mutationFn: (body: SecondSignatureBody) => secondCase(proposalId, body),
    onSuccess: () => {
      toast.success("Second signature recorded.");
      setOpenSection(null);
      setFormError(null);
      setSecondKind(null);
      setSecondNote("");
      invalidateCase();
    },
    onError: reportError,
  });

  const extend = useMutation({
    mutationFn: (body: ExtendDeadlineBody) => extendCaseDeadline(proposalId, body),
    onSuccess: () => {
      toast.success("Provider deadline extended.");
      setOpenSection(null);
      setFormError(null);
      setExtendHours("");
      setExtendReasonCode("");
      setExtendNote("");
      invalidateCase();
    },
    onError: reportError,
  });

  /*
    The approver token is NOT a mutation variable — `mutationFn` closes over
    the state, which `useMutation` re-reads on every render. Passing it as a
    variable would park another operator's credential on `sweep.variables`,
    readable for as long as this component lives.
  */
  const sweep = useMutation({
    mutationFn: (body: OpenFleetSweepBody) =>
      openFleetSweep(proposalId, body, approverToken.trim()),
    onSuccess: (result) => {
      /*
        BOTH counts, always.

        They differ whenever a match was already decided the same way, and a
        re-run of an already-applied sweep reports `matched: 14, applied: 0`.
        Reporting only `appliedCount` would make that read as inert; reporting
        only `matchedCount` would claim fourteen cases moved when none did.
      */
      toast.success(
        `Fleet sweep opened — ${result.matchedCount} matched, ${result.appliedCount} applied.`,
      );
      setOpenSection(null);
      setFormError(null);
      setSweepDefectKey("");
      setSweepLookbackHours("");
      setSweepReasonCode("");
      setSweepNote("");
      setApproverToken("");
      invalidateCase();
    },
    onError: reportError,
  });

  /*
    BUILD, not act. Nothing has happened on chain when this resolves — the
    toast says so in as many words, because "compensation built" and
    "compensation paid" are one word apart and a reasonable operator would
    otherwise close the case here.
  */
  const buildCompensation = useMutation({
    mutationFn: () => createCompensationIntent(proposalId),
    onSuccess: (result) => {
      setCompensation(result);
      setCompensationSignature("");
      setSignError(null);
      setFormError(null);
      toast.success("Transaction built. Nothing has been paid yet — the treasury must sign it.");
    },
    onError: reportError,
  });

  /*
    The approver token is NOT a mutation variable here either — same reason as
    `sweep`: react-query keeps `variables` on the mutation object after the
    call settles, and another person's credential must not be readable from
    there. The `mutationFn` closes over the state instead.
  */
  const confirmCompensation = useMutation({
    mutationFn: (body: RecordCompensationBody) =>
      recordCompensation(proposalId, body, approverToken.trim()),
    onSuccess: () => {
      toast.success("Deposit verified on chain. The case is now recorded as compensated.");
      setOpenSection(null);
      setFormError(null);
      setSignError(null);
      setCompensation(null);
      setCompensationSignature("");
      setCompensationReasonCode("");
      setCompensationNote("");
      setCompensationTicketRef("");
      setApproverToken("");
      invalidateCase();
    },
    onError: reportError,
  });

  const buildCancel = useMutation({
    mutationFn: () => createCancelIntent(proposalId),
    onSuccess: (result) => {
      setCancelIntent(result);
      setCancelSignature(null);
      setSignError(null);
      setFormError(null);
      toast.success(
        result.to
          ? "Transaction built. The judgement is still live until the arbiter signs it."
          : "Transaction built. The judgement is still live until the admin signs it.",
      );
    },
    onError: reportError,
  });

  if (!status) {
    return (
      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Actions</PanelTitle>
            <PanelDescription>what this token may do to this case</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          <p className="text-body-13 text-02">
            This case reports status{" "}
            <span className="font-mono text-mono-13 text-01">{brief.case.proposal.status}</span>,
            which this build does not recognise. No action is offered, because nothing here can
            say which transitions that status allows.
          </p>
        </PanelBody>
      </Panel>
    );
  }

  /** Both gates plus the sentence for failing either. Every action goes through this. */
  const gate = (action: StatusGatedAction): Gate => {
    const permitted = may(roles, action);
    const legal = isLegalInStatus(action, status);
    let blockedBecause: string | null = null;
    if (!permitted) {
      blockedBecause = `needs ${joinWithOr(rolesPermitting(action))}; this token holds ${
        roles.length > 0 ? roles.join(", ") : "no roles"
      }`;
    } else if (!legal) {
      blockedBecause = `not legal while the case is ${caseStatusLabel(status)} — allowed in ${joinWithOr(
        statusesAllowing(action).map(caseStatusLabel),
      )}`;
    }
    return { permitted, legal, offered: permitted && legal, blockedBecause };
  };

  /*
    The authority limit, read off `GET /operator/me`.

    `suspend` and `second` are checked by the backend against the case's
    penalty, so a penalty above the limit is a refusal this screen can already
    see — an SRE with a limit of 0 was offered a Suspend form that could never
    succeed. Both are withheld with the reason. `decide` is not withheld: a
    recalculated amount may be within the limit when the penalty is not, so it
    is checked at submit against the amount the decision would bind.
  */
  const overAuthority = exceedsAuthority(authorityLimit, casePenalty.amount);
  const withinAuthority = (base: Gate): Gate =>
    base.offered && overAuthority && authorityLimit
      ? {
          ...base,
          offered: false,
          blockedBecause: `above this token's authority limit — ${authorityRefusal(authorityLimit, casePenalty)}`,
        }
      : base;

  const claimGate = gate("claim");
  const decideGate = gate("decide");
  const secondGate = withinAuthority(gate("second"));
  const suspendGate = withinAuthority(gate("suspend"));

  /*
    `extendDeadline` is the one action with a THIRD gate, and it is not a role
    or a status.

    The backend extends `clocks.respondByAt`, and that column is null until a
    notification channel confirms delivery. `PROPOSED` with a null
    `respondByAt` is therefore legal by the state machine and impossible in
    fact: there is no provider deadline to push. Offering the form there would
    take a composed note and a reason code and answer with a refusal the
    screen already had the data to predict, so it is withheld with that
    sentence instead.
  */
  const providerDeadline = brief.case.proposal.clocks.respondByAt;
  const baseExtendGate = gate("extendDeadline");
  const extendGate: Gate =
    baseExtendGate.offered && providerDeadline === null
      ? {
          ...baseExtendGate,
          offered: false,
          blockedBecause:
            "there is no provider deadline to extend — this proposal has no respond-by date, so nothing is running against the provider",
        }
      : baseExtendGate;

  const compensateGate = gate("compensate");

  /*
    `cancel` is gated on the on-chain record, not the case status: that is the
    one thing the backend's cancel-intent guard checks, and an overturned case
    waiting for the settlement admin still reads OVERTURNED.
  */
  const cancelPermitted = may(roles, "cancel");
  const cancelLegal = isCancelRequested(brief.chainStatus);
  let cancelBlockedBecause: string | null = null;
  if (!cancelPermitted) {
    cancelBlockedBecause = `needs ${joinWithOr(rolesPermitting("cancel"))}; this token holds ${
      roles.length > 0 ? roles.join(", ") : "no roles"
    }`;
  } else if (!cancelLegal) {
    cancelBlockedBecause = `only while the on-chain record is waiting for its cancel (${chainStatusLabel("CANCEL_REQUESTED")}) — it is ${chainStatusLabel(brief.chainStatus)}`;
  }
  /*
    Shown to every operator on the case, not only the roles that may build the
    cancel: whoever suspended or overturned it has to know the on-chain record
    is still standing and when it becomes anyone's to execute.
  */
  const cancelDeadline = cancelDeadlineNotice(
    brief.chainStatus,
    brief.chainExecutableAt,
    new Date(),
  );
  const cancelGate: Gate = {
    permitted: cancelPermitted,
    legal: cancelLegal,
    offered: cancelPermitted && cancelLegal,
    blockedBecause: cancelBlockedBecause,
  };

  /*
    `sweep` is gated on the OUTCOME, not the status — the only action here
    that is, and the reason `isLegalInStatus` deliberately does not accept
    `"sweep"` (asking it does not type-check).

    The backend's `openSweep` checks only whether the source case's outcome
    opens a fleet sweep and never looks at the status. A status gate would be
    wrong in both directions:

     - it would OFFER `AWAITING_SECOND`, where the proposal's `outcome` is
       still null — `decide` keeps the decision on the dispute until the
       second signature lands — so `openSweep` refuses there too;
     - it would OFFER `UPHELD`, which only the two upholding outcomes produce,
       and neither of those opens a sweep. The section would render and the
       submit would 422 every time.

    `Gate.legal` therefore carries "this outcome opens a fleet sweep" for this
    one action — the same question, asked one step to the left of the status.
  */
  const sourceOutcome = brief.case.proposal.outcome;
  const sweepPermitted = may(roles, "sweep");
  const sweepLegal = isSweepable(sourceOutcome);
  const sweepBlockedBecause = (): string | null => {
    if (!sweepPermitted) {
      return `needs ${joinWithOr(rolesPermitting("sweep"))}; this token holds ${
        roles.length > 0 ? roles.join(", ") : "no roles"
      }`;
    }
    if (sourceOutcome === null) {
      return "this case has no outcome yet — a fleet sweep is opened from a decided case's finding, and nothing has been decided here";
    }
    if (!sweepLegal) {
      return `the outcome ${outcomeLabel(sourceOutcome)} does not open a fleet sweep — only ${joinWithOr(
        SWEEPABLE_OUTCOMES.map(outcomeLabel),
      )} do, because only those are findings about us`;
    }
    return null;
  };
  const sweepGate: Gate = {
    permitted: sweepPermitted,
    legal: sweepLegal,
    offered: sweepPermitted && sweepLegal,
    blockedBecause: sweepBlockedBecause(),
  };

  /*
    The sweep's reason code comes from the SOURCE case's outcome.

    `REASON_CODES` is keyed by outcome and the backend validates the pair, so
    the field is free text bounded at 64 characters but the hint names the
    codes that will actually be accepted. Only a sweepable outcome reaches
    here, so the empty fallback is for the type, not for a real case.
  */
  const sweepReasonCodes: readonly string[] =
    sourceOutcome !== null && sourceOutcome in REASON_CODES
      ? REASON_CODES[sourceOutcome as ArbitrationOutcome]
      : [];

  const gates: ReadonlyArray<readonly [OperatorAction, Gate]> = [
    ["claim", claimGate],
    ["decide", decideGate],
    ["second", secondGate],
    ["suspend", suspendGate],
    ["extendDeadline", extendGate],
    ["sweep", sweepGate],
    ["compensate", compensateGate],
    ["cancel", cancelGate],
  ];
  const offered = gates.filter(([, g]) => g.offered);
  /* Withheld for the authority limit alone — said even when other actions are offered. */
  const withheldForAuthority = overAuthority
    ? gates.filter(
        ([action, g]) =>
          (action === "second" || action === "suspend") && g.permitted && g.legal && !g.offered,
      )
    : [];

  /*
    Claiming reads like one action but is two different ones. On `DISPUTED` it
    also advances the proposal to `UNDER_REVIEW`; on the two later statuses it
    only changes the owner. One sentence covering both would be wrong on one of
    them, so it is derived from the status.
  */
  const claimDescription =
    status === "DISPUTED"
      ? "Assigns the case to you and moves it to under review — claiming from disputed is itself the transition."
      : "Reassigns the case to you. The status does not change; only the named owner does.";

  const suspendNoteLength = suspendNote.trim().length;

  const submitSuspend = () => {
    if (suspendReasonCode.trim().length === 0) {
      setFormError("A reason code is required.");
      return;
    }
    if (suspendNoteLength < SHORT_NOTE_MIN_LENGTH) {
      setFormError(
        `The note must be at least ${SHORT_NOTE_MIN_LENGTH} characters — it is ${suspendNoteLength}.`,
      );
      return;
    }
    if (status && suspendNeedsApprover(status) && approverToken.trim().length === 0) {
      setFormError(
        "A second operator's token is required: this case has been upheld or is awaiting a "
        + "second signature, so it cannot be suspended alone.",
      );
      return;
    }
    setFormError(null);
    suspend.mutate({
      note: suspendNote.trim(),
      reasonCode: suspendReasonCode.trim(),
      // An empty optional string is NOT an absent one: `""` would be written
      // into the override register as a ticket reference that resolves to
      // nothing.
      ticketRef: suspendTicketRef.trim() || undefined,
    });
  };

  const penalty = brief.case.proposal.penaltyAmount;
  const decideNoteLength = decideNote.trim().length;
  const outcomeCodes = decideOutcome ? REASON_CODES[decideOutcome] : [];
  const consequence = decideOutcome ? OUTCOME_CONSEQUENCE[decideOutcome] : null;
  const isRecalculated = decideOutcome === "UPHELD_RECALCULATED";
  /*
    The one warning that is CONDITIONAL on both sides of the form. `decide` is
    legal in `UNDER_REVIEW`, but the backend's state machine has no
    `UNDER_REVIEW → UPHELD` edge; the only way an upholding decision survives
    from there is if it defers to a second signature and lands in
    `AWAITING_SECOND` instead. Which of the two happens depends on the
    materiality threshold, which is server configuration. So the option stays
    selectable and the possibility is stated.
  */
  const upholdFromUnderReview =
    status === "UNDER_REVIEW" &&
    (decideOutcome === "UPHELD" || decideOutcome === "UPHELD_RECALCULATED");

  const submitDecide = () => {
    if (!decideOutcome) {
      setFormError("Choose an outcome.");
      return;
    }
    if (decideReasonCodes.length === 0) {
      setFormError("At least one reason code is required.");
      return;
    }
    const stray = decideReasonCodes.filter((code) => !outcomeCodes.includes(code));
    if (stray.length > 0) {
      setFormError(
        `${stray.join(", ")} ${stray.length === 1 ? "is not a reason code" : "are not reason codes"} for this outcome.`,
      );
      return;
    }
    if (decideNoteLength < DECISION_NOTE_MIN_LENGTH) {
      setFormError(
        `The note must be at least ${DECISION_NOTE_MIN_LENGTH} characters — it is ${decideNoteLength}.`,
      );
      return;
    }
    const amount = decideAmount.trim();
    if (isRecalculated) {
      if (amount.length === 0) {
        setFormError("A recalculated amount is required for this outcome.");
        return;
      }
      if (!RECALCULATED_AMOUNT_PATTERN.test(amount)) {
        setFormError(
          "The recalculated amount must be a positive whole number of minor units — digits only, no decimal point, no leading zero.",
        );
        return;
      }
      /*
        An adjudication may REDUCE a penalty and may never raise one. Compared
        as `BigInt`, not as a number: minor units on a 6-decimal asset pass
        2^53 at ~9 billion units, and the comparison that decides whether an
        operator can increase a slash is not one to run through a float.
      */
      if (BigInt(amount) > BigInt(penalty.amount)) {
        setFormError(
          `The recalculated amount may not exceed the proposed ${penalty.amount} minor units. An adjudication may reduce a penalty; it may never raise one.`,
        );
        return;
      }
    }
    /*
      The amount the backend checks this decision against: the recalculated
      figure when there is one, the proposed penalty otherwise.
    */
    const bindingAmount = isRecalculated ? { ...penalty, amount } : penalty;
    if (authorityLimit && exceedsAuthority(authorityLimit, bindingAmount.amount)) {
      setFormError(
        `This decision is above your authority limit — ${authorityRefusal(authorityLimit, bindingAmount)}. It needs an operator with a higher limit.`,
      );
      return;
    }
    setFormError(null);
    decide.mutate({
      outcome: decideOutcome,
      reasonCodes: decideReasonCodes,
      note: decideNote.trim(),
      rootCauseKey: decideRootCauseKey.trim() || undefined,
      ticketRef: decideTicketRef.trim() || undefined,
      recalculatedAmount: isRecalculated ? amount : undefined,
    });
  };

  const secondNoteLength = secondNote.trim().length;

  const submitSecond = () => {
    if (!secondKind) {
      setFormError("Choose whether you are signing or objecting.");
      return;
    }
    if (secondNoteLength < SHORT_NOTE_MIN_LENGTH) {
      setFormError(
        `The note must be at least ${SHORT_NOTE_MIN_LENGTH} characters — it is ${secondNoteLength}.`,
      );
      return;
    }
    setFormError(null);
    second.mutate({ kind: secondKind, note: secondNote.trim() });
  };

  const extendNoteLength = extendNote.trim().length;

  const submitExtend = () => {
    const hours = Number(extendHours.trim());
    if (extendHours.trim().length === 0 || !Number.isInteger(hours) || hours < 1 || hours > 336) {
      setFormError("Additional hours must be a whole number between 1 and 336.");
      return;
    }
    if (extendReasonCode.trim().length === 0) {
      setFormError("A reason code is required.");
      return;
    }
    if (extendNoteLength < SHORT_NOTE_MIN_LENGTH) {
      setFormError(
        `The note must be at least ${SHORT_NOTE_MIN_LENGTH} characters — it is ${extendNoteLength}.`,
      );
      return;
    }
    setFormError(null);
    extend.mutate({
      additionalHours: hours,
      note: extendNote.trim(),
      reasonCode: extendReasonCode.trim(),
    });
  };

  /*
    Trimmed for the presence check, and trimmed again in the `mutationFn` that
    sends it: surrounding whitespace on a pasted bearer token is a paste
    artefact, and a token that looks present here must be the token that goes
    on the wire.
  */
  const approverTokenValue = approverToken.trim();
  const sweepNoteLength = sweepNote.trim().length;

  const submitSweep = () => {
    if (sweepDefectKey.trim().length === 0) {
      setFormError("A defect key is required — it is what identifies the bindings to sweep.");
      return;
    }
    const lookback = Number(sweepLookbackHours.trim());
    if (
      sweepLookbackHours.trim().length === 0 ||
      !Number.isInteger(lookback) ||
      lookback < 1 ||
      lookback > 2160
    ) {
      setFormError("Lookback must be a whole number of hours between 1 and 2160 (ninety days).");
      return;
    }
    if (sweepReasonCode.trim().length === 0) {
      setFormError("A reason code is required.");
      return;
    }
    if (sweepNoteLength < DECISION_NOTE_MIN_LENGTH) {
      setFormError(
        `The note must be at least ${DECISION_NOTE_MIN_LENGTH} characters — it is ${sweepNoteLength}.`,
      );
      return;
    }
    if (approverTokenValue.length === 0) {
      setFormError("A second operator's token is required. This action cannot be taken alone.");
      return;
    }
    setFormError(null);
    sweep.mutate({
      defectKey: sweepDefectKey.trim(),
      lookbackHours: lookback,
      note: sweepNote.trim(),
      reasonCode: sweepReasonCode.trim(),
    });
  };

  /*
    Signing here is the convenience path, and it is offered only when the
    wallet connected in this browser IS the key the bytes name — the treasury
    for a compensation, `Config.admin` for a cancellation. Anything else and
    the operator copies the base64 to wherever that key actually lives, which
    is the expected case for both: a multisig ceremony and a hardware wallet.

    The signer is bound to one chain and `signAndSend` refuses a payload for
    another before the wallet is touched, so a chain mismatch is a thrown
    sentence rather than a prompt the operator approves and a transaction that
    fails on the wrong network.
  */
  const walletAddress = signerState.status === "ready" ? signerState.signer.address : null;
  const holdsTreasuryKey =
    walletAddress !== null && compensation !== null
    && signerIsHolder(walletAddress, compensation.depositor);
  const holdsAdminKey =
    walletAddress !== null && cancelIntent !== null
    && signerIsHolder(walletAddress, cancelIntent.admin);

  const signHere = async (
    transaction: string,
    identity: string,
    onSigned: (signature: string) => void,
  ) => {
    if (signerState.status !== "ready") {
      setSignError("Connect the wallet that holds this key to sign here.");
      return;
    }
    setSignError(null);
    setSigning(true);
    try {
      const { signature } = await runOperatorIntent(transaction, identity, signerState.signer);
      onSigned(signature);
    } catch (e) {
      if (isUserRejection(e)) {
        setSignError("Nothing was signed — the wallet prompt was closed or declined.");
      } else {
        setSignError(e instanceof Error ? e.message : "The wallet did not complete this.");
      }
    } finally {
      setSigning(false);
    }
  };

  const compensationNoteLength = compensationNote.trim().length;

  const submitCompensated = () => {
    const signature = compensationSignature.trim();
    if (signature.length === 0) {
      setFormError(
        "Paste the confirmed transaction signature. The platform verifies the deposit on chain "
          + "before it records anything, so there is nothing to submit without one.",
      );
      return;
    }
    if (compensationReasonCode.trim().length === 0) {
      setFormError("A reason code is required.");
      return;
    }
    if (compensationNoteLength < SHORT_NOTE_MIN_LENGTH) {
      setFormError(
        `The note must be at least ${SHORT_NOTE_MIN_LENGTH} characters — it is ${compensationNoteLength}.`,
      );
      return;
    }
    if (approverTokenValue.length === 0) {
      setFormError("A second operator's token is required. This action cannot be taken alone.");
      return;
    }
    setFormError(null);
    confirmCompensation.mutate({
      signature,
      note: compensationNote.trim(),
      reasonCode: compensationReasonCode.trim(),
      // An empty optional string is NOT an absent one: `""` would be written
      // into the override register as a ticket reference resolving to nothing.
      ticketRef: compensationTicketRef.trim() || undefined,
    });
  };

  return (
    <Panel className="w-full">
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>Actions</PanelTitle>
          <PanelDescription>
            what this token may do to this case, given its roles and the case&rsquo;s status
          </PanelDescription>
        </PanelTitles>
      </PanelHeader>
      <PanelBody className="p-4 tablet:p-5">
        {cancelDeadline ? (
          <div
            role="alert"
            className={cn(
              "mb-3 flex w-full flex-col gap-1 rounded-md border p-3",
              cancelDeadline.overdue
                ? "border-danger-20 bg-danger-10"
                : "border-warning-20 bg-warning-10",
            )}
          >
            <p
              className={cn(
                "text-label-13",
                cancelDeadline.overdue ? "text-danger-600" : "text-warning-600",
              )}
            >
              The on-chain cancel has been requested, not signed
            </p>
            <p className="text-body-xs text-02">{cancelDeadline.text}</p>
          </div>
        ) : null}
        {offered.length === 0 ? (
          <div className="flex w-full flex-col gap-2">
            <p className="text-body-13 text-02">
              No action is available on this case from this token.
            </p>
            <ul className="flex w-full flex-col gap-1">
              {gates.map(([action, g]) => (
                <li key={action} className="text-body-xs text-03">
                  <span className="text-02">{ACTION_LABEL[action] ?? action}</span> —{" "}
                  {g.blockedBecause}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex w-full flex-col">
            {withheldForAuthority.length > 0 ? (
              <ul className="flex w-full flex-col gap-1 pb-3">
                {withheldForAuthority.map(([action, g]) => (
                  <li key={action} className="text-body-xs text-03">
                    <span className="text-02">{ACTION_LABEL[action] ?? action}</span> is not
                    offered — {g.blockedBecause}
                  </li>
                ))}
              </ul>
            ) : null}
            {claimGate.offered ? (
              <Section
                title="Claim"
                description={claimDescription}
                open={openSection === "claim"}
                onToggle={() => toggleSection("claim")}
              >
                <Button
                  type="button"
                  loading={claim.isPending}
                  onClick={() => claim.mutate()}
                  className="self-start"
                >
                  Claim this case
                </Button>
              </Section>
            ) : null}

            {decideGate.offered ? (
              <Section
                title="Decide"
                description="Records the arbitration outcome. Money follows from this: an upheld proposal executes against the provider's stake."
                open={openSection === "decide"}
                onToggle={() => toggleSection("decide")}
              >
                <fieldset className="flex w-full flex-col gap-2">
                  <legend className="pb-2 text-label-13 text-01">Outcome</legend>
                  {ALL_OUTCOMES.map((outcome) => (
                    <Radio
                      key={outcome}
                      name="decide-outcome"
                      value={outcome}
                      checked={decideOutcome === outcome}
                      onChange={() => chooseOutcome(outcome)}
                      label={OUTCOME_LABEL[outcome]}
                    />
                  ))}
                </fieldset>

                {consequence ? (
                  <div className="flex w-full flex-col gap-1.5 rounded-md border border-01 bg-02 p-3">
                    <p className="text-label-13 text-01">What this outcome causes</p>
                    <ul className="flex w-full flex-col gap-1">
                      {consequenceSentences(consequence).map((sentence) => (
                        <li key={sentence} className="text-body-xs text-02">
                          {sentence}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {decideOutcome ? (
                  <fieldset className="flex w-full flex-col gap-2">
                    <legend className="pb-2 text-label-13 text-01">Reason codes</legend>
                    {outcomeCodes.map((code) => (
                      <Checkbox
                        key={code}
                        value={code}
                        checked={decideReasonCodes.includes(code)}
                        onChange={() => toggleReasonCode(code)}
                        label={<span className="font-mono text-mono-13">{code}</span>}
                      />
                    ))}
                    <p className="pt-1 text-body-xs text-03">
                      Valid for the selected outcome only. Changing the outcome clears these.
                    </p>
                  </fieldset>
                ) : null}

                <NoteBox
                  id="decide-note"
                  label="Note"
                  value={decideNote}
                  onChange={setDecideNote}
                  minLength={DECISION_NOTE_MIN_LENGTH}
                  placeholder="The reasoning. This is what the provider, and the next reader of this case, will be shown."
                />

                {isRecalculated ? (
                  <Field
                    label="Recalculated amount"
                    value={decideAmount}
                    onChange={(e) => setDecideAmount(e.target.value)}
                    inputMode="numeric"
                    maxLength={32}
                    placeholder={penalty.amount}
                    /*
                      NOT `penalty.asset`: that is a chain-scoped id
                      (`solana:…/token:…`), and `symbolForAsset` exists
                      precisely to say it is not a symbol and must not be
                      shown. The unit that matters in this box is the scale.
                    */
                    suffix="minor units"
                    hint={`Digits only, in minor units. The proposal is ${penalty.amount} (${formatMoney(penalty)}) and this may not exceed it — an adjudication may reduce a penalty, never raise one.`}
                  />
                ) : null}

                <Field
                  label="Root cause key (optional)"
                  value={decideRootCauseKey}
                  onChange={(e) => setDecideRootCauseKey(e.target.value)}
                  maxLength={128}
                  placeholder="e.g. MAPPING_REGRESSION_2026_08"
                  hint="Groups this case with others sharing the cause."
                />
                <Field
                  label="Ticket reference (optional)"
                  value={decideTicketRef}
                  onChange={(e) => setDecideTicketRef(e.target.value)}
                  maxLength={128}
                  placeholder="e.g. OPS-1187"
                />

                {upholdFromUnderReview ? (
                  <div className="flex w-full flex-col gap-1 rounded-md border border-warning-20 bg-warning-10 p-3">
                    <p className="text-label-13 text-warning-600">
                      Under review cannot reach upheld directly
                    </p>
                    <p className="text-body-xs text-02">
                      The platform&rsquo;s state machine has no transition from under review
                      straight to upheld. An upholding decision is accepted from here{" "}
                      <strong className="text-01">only</strong> if a second signature turns out to
                      be required, in which case the case moves to awaiting second. If one is not
                      required, the platform refuses this as an invalid transition and the refusal
                      appears as a toast, unchanged. Only the server can say which of the two
                      happens, so the choice is left to you.
                    </p>
                  </div>
                ) : null}

                <div className="flex w-full flex-col gap-1 rounded-md border border-01 bg-02 p-3">
                  <p className="text-label-13 text-01">This may not resolve the case</p>
                  <p className="text-body-xs text-02">
                    A penalty at or above the materiality threshold — or any outcome that opens a
                    fleet sweep — needs a second operator&rsquo;s signature. That threshold is
                    server-side configuration this console cannot read, so this screen cannot tell
                    you which case this is. If a second signature is required, deciding moves the
                    case to awaiting second rather than resolving it, and nothing executes until
                    another operator signs.
                  </p>
                </div>

                {formError ? <p className="text-body-xs text-danger-600">{formError}</p> : null}
                <Button
                  type="button"
                  loading={decide.isPending}
                  onClick={submitDecide}
                  className="self-start"
                >
                  Record decision
                </Button>
              </Section>
            ) : null}

            {secondGate.offered ? (
              <Section
                title="Second"
                description="The second signature on a decision already taken. Signing releases it; objecting sends it back for an independent read."
                open={openSection === "second"}
                onToggle={() => toggleSection("second")}
              >
                <fieldset className="flex w-full flex-col gap-2">
                  <legend className="pb-2 text-label-13 text-01">Your signature</legend>
                  <Radio
                    name="second-kind"
                    value="SIGNED"
                    checked={secondKind === "SIGNED"}
                    onChange={() => {
                      setSecondKind("SIGNED");
                      setFormError(null);
                    }}
                    label="Signed — I agree with the decision as recorded"
                  />
                  <Radio
                    name="second-kind"
                    value="OBJECTED"
                    checked={secondKind === "OBJECTED"}
                    onChange={() => {
                      setSecondKind("OBJECTED");
                      setFormError(null);
                    }}
                    label="Objected — this should not be released as it stands"
                  />
                </fieldset>
                <NoteBox
                  id="second-note"
                  label="Note"
                  value={secondNote}
                  onChange={setSecondNote}
                  minLength={SHORT_NOTE_MIN_LENGTH}
                  placeholder="What you checked, and what you concluded."
                />
                <p className="text-body-xs text-03">
                  An objection does not overturn the first decision — it returns the case to under
                  review for an independent reader.
                </p>
                <p className="text-body-xs text-03">
                  The operator who decided a case cannot second it. The platform will refuse this
                  if you are that operator.
                </p>
                {formError ? <p className="text-body-xs text-danger-600">{formError}</p> : null}
                <Button
                  type="button"
                  loading={second.isPending}
                  onClick={submitSecond}
                  className="self-start"
                >
                  Record signature
                </Button>
              </Section>
            ) : null}

            {suspendGate.offered ? (
              <Section
                title="Suspend"
                description="Cancels the proposal. Not a pause and not reversible from here: the penalty is dropped and the case ends as cancelled. If a record already stands on chain, its cancel is requested — and it is not cancelled until the settlement admin signs."
                open={openSection === "suspend"}
                onToggle={() => toggleSection("suspend")}
              >
                <Field
                  label="Reason code"
                  value={suspendReasonCode}
                  onChange={(e) => setSuspendReasonCode(e.target.value)}
                  maxLength={64}
                  placeholder="e.g. DUPLICATE_PROPOSAL"
                  hint="Free text, up to 64 characters. Written to the override register verbatim."
                />
                <NoteBox
                  id="suspend-note"
                  label="Note"
                  value={suspendNote}
                  onChange={setSuspendNote}
                  minLength={SHORT_NOTE_MIN_LENGTH}
                  placeholder="Why this proposal is being cancelled."
                />
                <Field
                  label="Ticket reference (optional)"
                  value={suspendTicketRef}
                  onChange={(e) => setSuspendTicketRef(e.target.value)}
                  maxLength={128}
                  placeholder="e.g. OPS-1187"
                />
                {status && suspendNeedsApprover(status) ? (
                  <ApproverField
                    value={approverToken}
                    onChange={setApproverToken}
                    hint={`This case has been upheld or is awaiting a second signature, so suspending it needs a second operator. The approver must hold ${joinWithOr(SUSPEND_APPROVER_ROLES)}, with an authority limit that covers the penalty, and cannot be you.`}
                  />
                ) : null}
                {formError ? <p className="text-body-xs text-danger-600">{formError}</p> : null}
                <Button
                  type="button"
                  variant="danger"
                  loading={suspend.isPending}
                  onClick={submitSuspend}
                  className="self-start"
                >
                  Suspend proposal
                </Button>
              </Section>
            ) : null}

            {extendGate.offered ? (
              <Section
                title="Extend deadline"
                description="Pushes the provider's deadline to object. Our own decision clock is not moved by this."
                open={openSection === "extendDeadline"}
                onToggle={() => toggleSection("extendDeadline")}
              >
                <Field
                  label="Additional hours"
                  value={extendHours}
                  onChange={(e) => setExtendHours(e.target.value)}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="72"
                  suffix="hours"
                  hint="A whole number, 1 to 336 (fourteen days)."
                />
                <Field
                  label="Reason code"
                  value={extendReasonCode}
                  onChange={(e) => setExtendReasonCode(e.target.value)}
                  maxLength={64}
                  placeholder="e.g. PROVIDER_REQUESTED"
                  hint="Free text, up to 64 characters. Written to the override register verbatim."
                />
                <NoteBox
                  id="extend-note"
                  label="Note"
                  value={extendNote}
                  onChange={setExtendNote}
                  minLength={SHORT_NOTE_MIN_LENGTH}
                  placeholder="Why the provider needs longer."
                />
                <div className="flex w-full flex-col gap-1 rounded-md border border-warning-20 bg-warning-10 p-3">
                  <p className="text-label-13 text-warning-600">
                    Evidence retention is not extended with it
                  </p>
                  <p className="text-body-xs text-02">
                    Response bodies are scrubbed at 72 hours on their own schedule. A deadline
                    pushed past that point leaves the next reader deciding on hashes.
                  </p>
                </div>
                {formError ? <p className="text-body-xs text-danger-600">{formError}</p> : null}
                <Button
                  type="button"
                  loading={extend.isPending}
                  onClick={submitExtend}
                  className="self-start"
                >
                  Extend deadline
                </Button>
              </Section>
            ) : null}

            {sweepGate.offered || compensateGate.offered ? (
              <div className="mt-3 flex w-full flex-col gap-1.5 rounded-md border border-01 bg-02 p-3">
                <p className="text-label-13 text-01">The next action needs two people</p>
                <p className="text-body-xs text-02">
                  This action needs two people. You are authenticated above; a second
                  operator&rsquo;s credential goes here. The platform refuses the same identity in
                  both roles.
                </p>
                <p className="pt-1.5 text-label-13 text-01">The order the platform checks in</p>
                <ul className="flex w-full flex-col gap-1">
                  <li className="text-body-xs text-02">
                    The approver is resolved <strong className="text-01">before</strong> the
                    case&rsquo;s status is looked at. Pasting your own token returns{" "}
                    <span className="font-mono text-mono-12 text-01">
                      OPERATOR_SELF_APPROVAL_REFUSED
                    </span>{" "}
                    in any status — that refusal is not evidence the case was sweepable or
                    compensable.
                  </li>
                  <li className="text-body-xs text-02">
                    The approver of a <strong className="text-01">fleet sweep</strong> must hold{" "}
                    {joinWithOr(SWEEP_APPROVER_ROLES)}. Any other approver is refused with{" "}
                    <span className="font-mono text-mono-12 text-01">
                      OPERATOR_APPROVER_ROLE_REQUIRED
                    </span>{" "}
                    (403) and no sweep is opened. A compensation&rsquo;s approver must hold{" "}
                    {joinWithOr(COMPENSATION_APPROVER_ROLES)}, and every approver&rsquo;s authority
                    limit must cover the amount (
                    <span className="font-mono text-mono-12 text-01">
                      OPERATOR_APPROVER_AUTHORITY_EXCEEDED
                    </span>{" "}
                    otherwise).
                  </li>
                  <li className="text-body-xs text-02">
                    An unknown proposal id returns <strong className="text-01">404</strong>, because
                    the tenant is resolved first.
                  </li>
                  <li className="text-body-xs text-02">
                    A <strong className="text-01">409</strong> on a compensation means the slash was
                    never executed, or was already compensated. Note that only the{" "}
                    <em>recording</em> step is two-person — building the transaction is exempt,
                    because unsigned bytes change nothing.
                  </li>
                </ul>
              </div>
            ) : null}

            {sweepGate.offered ? (
              <Section
                title="Open fleet sweep"
                description="Applies this case's conclusion to every binding the same defect touched — including providers who never complained and never saw the evidence. This is the largest blast radius of any action on this screen."
                open={openSection === "sweep"}
                onToggle={() => toggleSection("sweep")}
              >
                <Field
                  label="Defect key"
                  value={sweepDefectKey}
                  onChange={(e) => setSweepDefectKey(e.target.value)}
                  maxLength={128}
                  placeholder="e.g. MAPPING_REGRESSION_2026_08"
                  hint="What identifies the defect across cases. Every case carrying this key in the lookback window is matched."
                />
                <Field
                  label="Lookback"
                  value={sweepLookbackHours}
                  onChange={(e) => setSweepLookbackHours(e.target.value)}
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="720"
                  suffix="hours"
                  hint="A whole number, 1 to 2160 (ninety days). How far back the sweep reaches."
                />
                <Field
                  label="Reason code"
                  value={sweepReasonCode}
                  onChange={(e) => setSweepReasonCode(e.target.value)}
                  maxLength={64}
                  placeholder={sweepReasonCodes[0] ?? "e.g. MAPPING_REGRESSION"}
                  hint={
                    sweepReasonCodes.length > 0
                      ? `Up to 64 characters, and it belongs to this case's outcome (${outcomeLabel(
                          sourceOutcome ?? "",
                        )}): ${sweepReasonCodes.join(", ")}.`
                      : "Free text, up to 64 characters. Written to the override register verbatim."
                  }
                />
                <NoteBox
                  id="sweep-note"
                  label="Note"
                  value={sweepNote}
                  onChange={setSweepNote}
                  minLength={DECISION_NOTE_MIN_LENGTH}
                  placeholder="What the defect is, how it was established, and why every matched case shares it. Providers who never disputed will be decided on this paragraph."
                />
                <div className="flex w-full flex-col gap-1 rounded-md border border-warning-20 bg-warning-10 p-3">
                  <p className="text-label-13 text-warning-600">
                    This decides cases nobody has read
                  </p>
                  <p className="text-body-xs text-02">
                    A sweep applies one conclusion to every binding the same defect touched —
                    including providers who never complained and never saw the evidence. Their
                    cases are resolved by this form, not by their own.
                  </p>
                </div>
                <ApproverField
                  value={approverToken}
                  onChange={setApproverToken}
                  hint={`A second operator's own credential. The approver of a fleet sweep must hold ${joinWithOr(SWEEP_APPROVER_ROLES)}, and the platform refuses the same identity in both roles.`}
                />
                {formError ? <p className="text-body-xs text-danger-600">{formError}</p> : null}
                <Button
                  type="button"
                  variant="danger"
                  loading={sweep.isPending}
                  onClick={submitSweep}
                  className="self-start"
                >
                  Open fleet sweep
                </Button>
              </Section>
            ) : null}

            {compensateGate.offered ? (
              <Section
                title="Compensate the provider"
                description="Puts an executed penalty back into the provider's stake — as a treasury deposit, because the program has no door that undoes a slash. This screen builds the transaction; the treasury's signers pay it."
                open={openSection === "compensate"}
                onToggle={() => toggleSection("compensate")}
              >
                <div className="flex w-full flex-col gap-1 rounded-md border border-01 bg-02 p-3">
                  <p className="text-label-13 text-01">Two steps, and only the second is money</p>
                  <p className="text-body-xs text-02">
                    <strong className="text-01">Build</strong> produces an unsigned{" "}
                    <span className="font-mono text-mono-12 text-01">deposit_stake</span> for this
                    provider, paid by the treasury. Nothing has happened on chain when it returns,
                    so this step needs no approval from anyone.{" "}
                    <strong className="text-01">Record</strong> takes the signature of the confirmed
                    transaction: the platform fetches it, checks it really deposited at least the
                    applied amount into this provider&rsquo;s stake, and only then marks the case
                    compensated. A signature that paid the wrong account is refused, not believed.
                    That step is two-person — the chain signature says the money moved, the note and
                    the second operator&rsquo;s token say we agreed to close the case on it.
                  </p>
                </div>

                {compensation === null ? (
                  <Button
                    type="button"
                    loading={buildCompensation.isPending}
                    onClick={() => buildCompensation.mutate()}
                    className="self-start"
                  >
                    Build the compensation transaction
                  </Button>
                ) : (
                  <>
                    <div className="flex w-full flex-col gap-1.5 rounded-md border border-01 bg-02 p-3">
                      <IntentRow label="Provider" value={compensation.provider} />
                      <IntentRow
                        label="Amount"
                        value={`${compensation.amountMinor} (atomic units, as the record holds it)`}
                      />
                      <IntentRow label="Must be signed and paid by" value={compensation.depositor} />
                    </div>
                    {/*
                      The copy path is primary and is drawn first. The treasury
                      is a multisig; the expected route is that these bytes
                      leave this browser entirely.
                    */}
                    <CodeBlock
                      title="deposit_stake (unsigned, base64)"
                      code={compensation.transaction}
                    />
                    {holdsTreasuryKey ? (
                      <Button
                        type="button"
                        variant="secondary"
                        loading={signing}
                        onClick={() =>
                          signHere(
                            compensation.transaction,
                            compensation.depositor,
                            setCompensationSignature,
                          )
                        }
                        className="self-start"
                      >
                        Sign and send with the connected wallet
                      </Button>
                    ) : (
                      <p className="text-body-xs text-03">
                        The wallet connected here is not{" "}
                        <span className="font-mono text-mono-12 text-02">
                          {compensation.depositor}
                        </span>
                        , so there is nothing to sign with. Copy the transaction above and sign it
                        where the treasury&rsquo;s keys live.
                      </p>
                    )}
                    {signError ? (
                      <p className="text-body-xs text-danger-600">{signError}</p>
                    ) : null}
                    <Field
                      label="Confirmed transaction signature"
                      value={compensationSignature}
                      onChange={(e) => setCompensationSignature(e.target.value)}
                      maxLength={128}
                      placeholder="base58 signature"
                      hint="Filled in for you if you signed above. Otherwise paste it once the treasury's transaction has confirmed."
                    />
                    <Field
                      label="Reason code"
                      value={compensationReasonCode}
                      onChange={(e) => setCompensationReasonCode(e.target.value)}
                      maxLength={64}
                      placeholder="e.g. EXECUTED_IN_ERROR"
                      hint="Free text, up to 64 characters. Written to the override register verbatim."
                    />
                    <NoteBox
                      id="compensation-note"
                      label="Note"
                      value={compensationNote}
                      onChange={setCompensationNote}
                      minLength={SHORT_NOTE_MIN_LENGTH}
                      placeholder="Why the executed penalty is being returned, and what establishes it."
                    />
                    <Field
                      label="Ticket reference (optional)"
                      value={compensationTicketRef}
                      onChange={(e) => setCompensationTicketRef(e.target.value)}
                      maxLength={128}
                      placeholder="e.g. OPS-1187"
                    />
                    <div className="flex w-full flex-col gap-1 rounded-md border border-warning-20 bg-warning-10 p-3">
                      <p className="text-label-13 text-warning-600">
                        This closes the case, and nothing here reopens it
                      </p>
                      <p className="text-body-xs text-02">
                        Recording the deposit writes the case to compensated and files an override
                        row against both of you. The money already moved when the treasury signed —
                        this step cannot undo that, and there is no action on this screen that
                        undoes this.
                      </p>
                    </div>
                    <ApproverField
                      value={approverToken}
                      onChange={setApproverToken}
                      hint={`A second operator's own credential. The approver of a compensation must hold ${joinWithOr(COMPENSATION_APPROVER_ROLES)} with an authority limit that covers the amount, and cannot be you.`}
                    />
                    {formError ? <p className="text-body-xs text-danger-600">{formError}</p> : null}
                    <Button
                      type="button"
                      loading={confirmCompensation.isPending}
                      onClick={submitCompensated}
                      className="self-start"
                    >
                      Record the deposit
                    </Button>
                  </>
                )}
              </Section>
            ) : null}

            {cancelGate.offered ? (
              <Section
                title="Cancel the judgement on chain"
                description={
                  isEvmAsset(casePenalty.asset)
                    ? "This case was overturned or suspended, and the on-chain record is still standing. Only the arbiter's key can retire it — this screen builds the transaction and nothing more."
                    : "This case was overturned or suspended, and the on-chain record is still standing. Only the program admin's key can retire it — this screen builds the transaction and nothing more."
                }
                open={openSection === "cancel"}
                onToggle={() => toggleSection("cancel")}
              >
                <div className="flex w-full flex-col gap-1 rounded-md border border-warning-20 bg-warning-10 p-3">
                  <p className="text-label-13 text-warning-600">
                    The reservation is live until this lands
                  </p>
                  <p className="text-body-xs text-02">
                    The decision is recorded, but the slash record still holds the provider&rsquo;s
                    collateral and stays executable by anyone once its timelock passes. Building the
                    transaction changes nothing; the admin&rsquo;s signature is what retires it. The
                    on-chain record status moves to{" "}
                    <span className="font-mono text-mono-12 text-01">CANCELLED</span> on its own,
                    when the reconcile sweep sees the record leave{" "}
                    <span className="font-mono text-mono-12 text-01">Pending</span> — there is
                    nothing to record here afterwards.
                  </p>
                </div>

                {cancelIntent === null ? (
                  <Button
                    type="button"
                    loading={buildCancel.isPending}
                    onClick={() => buildCancel.mutate()}
                    className="self-start"
                  >
                    Build the cancellation transaction
                  </Button>
                ) : cancelIntent.to ? (
                  /*
                    EVM: `transaction` is the `cancelSlash` calldata for `to`,
                    and the signer is always the arbiter (D-19); without one
                    the build is refused with CHAIN_ARBITER_NOT_SET. Signed
                    through the same panel the arbiter page uses.
                  */
                  <ContractCallPanel
                    call={evmCancelCall(cancelIntent, casePenalty.asset)}
                    title={`cancelSlash for ${cancelIntent.requestId}`}
                    afterSend="The case moves to cancelled once the reconcile sweep reads the record back off the chain."
                    onSent={setCancelSignature}
                  />
                ) : (
                  <>
                    <div className="flex w-full flex-col gap-1.5 rounded-md border border-01 bg-02 p-3">
                      <IntentRow label="Provider" value={cancelIntent.provider} />
                      <IntentRow label="Request id" value={cancelIntent.requestId} />
                      <IntentRow label="Must be signed by" value={cancelIntent.admin} />
                      {/* Solana: `cancel_slash` is `Config.admin`'s; the backend states no role here. */}
                      <IntentRow
                        label="Signer role"
                        value={
                          cancelIntent.signerRole
                            ? signerRoleLabel(cancelIntent.signerRole)
                            : "The program admin (Config.admin)"
                        }
                      />
                    </div>
                    <CodeBlock
                      title="cancel_slash (unsigned, base64)"
                      code={cancelIntent.transaction}
                    />
                    {holdsAdminKey ? (
                      <Button
                        type="button"
                        variant="secondary"
                        loading={signing}
                        onClick={() =>
                          signHere(cancelIntent.transaction, cancelIntent.admin, setCancelSignature)
                        }
                        className="self-start"
                      >
                        Sign and send with the connected wallet
                      </Button>
                    ) : (
                      <p className="text-body-xs text-03">
                        The wallet connected here is not{" "}
                        <span className="font-mono text-mono-12 text-02">{cancelIntent.admin}</span>
                        , so there is nothing to sign with. Copy the transaction above and sign it
                        on the machine that holds the admin key.
                      </p>
                    )}
                    {signError ? (
                      <p className="text-body-xs text-danger-600">{signError}</p>
                    ) : null}
                    {cancelSignature ? (
                      <p className="text-body-xs text-02">
                        Broadcast as{" "}
                        <span className="font-mono text-mono-12 text-01">{cancelSignature}</span>.
                        The status here does not change until the platform reads the record back
                        off the chain, so this case will keep saying cancellation requested for a
                        little while yet — that is the sweep catching up, not a failure.
                      </p>
                    ) : null}
                  </>
                )}
              </Section>
            ) : null}

            {claimGate.offered ? (
              <p className="pt-3 text-body-xs text-03">
                Claiming is not a precondition for deciding. The backend allows an unclaimed case
                to be decided on purpose — the override register names the decider either way.
              </p>
            ) : null}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

/**
 * One collapsible action. Kept local to this file: it is the accordion row
 * 7b/7c add their five sections to, not a primitive other screens share.
 */
function Section({
  title,
  description,
  open,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-col border-t border-01 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 py-3 text-left"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-label-sm text-01">{title}</span>
          <span className="text-body-xs text-03">{description}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn("mt-0.5 size-4 shrink-0 text-03 transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? <div className="flex w-full flex-col gap-3 pb-4">{children}</div> : null}
    </div>
  );
}

/**
 * One labelled identity or figure from a build-only intent.
 *
 * Values are mono and `break-all`: they are base58 addresses and atomic
 * amounts, and an address that wraps mid-character at a container edge is an
 * address someone transcribes wrong. Nothing here is a control — the operator
 * copies the transaction, not these — so they are read-only text rather than
 * disabled fields, which would imply an edit that was withheld.
 */
/**
 * An EVM `CancelIntent` as the generic unsigned call. The chain is the case
 * penalty's own (`eip155:46630/erc20:0x…` → `eip155:46630`): the route does
 * not repeat it, and the penalty is on the record's chain by construction.
 */
function isEvmAsset(asset: string): boolean {
  return asset.startsWith("eip155:");
}

function evmCancelCall(intent: CancelIntent, penaltyAsset: string): SlashContractCall {
  return {
    chainId: penaltyAsset.split("/")[0] ?? penaltyAsset,
    to: intent.to ?? "",
    data: intent.transaction,
    value: "0",
    signer: intent.admin,
    // Always the arbiter on EVM: the backend builds `cancelSlash` for no one else.
    signerRole: "ARBITER",
    functionName: "cancelSlash",
    requestIds: [intent.requestId.startsWith("0x") ? intent.requestId : `0x${intent.requestId}`],
  };
}

function IntentRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full flex-col gap-0.5">
      <span className="text-label-13 text-02">{label}</span>
      <span className="break-all font-mono text-mono-12 text-01">{value}</span>
    </div>
  );
}

/**
 * The second operator's own bearer token, for the one maker/checker action.
 *
 * `type="password"` so it is not readable over a shoulder or in a screen
 * share, and `autoComplete="off"` / `spellCheck={false}` so the browser's own
 * credential store never offers to keep it — this token belongs to the person
 * standing next to the operator, not to this browser profile.
 *
 * Stateless on purpose: the value lives in the panel's single `approverToken`
 * state, which is cleared on section toggle, on success and on unmount. This
 * component adds no second copy.
 */
function ApproverField({
  value,
  onChange,
  hint = "A second operator's own credential. The platform refuses the same identity in both roles.",
}: {
  value: string;
  onChange: (next: string) => void;
  /** Who may approve differs per action; the sweep names roles, the compensation does not. */
  hint?: string;
}) {
  return (
    <Field
      label="Approver's operator token"
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
      spellCheck={false}
      hint={hint}
    />
  );
}

/**
 * A prose note box with a live counter.
 *
 * `components/ui/textarea.tsx` is deliberately NOT used: it paints
 * `bg-shades-L5` and `ring-shades-L10`, which are not tokens in this design
 * system, and sizes its text with stock `text-sm`. Fixing that component is
 * another task's call, so this box is styled from the same tokens `Field`
 * uses — `border-02` / `bg-01`, focus to `primary-500` at 1.5px — and the type
 * is `body-sm` rather than `Field`'s mono, because these are sentences, not
 * identifiers.
 */
function NoteBox({
  id,
  label,
  value,
  onChange,
  minLength,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  minLength: number;
  placeholder?: string;
}) {
  const length = value.trim().length;
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-label-13 text-01">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder={placeholder}
        className="w-full rounded-md border border-02 bg-01 px-3 py-2.5 text-body-sm text-01 outline-none placeholder:text-03 focus:border-[1.5px] focus:border-primary-500"
      />
      <p className="font-mono text-mono-12 text-03">
        {length} / {minLength} minimum
      </p>
    </div>
  );
}
