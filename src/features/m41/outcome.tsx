"use client";

import * as React from "react";

import { cn } from "@/utils";

type Tone = "neutral" | "teal" | "warning" | "danger" | "primary";

const TONE_SURFACE: Record<Tone, string> = {
  neutral: "bg-02 border-01",
  teal: "bg-teal-10 border-teal-20",
  warning: "bg-warning-10 border-warning-20",
  danger: "bg-danger-10 border-danger-20",
  primary: "bg-primary-10 border-primary-20",
};
const TONE_ICON: Record<Tone, string> = {
  neutral: "text-03",
  teal: "text-teal-600",
  warning: "text-warning-600",
  danger: "text-danger-600",
  primary: "text-primary-600",
};
const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-02",
  teal: "text-02",
  warning: "text-warning-700",
  danger: "text-danger-700",
  primary: "text-primary-700",
};

/**
 * The designs' Note shape — 15px icon,
 * 13px paragraph, `$radius-lg`, 1px border, padding 14.
 *
 * A local copy rather than `@/features/g30/ui`'s `NoteBox`: that one has no
 * `danger` tone, and a blocked egress address is the one outcome on this
 * screen that has to read as a refusal rather than a caution.
 */
export function Outcome({
  tone = "neutral",
  icon,
  children,
}: {
  tone?: Tone;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn("flex w-full items-start gap-2.5 rounded-lg border p-3.5", TONE_SURFACE[tone])}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-[15px] shrink-0 items-center justify-center [&_svg]:size-[15px]",
          TONE_ICON[tone],
        )}
      >
        {icon}
      </span>
      <div className={cn("min-w-0 flex-1 text-body-13", TONE_TEXT[tone])}>{children}</div>
    </div>
  );
}
