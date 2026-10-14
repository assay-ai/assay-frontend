"use client";

import { Check, CircleAlert, ExternalLink, Loader2, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/utils";

import {
  IDLE,
  isUserRejection,
  lastExplorerUrl,
  runWalletSteps,
  stepStatuses,
  trackerHeadline,
  type StepStatus,
  type WalletRunState,
  type WalletStep,
  type WalletStepCost,
  type WalletStepResult,
} from "./wallet-steps";

export type { WalletStep, WalletStepCost, WalletStepResult } from "./wallet-steps";

/**
 * One button for every wallet flow: it runs the caller's steps in order,
 * shows "Signature 1 of 2" while it does, and ends on a plain outcome.
 *
 *   <SignAction
 *     label="Deposit $20.00"
 *     steps={[
 *       { id: "approve", label: "Allow Assay to move USDG", cost: "gas", run: () => approve() },
 *       { id: "deposit", label: "Deposit $20.00", cost: "gas",
 *         run: async () => ({ explorerUrl: explorerTxUrl(chain, await deposit()) }) },
 *     ]}
 *     successTitle="Deposit sent"
 *     onSuccess={() => queryClient.invalidateQueries({ queryKey: ["balances"] })}
 *   />
 *
 * - **Declining is not an error.** If the person says no in their wallet the
 *   form keeps every value, the message is "You declined in your wallet.
 *   Nothing was sent." and Try again resumes at the declined step — a step
 *   that already went through is never signed twice.
 * - **A real failure** shows `describeError(error)` (one sentence), the raw
 *   message under Details, and Try again.
 * - **No layout shift.** The tracker and the message line are always laid
 *   out; only their contents change.
 * - **Generic.** No chain code in here: a step is a label, a cost badge and a
 *   promise. Wrap your own signer in `run()`.
 */
export interface SignActionProps {
  steps: WalletStep[];
  /** The button's label before anything runs: a verb and the amount. */
  label: string;
  /** Disable the button. Always pair with `disabledReason` — no silent disabled buttons. */
  disabled?: boolean;
  /** Shown under the button while disabled. */
  disabledReason?: React.ReactNode;
  /** Called once every step has gone through, with what they returned. */
  onSuccess?: (results: (WalletStepResult | undefined)[]) => void;
  /** Default "Done". */
  successTitle?: React.ReactNode;
  successDescription?: React.ReactNode;
  /** Label of the explorer link on success. Default "View on explorer". */
  explorerLabel?: string;
  /**
   * The button shown after success. Leave out and the button slot shows a
   * plain "Done" line instead of a button that does nothing.
   */
  doneAction?: { label: string; onClick: () => void };
  /** One sentence for a failure. Default: a generic sentence. */
  describeError?: (error: unknown) => string;
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

const DECLINED = "You declined in your wallet. Nothing was sent.";
const DEFAULT_FAILURE = "That did not go through. Nothing more was sent; you can try again.";

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
  active: "waiting for your wallet",
  done: "done",
  declined: "declined",
  failed: "failed",
};

export function SignAction({
  steps,
  label,
  disabled,
  disabledReason,
  onSuccess,
  successTitle = "Done",
  successDescription,
  explorerLabel = "View on explorer",
  doneAction,
  describeError,
  isRejection = isUserRejection,
  trackerNoun,
  onPhaseChange,
  block = true,
  className,
}: SignActionProps) {
  const [state, setState] = React.useState<WalletRunState>(IDLE);
  const running = state.phase === "running";
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const update = React.useCallback(
    (next: WalletRunState) => {
      if (!mounted.current) return;
      setState(next);
      onPhaseChange?.(next.phase);
    },
    [onPhaseChange],
  );

  const start = async () => {
    const resumeAt = state.phase === "declined" || state.phase === "failed" ? state.index : 0;
    const final = await runWalletSteps(steps, {
      startAt: resumeAt,
      results: resumeAt > 0 ? state.results : [],
      onChange: update,
      isRejection,
    });
    if (final.phase === "success" && mounted.current) onSuccess?.(final.results);
  };

  const statuses = stepStatuses(steps.length, state);
  const headline = trackerHeadline(steps.length, state, trackerNoun);
  const explorerUrl = state.phase === "success" ? lastExplorerUrl(state.results) : undefined;
  const activeStep = state.phase === "running" ? steps[state.index] : undefined;

  let message: React.ReactNode = null;
  let messageTone: "neutral" | "warning" | "danger" | "success" = "neutral";
  if (state.phase === "running") {
    message = steps.length > 1 ? `Confirm “${activeStep?.label}” in your wallet.` : "Confirm in your wallet.";
  } else if (state.phase === "declined") {
    message = DECLINED;
    messageTone = "warning";
  } else if (state.phase === "failed") {
    message = describeError?.(state.error) ?? DEFAULT_FAILURE;
    messageTone = "danger";
  } else if (disabled && disabledReason) {
    message = disabledReason;
  }

  const rawError = state.phase === "failed" ? errorText(state.error) : null;

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      {steps.length > 1 ? (
        <div className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-02 px-3.5 py-3">
          <span className="font-mono text-mono-xs uppercase tracking-[0.06em] text-03" aria-live="polite">
            {headline}
          </span>
          <ol className="flex flex-col gap-2">
            {steps.map((step, index) => (
              <li key={step.id} className="flex items-center gap-2.5">
                <StepIcon status={statuses[index]!} />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-body-13",
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
        <div role="status" className="flex min-h-[42px] w-full items-start gap-2.5 rounded-lg bg-success-10 px-3.5 py-2.5">
          <Check aria-hidden="true" strokeWidth={3} className="mt-0.5 size-4 shrink-0 text-success-600" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-label-13 text-01">{successTitle}</span>
            {successDescription ? <span className="text-body-xs text-02">{successDescription}</span> : null}
            {explorerUrl ? (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 self-start text-label-xs text-success-700 underline-offset-2 hover:underline"
              >
                {explorerLabel}
                <ExternalLink aria-hidden="true" className="size-3" />
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-2">
          <Button
            type="button"
            className={cn(block && "w-full")}
            disabled={disabled || running}
            loading={running}
            onClick={() => void start()}
          >
            {running
              ? "Waiting for your wallet…"
              : state.phase === "declined" || state.phase === "failed"
                ? "Try again"
                : label}
          </Button>
          {steps.length === 1 && state.phase === "idle" && steps[0] ? (
            <span className="flex items-center justify-center gap-1.5 text-body-xs text-03">
              One wallet prompt <CostBadge cost={steps[0].cost} />
            </span>
          ) : null}
        </div>
      )}

      {/* Always laid out, so a message appearing never pushes the form. */}
      <div
        aria-live="polite"
        className={cn(
          "flex min-h-5 items-start gap-1.5 text-body-xs",
          messageTone === "warning" && "text-warning-700",
          messageTone === "danger" && "text-danger-600",
          messageTone === "neutral" && "text-03",
        )}
      >
        {messageTone === "danger" || messageTone === "warning" ? (
          <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
        ) : null}
        <span className="min-w-0 flex-1">
          {message}
          {rawError ? (
            <details className="mt-1 text-03">
              <summary className="cursor-pointer select-none text-label-xs">Details</summary>
              <span className="mt-1 block break-all font-mono text-mono-xs">{rawError}</span>
            </details>
          ) : null}
        </span>
      </div>

      {state.phase === "success" ? (
        doneAction ? (
          <Button type="button" variant="secondary" className={cn(block && "w-full")} onClick={doneAction.onClick}>
            {doneAction.label}
          </Button>
        ) : null
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A sheet whose footer is a `SignAction`: a title, one plain preview line,
 * the caller's form, and the button. It refuses to close while a wallet
 * prompt is open (closing would orphan the signature), and keeps its
 * contents on decline.
 *
 *   <WalletActionSheet open={open} onOpenChange={setOpen}
 *     title="Set safety caps" description="Your agents can spend at most $1.00 a call and $20.00 a day."
 *     steps={steps} label="Sign and save" successTitle="Caps saved"
 *     doneAction={{ label: "Close", onClick: () => setOpen(false) }}>
 *     <PresetChips … />
 *   </WalletActionSheet>
 */
export interface WalletActionSheetProps extends SignActionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** One sentence: what will happen, in money terms. */
  description?: React.ReactNode;
  children?: React.ReactNode;
}

export function WalletActionSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  onPhaseChange,
  ...signProps
}: WalletActionSheetProps) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <SheetContent showCloseButton={!busy} {...(description ? {} : { "aria-describedby": undefined })}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        {children ? <div className="flex w-full flex-col gap-4 px-[18px] pt-4">{children}</div> : null}
        <SheetFooter>
          <SignAction
            {...signProps}
            onPhaseChange={(phase) => {
              setBusy(phase === "running");
              onPhaseChange?.(phase);
            }}
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
