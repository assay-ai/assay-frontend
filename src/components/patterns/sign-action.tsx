"use client";

import { Check, CircleAlert, ExternalLink, Info, Loader2, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Chain } from "@/interfaces/chain";
import { demoEnabled } from "@/libs/demo/demo-api";
import { cn } from "@/utils";

import { ChangeRows, type ConfirmChange } from "./change-rows";
import { TestnetChip } from "./testnet-chip";
import {
  IDLE,
  isUserRejection,
  lastExplorerUrl,
  runWalletSteps,
  signatureCountNote,
  simulatedSteps,
  stepStatuses,
  trackerHeadline,
  type StepStatus,
  type SubmittedOutcome,
  type WalletRunState,
  type WalletStep,
  type WalletStepCost,
  type WalletStepResult,
} from "./wallet-steps";

export type {
  SubmittedOutcome,
  WalletStep,
  WalletStepContext,
  WalletStepCost,
  WalletStepReport,
  WalletStepResult,
} from "./wallet-steps";

/**
 * One button for every wallet flow: it runs the caller's steps in order,
 * shows "Signature 1 of 2" while it does, and ends on a plain outcome.
 *
 *   <SignAction
 *     label="Deposit $20.00"
 *     resetKey={amount}                       // a new amount starts over
 *     steps={[
 *       { id: "approve", label: "Allow Assay to move USDG", cost: "gas",
 *         skip: allowanceCovers,               // no prompt when not needed
 *         run: ({ report }) => approve(report) },
 *       { id: "deposit", label: "Deposit $20.00", cost: "gas",
 *         run: async ({ report, previousAttempt }) => {
 *           const hash = previousAttempt?.data as Hex ?? (report({ stage: "wallet" }), await send());
 *           report({ stage: "submitted", data: hash, explorerUrl: explorerTxUrl(chain, hash) });
 *           await waitForReceipt(hash);
 *         } },
 *     ]}
 *     successTitle="Deposit sent"
 *     onSuccess={() => queryClient.invalidateQueries({ queryKey: ["balances"] })}
 *   />
 *
 * - **Declining is not an error.** If the person says no in their wallet the
 *   form keeps every value, the message says nothing was sent, and Try again
 *   resumes at the declined step — a step that went through is never signed twice.
 * - **Submitted is remembered.** A step that reported `"submitted"` and then
 *   failed (receipt timeout, RPC hiccup) is retried with `previousAttempt`, so
 *   the step re-checks its transaction instead of sending a second one. The
 *   explorer link shows from the moment of submission.
 * - **A real failure** shows `describeError(error)` (one sentence), the raw
 *   message under Details, and Try again.
 * - **No layout shift.** The tracker, the helper line and the message line are
 *   always laid out; only their contents change.
 * - **Generic.** No chain code in here. Wrap your own signer in `run()`.
 *   Persisting a pending hash across a reload is the caller's job (store
 *   `report.data` and pass it back as `previousAttempt` via a new mount).
 */
export interface SignActionProps {
  steps: WalletStep[];
  /** The button's label before anything runs: a verb and the amount. */
  label: string;
  /** Disable the button. Always pair with `disabledReason` — no silent disabled buttons. */
  disabled?: boolean;
  /** Shown under the button while disabled. */
  disabledReason?: React.ReactNode;
  /**
   * Change it (e.g. to the amount) to start over: a retry after the person
   * edited the form must not reuse what earlier steps signed for the old values.
   */
  resetKey?: string | number;
  /** Called once every step has gone through, with what they returned. */
  onSuccess?: (results: (WalletStepResult | undefined)[]) => void;
  /** Default "Done". */
  successTitle?: React.ReactNode;
  successDescription?: React.ReactNode;
  /** Label of the explorer link. Default "View on explorer". */
  explorerLabel?: string;
  /**
   * The button shown after success. Leave out and nothing replaces the button
   * — never a button that does nothing.
   */
  doneAction?: { label: string; onClick: () => void };
  /** One sentence for a failure. Default: a generic sentence. */
  describeError?: (error: unknown) => string;
  /**
   * For a step that failed after it was submitted: a known outcome to say
   * instead of the generic "sent, but we could not confirm it" line. Return
   * `null` to keep that line.
   */
  describeSubmittedError?: (error: unknown) => SubmittedOutcome | null;
  /** Override rejection detection. Default handles EIP-1193, viem, Solana adapters, Privy. */
  isRejection?: (error: unknown) => boolean;
  /** Noun for the tracker headline. Default "Signature". */
  trackerNoun?: string;
  /** Reports the run phase, e.g. so a sheet can refuse to close mid-signature. */
  onPhaseChange?: (phase: WalletRunState["phase"]) => void;
  /** Full-width button. Default true. */
  block?: boolean;
  className?: string;
}

const DEFAULT_FAILURE = "That did not go through. You can try again.";
const SUBMITTED_FAILURE =
  "Your transaction was sent, but we could not confirm it yet. Check it on the explorer; Try again checks it rather than sending it twice.";

function errorText(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return null;
}

/** "Free" / "You pay gas" — what a step costs the person. */
export function CostBadge({ cost, className }: { cost: WalletStepCost; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-px text-label-xs",
        cost === "free" ? "bg-teal-10 text-teal-600" : "bg-warning-10 text-warning-700",
        className,
      )}
    >
      {cost === "free" ? "Free" : "You pay gas"}
    </span>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  const base = "flex size-5 shrink-0 items-center justify-center rounded-full";
  if (status === "done") {
    return (
      <span className={cn(base, "bg-success-500 text-on-color")}>
        <Check aria-hidden="true" strokeWidth={3} className="size-3" />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className={cn(base, "bg-primary-10 text-primary-500")}>
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
      </span>
    );
  }
  if (status === "declined" || status === "failed") {
    return (
      <span className={cn(base, status === "failed" ? "bg-danger-10 text-danger-500" : "bg-warning-10 text-warning-600")}>
        <X aria-hidden="true" strokeWidth={3} className="size-3" />
      </span>
    );
  }
  return <span className={cn(base, "border border-02 bg-01")} />;
}

const STATUS_WORD: Record<StepStatus, string> = {
  upcoming: "waiting",
  active: "in progress",
  done: "done",
  declined: "declined",
  failed: "failed",
};

function ExplorerLink({ href, label, className }: { href: string; label: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("hit-area inline-flex items-center gap-1 text-label-xs underline-offset-2 hover:underline", className)}
    >
      {label}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}

export function SignAction({
  steps: allSteps,
  label,
  disabled,
  disabledReason,
  resetKey,
  onSuccess,
  successTitle = "Done",
  successDescription,
  explorerLabel = "View on explorer",
  doneAction,
  describeError,
  describeSubmittedError,
  isRejection = isUserRejection,
  trackerNoun,
  onPhaseChange,
  block = true,
  className,
}: SignActionProps) {
  const steps = React.useMemo(() => allSteps.filter((step) => !step.skip), [allSteps]);
  const [state, setState] = React.useState<WalletRunState>(IDLE);
  const running = state.phase === "running";
  const mounted = React.useRef(true);
  // Guards the same click: the button only disables after a re-render, and a
  // double-click must not open two wallet prompts.
  const inFlight = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A new resetKey means the form changed: start over (unless mid-signature).
  const [seenKey, setSeenKey] = React.useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    if (!inFlight.current) setState(IDLE);
  }

  const update = React.useCallback(
    (next: WalletRunState) => {
      if (!mounted.current) return;
      setState(next);
      onPhaseChange?.(next.phase);
    },
    [onPhaseChange],
  );

  const start = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const resumeAt = state.phase === "declined" || state.phase === "failed" ? state.index : 0;
      const final = await runWalletSteps(steps, {
        startAt: resumeAt,
        results: resumeAt > 0 ? state.results : [],
        previousAttempt: state.phase === "failed" ? state.submitted : undefined,
        onChange: update,
        isRejection,
      });
      if (final.phase === "success" && mounted.current) onSuccess?.(final.results);
    } finally {
      inFlight.current = false;
    }
  };

  const statuses = stepStatuses(steps.length, state);
  const headline = trackerHeadline(steps.length, state, trackerNoun);
  const successUrl = state.phase === "success" ? lastExplorerUrl(state.results) : undefined;
  const liveUrl =
    state.phase === "running" ? state.explorerUrl : state.phase === "failed" ? state.submitted?.explorerUrl : undefined;
  const activeStep = state.phase === "running" ? steps[state.index] : undefined;
  const anyDone = state.phase !== "idle" && state.phase !== "success" && state.index > 0;

  let message: React.ReactNode = null;
  let messageTone: "neutral" | "reason" | "warning" | "danger" = "neutral";
  if (state.phase === "running") {
    const what = steps.length > 1 && activeStep ? `“${activeStep.label}”` : "this";
    message =
      state.stage === "preparing"
        ? "Preparing the transaction…"
        : state.stage === "submitted"
          ? "Sent. Waiting for the chain to confirm it…"
          : `Confirm ${what} in your wallet.`;
  } else if (state.phase === "declined") {
    message = anyDone
      ? "You declined in your wallet. Nothing more was sent; the steps already done stay done."
      : "You declined in your wallet. Nothing was sent.";
    messageTone = "warning";
  } else if (state.phase === "failed") {
    const known = state.submitted ? (describeSubmittedError?.(state.error) ?? null) : null;
    message = known
      ? known.text
      : state.submitted
        ? SUBMITTED_FAILURE
        : (describeError?.(state.error) ?? DEFAULT_FAILURE);
    messageTone = known?.tone ?? "danger";
  } else if (state.phase === "idle" && disabled && disabledReason) {
    // Why the button cannot be pressed: in body colour with a mark, so a
    // disabled "Deposit $20.00" never reads as a bug at a glance.
    message = disabledReason;
    messageTone = "reason";
  }

  const rawError = state.phase === "failed" ? errorText(state.error) : null;
  // A disabled button names its reason for a screen reader too (the message under it).
  const messageId = React.useId();
  const describedBy = disabled && !running && message ? messageId : undefined;
  const single = steps.length === 1 ? steps[0] : undefined;
  const countNote = signatureCountNote(steps);

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      {steps.length > 1 ? (
        <div className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-02 px-3.5 py-3">
          <span className="text-label-13 text-02">{headline}</span>
          <ol className="flex flex-col gap-2">
            {steps.map((step, index) => (
              <li key={step.id} className="flex items-start gap-2.5">
                <StepIcon status={statuses[index]!} />
                {/* Wraps, never cuts: at 390 px "Allow the escrow to take $20.00 USDG" must read whole (B7). */}
                <span
                  className={cn(
                    "min-w-0 flex-1 text-body-13 [overflow-wrap:anywhere]",
                    statuses[index] === "upcoming" ? "text-02" : "text-01",
                  )}
                >
                  {step.label}
                </span>
                <span className="sr-only">, {STATUS_WORD[statuses[index]!]}</span>
                <CostBadge cost={step.cost} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {state.phase === "success" ? (
        <div role="status" className="flex w-full items-start gap-2.5 rounded-lg bg-success-10 px-3.5 py-2.5">
          <Check aria-hidden="true" strokeWidth={3} className="mt-0.5 size-4 shrink-0 text-success-600" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-label-13 text-01">{successTitle}</span>
            {successDescription ? <span className="text-body-xs text-02">{successDescription}</span> : null}
            {successUrl ? <ExplorerLink href={successUrl} label={explorerLabel} className="self-start text-success-700" /> : null}
          </div>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-2">
          <Button
            type="button"
            className={cn(block && "w-full")}
            disabled={disabled || running}
            aria-describedby={describedBy}
            loading={running}
            onClick={() => void start()}
          >
            {running
              ? state.stage === "submitted"
                ? "Confirming…"
                : "Waiting for your wallet…"
              : state.phase === "declined" || state.phase === "failed"
                ? "Try again"
                : label}
          </Button>
          {single ? (
            // Always laid out for a one-step flow, so nothing moves while it runs.
            <span className="flex items-center justify-center gap-1.5 text-body-xs text-03">
              One wallet prompt <CostBadge cost={single.cost} />
            </span>
          ) : countNote ? (
            // Said before the first click: the second signature is never a surprise (lot 1 D14).
            <span className="flex items-center justify-center gap-1.5 text-center text-body-xs text-03" data-testid="signature-count">
              {countNote}
            </span>
          ) : null}
        </div>
      )}

      {state.phase === "success" ? (
        doneAction ? (
          <Button type="button" variant="secondary" className={cn(block && "w-full")} onClick={doneAction.onClick}>
            {doneAction.label}
          </Button>
        ) : null
      ) : (
        /* Always laid out, so a message appearing never pushes the form. */
        <div
          aria-live="polite"
          className={cn(
            "flex min-h-5 items-start gap-1.5 text-body-xs",
            messageTone === "warning" && "text-warning-700",
            messageTone === "danger" && "text-danger-600",
            messageTone === "neutral" && "text-03",
            messageTone === "reason" && "text-02",
          )}
        >
          {messageTone === "reason" ? <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" /> : null}
          {messageTone === "warning" || messageTone === "danger" ? (
            <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          ) : null}
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span id={messageId}>{message}</span>
            {liveUrl ? <ExplorerLink href={liveUrl} label={explorerLabel} className="self-start text-02" /> : null}
            {rawError ? (
              <details className="text-03">
                <summary className="cursor-pointer select-none text-label-xs">Details</summary>
                <span className="mt-1 block break-all font-mono text-mono-xs">{rawError}</span>
              </details>
            ) : null}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A sheet whose footer is a `SignAction`: a title, one plain preview line,
 * the caller's form, optional before → after rows and a required
 * acknowledgement, and the button. It refuses to close while a wallet
 * prompt is open (closing would orphan the signature), and keeps its
 * contents on decline. Use it for every action that needs a signature —
 * including the destructive ones (withdraw, revoke grant, unstake, dispute);
 * `ConfirmSheet` is for actions with no signature.
 *
 *   <WalletActionSheet open={open} onOpenChange={setOpen}
 *     title="Request a withdrawal"
 *     description="$20.00 leaves escrow in about an hour. Paid calls pause until then."
 *     changes={[{ label: "Escrow", before: "$20.00", after: "$0.00" }]}
 *     acknowledge="I understand my agents cannot pay until it completes"
 *     steps={steps} label="Request withdrawal" successTitle="Withdrawal requested"
 *     doneAction={{ label: "Close", onClick: () => setOpen(false) }} />
 */
/** Shown at the top of every signing sheet on a demo build. */
export const DEMO_SIGNING_NOTE =
  "Demo: nothing is signed and no money moves. The button walks through every step without a wallet, so you can see how it ends; on a live site it opens your wallet.";

/**
 * DEMO ONLY: what a signing sheet runs and when its button is disabled. One
 * behaviour for every wallet sheet, buyer and provider alike: on a demo build
 * the steps are `simulatedSteps` (the real `run` is never called, so nothing
 * is signed or sent) and the button works as on a live site, still waiting
 * for the caller's own reasons and the acknowledgement. A live build gets the
 * caller's steps and reasons unchanged.
 */
export function sheetSigning({
  demo,
  steps,
  disabled,
  disabledReason,
  needsAck,
}: {
  demo: boolean;
  steps: WalletStep[];
  disabled?: boolean;
  disabledReason?: React.ReactNode;
  needsAck: boolean;
}): { steps: WalletStep[]; disabled: boolean; disabledReason: React.ReactNode | undefined } {
  return {
    steps: demo ? simulatedSteps(steps) : steps,
    disabled: Boolean(disabled) || needsAck,
    disabledReason: disabled ? disabledReason : needsAck ? "Tick the box above to continue." : undefined,
  };
}

export interface WalletActionSheetProps extends SignActionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** One sentence: what will happen, in money terms. Never a nonce, gas or CAIP id. */
  description?: React.ReactNode;
  /** Before → after rows, as in ConfirmSheet. */
  changes?: ConfirmChange[];
  /** A required checkbox; the sign button stays disabled until it is ticked. */
  acknowledge?: React.ReactNode;
  /**
   * The chain this signature moves money on, for the "Testnet" chip in the
   * header. Omitted, the chip follows every chain the deployment serves.
   */
  chain?: Pick<Chain, "displayName" | "chainId"> | null;
  children?: React.ReactNode;
}

export function WalletActionSheet({
  open,
  onOpenChange,
  title,
  description,
  changes,
  acknowledge,
  chain,
  children,
  onPhaseChange,
  disabled,
  disabledReason,
  ...signProps
}: WalletActionSheetProps) {
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [acknowledged, setAcknowledged] = React.useState(false);
  // However the sheet closed (its X, or a Done button calling the parent), the
  // next opening asks again.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setAcknowledged(false);
      setDone(false);
    }
  }
  const needsAck = Boolean(acknowledge) && !acknowledged;
  /*
    Once it went through, the footer grows (the result and Done) while the
    scroll position stays: as a sticky footer it then covered the end of the
    content, a timeline's last steps included (final regression 2026-10-17,
    withdraw stake). After success it stops being sticky and the sheet scrolls
    to its end, so the content and the result both show in full.
  */
  React.useEffect(() => {
    if (!done) return;
    const node = contentRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [done]);
  // DEMO ONLY: the screens read fixtures, so a signature would move real
  // test money against figures that are not real. The steps are simulated
  // instead, so the whole flow, success state included, can be walked.
  const demo = demoEnabled();
  const signing = sheetSigning({ demo, steps: signProps.steps, disabled, disabledReason, needsAck });

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        if (!next) setAcknowledged(false);
        onOpenChange(next);
      }}
    >
      <SheetContent
        ref={contentRef}
        showCloseButton={!busy}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <SheetHeader className="tablet:pt-5">
          <TestnetChip chain={chain} className="self-start" />
          <SheetTitle className="pr-8">{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        {children || changes?.length || acknowledge || demo ? (
          <div className="flex w-full flex-col gap-4 px-[18px] pt-4">
            {demo ? (
              <p className="rounded-lg bg-info-10 px-3 py-2 text-body-13 text-01" data-testid="demo-signing-note">
                {DEMO_SIGNING_NOTE}
              </p>
            ) : null}
            {children}
            {changes?.length ? <ChangeRows changes={changes} /> : null}
            {acknowledge ? (
              <Checkbox
                checked={acknowledged}
                disabled={busy}
                onChange={(event) => setAcknowledged(event.target.checked)}
                label={acknowledge}
                className="items-start [&>span:first-of-type]:mt-px"
              />
            ) : null}
          </div>
        ) : null}
        {/*
          Sticky, so the button stays on screen when a long form scrolls on a phone. Above the
          content: a timeline's step circles are positioned (z-[1]) and would paint over it.
        */}
        <SheetFooter className={cn("bottom-0 z-10 bg-01", !done && "sticky")}>
          <SignAction
            {...signProps}
            steps={signing.steps}
            disabled={signing.disabled}
            disabledReason={signing.disabledReason}
            onPhaseChange={(phase) => {
              setBusy(phase === "running");
              setDone(phase === "success");
              onPhaseChange?.(phase);
            }}
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
