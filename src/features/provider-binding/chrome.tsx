"use client";

import Decimal from "decimal.js";
import * as React from "react";

import type { Money } from "@/interfaces";
import { cn } from "@/utils";

/**
 * Shared chrome for the two binding-configuration screens — the pricing screen
 * ("Pricing and tier") and the free-tier screen ("Free-tier controls").
 *
 * Both designs draw the same two structures and nothing else that is reusable:
 * a Page Header (titles left, actions right) and a tinted "Note" strip. The
 * Note is drawn as a bespoke frame in each screen, **not** as a ref to the
 * Banner component — its geometry (gap 10, padding 15, radius-lg,
 * 15px icon) and its single 13px/1.6 paragraph in the ramp's `-700` step do
 * not match Banner, which is gap 14 / padding 14-16 and splits a `-01` title
 * from a `-02` description. Reproducing it here keeps `banner.tsx` honest.
 */

export function PageHeader({
  title,
  sub,
  actions,
}: {
  title: React.ReactNode;
  sub: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 flex-1 basis-[16rem] flex-col gap-0.5">
        {/* 23px/600/-0.5 in the design; `heading-md` is the nearest step. */}
        <h1 className="break-all text-heading-md text-01 tablet:truncate">{title}</h1>
        <p className="break-words font-mono text-mono-12 text-03">{sub}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

export type NoteTone = "warning" | "primary" | "teal";

const noteBox: Record<NoteTone, string> = {
  warning: "bg-warning-10 border-warning-20",
  primary: "bg-primary-10 border-primary-20",
  teal: "bg-teal-10 border-teal-20",
};

const noteIcon: Record<NoteTone, string> = {
  warning: "text-warning-600",
  primary: "text-primary-600",
  teal: "text-teal-600",
};

/**
 * The design tints the note's text with the ramp's `-700` step — except on
 * The free-tier screen, where the teal note's text is a **raw `#000000`**, not a token. There
 * is no `teal-700` in the ramp either (it stops at 600), so the teal note uses
 * `text-01`. Both facts are in the report.
 */
const noteText: Record<NoteTone, string> = {
  warning: "text-warning-700",
  primary: "text-primary-700",
  teal: "text-01",
};

export function Note({
  tone,
  icon,
  children,
  className,
}: {
  tone: NoteTone;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border p-[15px]",
        noteBox[tone],
        className
      )}
    >
      <span className={cn("mt-[3px] flex size-[15px] shrink-0 items-center justify-center", noteIcon[tone])}>
        {icon}
      </span>
      <p className={cn("min-w-0 flex-1 text-body-13 leading-[1.6]", noteText[tone])}>{children}</p>
    </div>
  );
}

// ── Money at the form boundary ─────────────────────────────────────────────

/**
 * The one glyph this codebase uses for "we do not know", as opposed to zero.
 * A zero here would read as a measured zero — the distinction the design system and
 * `ProviderStake`'s three absence flags both exist to keep.
 */
export const UNKNOWN = "—";

/** Minor units in a string -> the major-unit text a `<input>` shows. */
export function majorInputFromMoney(money: Money | null | undefined): string {
  if (!money) return "";
  return new Decimal(money.amount || "0").div(new Decimal(10).pow(money.decimals)).toFixed();
}

/**
 * `freeDailyBudget` is read back as a **`number`** and written as a digits-only
 * string, both in minor units. That asymmetry is the backend's; this is the one
 * place the read side is converted, and it is converted to a `Money` rather
 * than laundered into the write type — so every render still goes through
 * `formatMoney` and no amount is ever a JS number downstream.
 *
 * A value outside the safe-integer range is returned as `null`: `String(1e21)`
 * is `"1e+21"`, which is not a minor-unit amount, and silently shipping it
 * would be worse than showing "unknown".
 */
export function moneyFromMinorNumber(
  value: number | null | undefined,
  asset: string,
  decimals: number
): Money | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value)) return null;
  return { amount: String(value), asset, decimals };
}

export interface MinorUnitsResult {
  /** Digits only, minor units — exactly what the write DTO validates. */
  amount: string | null;
  /** Set when the text cannot be a minor-unit amount at this scale. */
  error: string | null;
}

/**
 * Major-unit text from a form field -> the digits-only minor-unit string the
 * PATCH body takes. Empty text is `{ amount: null }`, which the callers map to
 * "omit the key" or "send `null`" themselves — the two are distinguishable on
 * purpose and this helper does not collapse them.
 */
export function minorUnitsFromMajorInput(text: string, decimals: number): MinorUnitsResult {
  const trimmed = text.trim();
  if (trimmed === "") return { amount: null, error: null };
  // At least one digit: "." alone matches a loose `\d*(\.\d*)?` and makes
  // Decimal throw. "5." and ".5" stay valid.
  if (!/^(\d+\.?\d*|\.\d+)$/.test(trimmed)) {
    return { amount: null, error: "Digits and one decimal point only." };
  }

  const scaled = new Decimal(trimmed).mul(new Decimal(10).pow(decimals));
  if (!scaled.isInteger()) {
    return { amount: null, error: `At most ${decimals} decimal places.` };
  }
  // The PATCH read-back is a JSON number; anything past 2^53 comes back rounded.
  if (scaled.gt(Number.MAX_SAFE_INTEGER)) return { amount: null, error: "Too large." };
  return { amount: scaled.toFixed(0), error: null };
}

/** A whole-number form field -> `number | null`, or an error. */
export function integerFromInput(text: string): { value: number | null; error: string | null } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: null, error: null };
  if (!/^\d+$/.test(trimmed)) return { value: null, error: "Whole numbers only." };
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) return { value: null, error: "Too large." };
  return { value: parsed, error: null };
}
