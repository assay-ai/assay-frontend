"use client";

import { Eye } from "lucide-react";
import * as React from "react";

import type { Money, PricingMode } from "@/interfaces";
import { formatMoney } from "@/utils/money";

/**
 * "See how buyers see your tool": the row an agent's owner reads in Explore,
 * drawn from the values on this screen, so a provider sees the effect of a
 * price or a promise before they publish it. It is a preview, not the live
 * row — Explore adds the 30-day calls and the observed failure rate once
 * there are calls to count, and the preview says so.
 */
export function BuyerPreview({
  toolName,
  description,
  mode,
  price,
  freeCalls,
  failureRate,
  hasCalls = false,
  className,
}: {
  toolName: string;
  description?: string | null;
  mode: PricingMode;
  price: Money | null;
  freeCalls: number | null;
  /** Fraction, e.g. 0.02. */
  failureRate: number | null;
  /** The listing has served calls: Explore shows their numbers next to this row already. */
  hasCalls?: boolean;
  className?: string;
}) {
  // A paid mode with no price typed yet is not "Free": say the price is still to come.
  const priceText =
    mode === "FREE" ? "Free" : price ? `${formatMoney(price, { decimals: 4 })} a call` : "Price not set yet";
  return (
    <section aria-label="How buyers see your tool" className={className}>
      <p className="mb-2 flex items-center gap-1.5 text-label-13 text-02">
        <Eye aria-hidden="true" className="size-3.5" />
        How buyers see your tool
      </p>
      <div className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-01 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-label-sm text-01">{toolName}</span>
          <span className="font-mono text-mono-13 text-01">{priceText}</span>
        </div>
        {description ? <p className="text-body-13 text-02">{description}</p> : null}
        <div className="flex flex-wrap gap-1.5">
          {mode === "FREEMIUM" && freeCalls ? (
            <span className="rounded-full bg-teal-10 px-2 py-0.5 text-label-xs text-teal-600">
              {`Free · ${freeCalls.toLocaleString("en-US")} calls a day per agent`}
            </span>
          ) : null}
          {mode !== "FREE" ? (
            <span className="rounded-full bg-success-10 px-2 py-0.5 text-label-xs text-success-700">
              Not charged when a result fails the check
            </span>
          ) : null}
          {failureRate !== null ? (
            <span className="rounded-full bg-03 px-2 py-0.5 text-label-xs text-02">
              {`Promises under ${Number((failureRate * 100).toFixed(2))}% failures`}
            </span>
          ) : null}
          {mode !== "FREE" ? (
            <span className="rounded-full bg-03 px-2 py-0.5 text-label-xs text-02">Backed by your stake</span>
          ) : null}
        </div>
        <p className="text-body-xs text-03">
          {hasCalls
            ? "In Explore, buyers also see this tool's calls in the last 30 days and its measured failure rate."
            : "Calls and the measured failure rate appear here after your first calls."}
        </p>
      </div>
    </section>
  );
}
