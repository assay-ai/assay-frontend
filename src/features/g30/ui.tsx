import * as React from "react";

import { WalletSetupBanner } from "@/components/auth/wallet-setup-banner";
import type { ChainReadState } from "@/features/chain-read/chain-read";
import { cn } from "@/utils";

/**
 * Small shapes the buyer screens repeat. None of these is a design-system
 * component: each one is a plain frame in the design (not a `reusable` node),
 * so building them here rather than in `src/components/ui` is deliberate.
 */

/* --------------------------------------------------------------- page header */

export interface PageHeaderProps {
  /** 24/600/-0.5 in the design → `text-heading-md`. */
  title: string;
  /** The mono sub-line under every page title. */
  sub: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, sub, actions }: PageHeaderProps) {
  return (
    <div className="flex w-full flex-col gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h1 className="text-heading-md text-01">{title}</h1>
        <p className="text-mono-12 font-mono text-03">{sub}</p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- key/value */

export interface KeyValueRowProps {
  label: string;
  /** The muted second line under the label. */
  sub?: string;
  /** Pre-formatted money. Never a number. */
  value: string;
  /**
   * Which of the three chain-read states `value` is (`@/features/chain-read`).
   *
   * Omitted means "this is not a chain-derived figure" — a ledger fact, which
   * is true whatever the chain is doing. When it IS chain-derived, passing the
   * state is what makes an unreadable chain LOOK different from a zero: the
   * value node changes colour and carries `data-chain-read`, so the difference
   * survives a screenshot and is assertable from computed style rather than
   * from a class string.
   */
  valueState?: ChainReadState;
  /** The last row of a breakdown: 600 label and a top rule. */
  total?: boolean;
}

/**
 * One line of the Balance / Summary / Breakdown blocks on the Funding screen, the withdrawal summary and
 * The withdrawal screen. The design draws them identically on all three: label + optional
 * muted sub on the left, 14.5px/600 mono figure on the right, and a top rule
 * only on the final "Withdrawable" / "Credited to balance" row.
 */
export function KeyValueRow({ label, sub, value, valueState, total }: KeyValueRowProps) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-4 py-2.5",
        total && "border-t border-02 pb-0 pt-3",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn(total ? "text-label-sm" : "text-body-sm", "text-01")}>{label}</span>
        {sub ? <span className="text-body-xs text-03">{sub}</span> : null}
      </div>
      <span
        data-chain-read={valueState}
        className={cn(
          "shrink-0 font-mono text-mono-sm font-semibold",
          /*
            One class, chosen — never two colour classes concatenated and left
            to `cn()` to reconcile. `tailwind-merge` silently drops custom
            token classes in this project, and a dropped colour here would make
            the unreadable state render identically to the read one: exactly
            the defect, reintroduced invisibly to tsc, to the CSS and to review.
          */
          valueState === "unreadable" ? "text-warning-600" : "text-01",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------- notes */

export type NoteTone = "neutral" | "teal" | "warning" | "primary";

const NOTE_SURFACE: Record<NoteTone, string> = {
  neutral: "bg-02 border-01",
  teal: "bg-teal-10 border-teal-20",
  warning: "bg-warning-10 border-warning-20",
  primary: "bg-primary-10 border-primary-20",
};

const NOTE_ICON: Record<NoteTone, string> = {
  neutral: "text-03",
  teal: "text-teal-600",
  warning: "text-warning-600",
  primary: "text-primary-600",
};

const NOTE_TEXT: Record<NoteTone, string> = {
  neutral: "text-02",
  teal: "text-02",
  warning: "text-warning-700",
  primary: "text-primary-700",
};

export interface NoteBoxProps {
  tone?: NoteTone;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * The bordered one-paragraph note the funding screens use everywhere. It is
 * NOT `Banner`: Banner's first line is a 14px/600 title and these notes have
 * no title, only a 13px paragraph beside a 15px icon.
 */
export function NoteBox({ tone = "neutral", icon, children, className }: NoteBoxProps) {
  return (
    <div
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border p-3.5",
        NOTE_SURFACE[tone],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("mt-0.5 flex size-[15px] shrink-0 items-center justify-center", NOTE_ICON[tone])}
      >
        {icon}
      </span>
      <p className={cn("min-w-0 flex-1 text-body-13", NOTE_TEXT[tone])}>{children}</p>
    </div>
  );
}

/* -------------------------------------------------------------------- chips */

export interface ChipProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

/** The "Window · Last 7 days" / "Compare to · previous 7 days" chips on the Spend explorer. */
export function Chip({ label, children, className }: ChipProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-02 bg-01 px-3 py-2",
        className,
      )}
    >
      <span className="shrink-0 text-body-13 text-03">{label}</span>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ states */

/** A one-line "still loading" placeholder that never spins forever. */
export function PendingBlock({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex w-full items-center justify-center rounded-xl border border-01 bg-01 px-5 py-10 text-body-13 text-03"
    >
      {label}
    </div>
  );
}

/**
 * The error surface. `ApiError.code` is shown because it is what support asks
 * for.
 *
 * One code is not shown that way. `AUTH_WALLET_NOT_LINKED` is what a
 * correctly-provisioned brand-new account answers for the few seconds between
 * Privy issuing the token and recording the wallet — nothing is broken, and a
 * red box is the wrong sentence. It is intercepted here rather than at each
 * call site so that every screen reading through `ErrorBlock` says the same
 * thing about it. See `features/auth/wallet-link.ts`.
 */
export function ErrorBlock({ code, message }: { code: string; message: string }) {
  if (code === "AUTH_WALLET_NOT_LINKED") {
    return <WalletSetupBanner />;
  }

  return (
    <div
      role="alert"
      className="flex w-full flex-col gap-1 rounded-xl border border-danger-20 bg-danger-10 px-5 py-4"
    >
      <p className="text-label-sm text-01">We could not load this.</p>
      <p className="text-body-13 text-02 [overflow-wrap:anywhere]">{message}</p>
      <p className="font-mono text-mono-12 text-03 [overflow-wrap:anywhere]">{code}</p>
    </div>
  );
}
