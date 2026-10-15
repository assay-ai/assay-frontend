import { Check, CircleAlert, CircleDot, FileX, Loader, Minus, ServerCrash, X } from "lucide-react";
import * as React from "react";

import { Term } from "@/components/patterns/term";
import { receiptStateLabel } from "@/features/call-classes/labels";
import type { GlossaryKey } from "@/libs/glossary";
import { cn } from "@/utils";

import type { StateCard, StateTone } from "./receipt-state";
import type { Receipt } from "./wire";

/**
 * The parts of the receipt screens that are not design-system
 * components: the two headlines and the state cards. Every string these render
 * is passed in from `receipt-state.ts`, which holds the verbatim copy.
 */

/* ---------------------------------------------------------------- amounts */

export interface AmountProps {
  label: string;
  value: string;
  teal?: boolean;
  /** The mobile (390px) design lays these left-aligned in a row instead. */
  align?: "start" | "end";
  className?: string;
}

/**
 * A headline money figure. The design draws these at 22px mono/600, a size the
 * mono scale does not have — `text-mono-xl` (26px) is the nearest step and is a
 * real 4px divergence, not a rounding artifact.
 */
export function Amount({ label, value, teal, align = "end", className }: AmountProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-[3px]",
        align === "end" ? "items-end" : "items-start",
        className,
      )}
    >
      <span className="text-body-xs text-03 tablet:text-body-13">{label}</span>
      {/* 14px at 390, 22px on desktop — the mono scale's
          nearest steps are 14 and 26. */}
      <span
        className={cn(
          "font-mono text-mono-sm font-semibold tablet:text-mono-xl tablet:font-normal",
          teal ? "text-teal-600" : "text-01",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- headlines */

export interface ChargedHeadlineProps {
  headline: string;
  sub: string | null;
  listed: string;
  paid: string;
  /**
   * The the design shows a THIRD figure in the headline where the
   * the design shows two — at 390 there is no "What this call cost"
   * panel to carry the delta, so the headline carries it instead.
   */
  notCharged: string;
}

/** The charged receipt's headline: white surface, the sentence, listed and paid side by side. */
export function ChargedHeadline({ headline, sub, listed, paid, notCharged }: ChargedHeadlineProps) {
  return (
    <section className="flex w-full flex-col gap-5 rounded-xl border border-01 bg-01 px-[22px] py-[18px] tablet:flex-row tablet:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <h2 className="text-heading-sm text-01">{headline}</h2>
        {sub ? <p className="text-body-sm text-02">{sub}</p> : null}
      </div>
      <div className="flex w-full items-center gap-3 tablet:w-auto tablet:shrink-0 tablet:gap-9">
        <Amount
          label="Listed price"
          value={listed}
          align="start"
          className="min-w-0 flex-1 tablet:flex-none tablet:items-end"
        />
        <Amount
          label="You paid"
          value={paid}
          align="start"
          className="min-w-0 flex-1 tablet:flex-none tablet:items-end"
        />
        <Amount
          label="Not charged"
          value={notCharged}
          teal
          align="start"
          className="min-w-0 flex-1 tablet:hidden"
        />
      </div>
    </section>
  );
}

export interface NotChargedHeadlineProps {
  listed: string;
  paid: string;
  notCharged: string;
  /** The first line. Verbatim, and it changes with the state. */
  headline: string;
  /**
   * True only when the call actually failed our checks. The design's second
   * line ends "…the call failed our checks, and the reservation was lifted",
   * which is a claim about WHY, and it is false on a call that expired or was
   * never judged. The first half is true of every uncharged call, so that half
   * stands alone when the second half would not be true.
   */
  failedChecks: boolean;
  /** What happened to the money, for this call's reason. Replaces the default line. */
  explain?: string;
}

/**
 * The not-charged receipt's headline. The teal surface carries the counterfactual, and all THREE
 * figures render — listed, paid and the difference — because "not charged" is
 * an amount, never a badge.
 */
export function NotChargedHeadline({
  headline,
  listed,
  paid,
  notCharged,
  failedChecks,
  explain,
}: NotChargedHeadlineProps) {
  return (
    <section className="flex w-full flex-col gap-6 rounded-xl border border-teal-20 bg-teal-10 px-6 py-5 tablet:flex-row tablet:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
        <h2 className="text-heading-sm text-teal-600">{headline}</h2>
        <p className="text-body-sm text-02">
          {explain ??
            (failedChecks
              ? "Refunds are a released hold, so your balance never changes. The money was reserved, the call failed our checks, and the reservation was lifted."
              : "Refunds are a released hold, so your balance never changes.")}
        </p>
      </div>
      <div className="flex w-full items-end gap-3 tablet:w-auto tablet:shrink-0 tablet:gap-8">
        <Amount
          label="Listed price"
          value={listed}
          align="start"
          className="min-w-0 flex-1 tablet:flex-none tablet:items-end"
        />
        <Amount
          label="You paid"
          value={paid}
          align="start"
          className="min-w-0 flex-1 tablet:flex-none tablet:items-end"
        />
        <Amount
          label="Not charged"
          value={notCharged}
          teal
          align="start"
          className="min-w-0 flex-1 tablet:flex-none tablet:items-end"
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- state cards */

const STATE_ICON: Record<StateCard["icon"], React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  loader: Loader,
  "circle-dot": CircleDot,
  "circle-alert": CircleAlert,
  "server-crash": ServerCrash,
  "file-x": FileX,
};

const TONE_ICON: Record<StateTone, string> = {
  primary: "text-primary-500",
  neutral: "text-03",
  warning: "text-warning-500",
  danger: "text-danger-500",
};

const TONE_CODE: Record<StateTone, string> = {
  primary: "text-primary-600",
  neutral: "text-02",
  warning: "text-warning-600",
  danger: "text-danger-600",
};

export interface StateCardBlockProps {
  card: StateCard;
  receipt: Receipt;
  /** Marks the card that describes THIS call rather than a sibling state. */
  current?: boolean;
  className?: string;
}

/**
 * One of the five cards from `LmsKR` > "The other states this screen has to
 * render". Each state owns its own sentence — the design's reason is written
 * into that panel's own subtitle: collapsing them into one "error" is a
 * three-year support tax.
 */
export function StateCardBlock({ card, receipt, current, className }: StateCardBlockProps) {
  const Icon = STATE_ICON[card.icon];
  return (
    <div
      data-state={card.code}
      data-current={current ? "true" : undefined}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-2.5 rounded-lg border bg-02 p-4",
        current ? "border-primary-20" : "border-01",
        className,
      )}
    >
      {/* The name in words; the API's own value stays in the raw JSON. */}
      <div className="flex w-full items-start gap-2">
        <Icon
          aria-hidden="true"
          className={cn("mt-0.5 size-[15px] shrink-0", TONE_ICON[card.tone])}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("text-label-13", TONE_CODE[card.tone])}>
            {receiptStateLabel(card.code)}
          </span>
        </div>
      </div>
      <p className="w-full text-body-13 text-01">{card.sentence}</p>
      <p
        className={cn(
          "font-mono text-mono-13 font-semibold",
          card.moneyTeal ? "text-teal-600" : "text-02",
        )}
      >
        {card.money(receipt)}
      </p>
    </div>
  );
}

/* ------------------------------------------------------- mobile stage list */

const MOBILE_MARK: Record<string, { icon: typeof Check; className: string }> = {
  passed: { icon: Check, className: "text-success-500" },
  failed: { icon: X, className: "text-danger-500" },
  "not-sampled": { icon: Minus, className: "text-03" },
  "not-reached": { icon: Minus, className: "text-03" },
};

const MOBILE_WORD: Record<string, string> = {
  passed: "passed",
  failed: "failed",
  "not-sampled": "not sampled",
  "not-reached": "not reached",
};

export interface MobileStageListProps {
  checks: { id?: string; name: string; term?: GlossaryKey; status: string; note?: string; detail?: string }[];
}

/**
 * The 390 stage list from `hDbAL`, which is a DIFFERENT layout from the
 * desktop `StageList` — not a narrower one. `StageList` lays its row out as
 * 260px name + 130px status + note, which is 430px of fixed width before any
 * padding: at 390 it overflows its panel and clips the status word, so the
 * design draws the mobile row as icon + a stacked name over
 * "status · note" instead. Same vocabulary, same rule that a stage which did
 * not run never shows a tick.
 */
export function MobileStageList({ checks }: MobileStageListProps) {
  return (
    <ul className="flex w-full flex-col">
      {checks.map((check, index) => {
        const mark = MOBILE_MARK[check.status] ?? MOBILE_MARK["not-reached"];
        const Icon = mark.icon;
        return (
          <li key={check.id ?? index} className="flex w-full items-center gap-2.5 py-3">
            <Icon aria-hidden="true" className={cn("size-[15px] shrink-0", mark.className)} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-label-13 text-01">
                {check.term ? <Term k={check.term}>{check.name}</Term> : check.name}
              </span>
              <span className="text-body-xs text-03">
                {MOBILE_WORD[check.status] ?? check.status}
                {check.note ? ` · ${check.note}` : ""}
              </span>
              {check.detail ? (
                <span className={cn("text-body-xs", check.status === "failed" ? "text-danger-600" : "text-03")}>
                  {check.detail}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ----------------------------------------------------------------- metabar */

export interface MetaItem {
  label: string;
  value: string;
  /** Renders the value as a link colour, as the design does for Transaction. */
  accent?: boolean;
}

export function MetaBar({ items }: { items: MetaItem[] }) {
  return (
    <section className="grid w-full grid-cols-2 gap-5 rounded-xl border border-01 bg-01 px-5 py-[15px] tablet:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col gap-[3px]">
          <span className="text-body-xs text-03">{item.label}</span>
          <span
            className={cn(
              "truncate font-mono text-mono-13",
              item.accent ? "text-primary-500" : "text-01",
            )}
          >
            {item.value}
          </span>
        </div>
      ))}
    </section>
  );
}

/* ---------------------------------------------------------------- io panel */

export function CodePane({ label, body }: { label: string; body: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <span className="font-mono text-mono-2xs tracking-[1.2px] text-03">{label}</span>
      <pre className="w-full overflow-x-auto rounded-lg border border-01 bg-02 p-3.5 font-mono text-mono-12 leading-[1.7] text-01">
        {body}
      </pre>
    </div>
  );
}
