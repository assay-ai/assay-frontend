import { cva } from "class-variance-authority";
import { Check, Minus, X } from "lucide-react";
import * as React from "react";

import { Term } from "@/components/patterns/term";
import type { GlossaryKey } from "@/libs/glossary";
import { cn } from "@/utils";

/**
 * Per-check state. This is a pipeline-stage vocabulary ("did this check run,
 * and how"), distinct from the top-level call verdict (PASS/FAIL/DEGRADED/…)
 * documented in Foundations > Vocabulary. The label shown for each
 * state is taken verbatim from the design and intentionally not
 * caller-overridable, so no screen can drift from the approved wording.
 */
export type StageCheckStatus = "passed" | "failed" | "not-sampled" | "not-reached" | "not-applicable";

export interface StageCheck {
  id?: string;
  /** Check name, e.g. "Response shape". */
  name: string;
  /** A glossary entry that explains the check; the name becomes a `Term`. */
  term?: GlossaryKey;
  status: StageCheckStatus;
  /** Short muted context shown at the end of the row, e.g. "runs on every call". */
  note?: string;
  /**
   * Extra explanatory line under the row. Use `detailVariant: "error"` for a
   * machine-readable failure reason (rendered in mono/danger, matching the
   * design's failed-check detail), or leave it as `"info"` for the plain
   * explanatory sentence the design shows on a passed check.
   */
  detail?: string;
  detailVariant?: "info" | "error";
}

export interface StageListProps extends React.HTMLAttributes<HTMLUListElement> {
  checks: StageCheck[];
}

const STATUS_LABEL: Record<StageCheckStatus, string> = {
  passed: "passed",
  failed: "failed",
  "not-sampled": "not sampled",
  "not-reached": "not reached",
  // The tool declares no such check: nothing was skipped, so it is not "not reached".
  "not-applicable": "does not apply",
};

const STATUS_ICON: Record<StageCheckStatus, "check" | "x" | "minus"> = {
  passed: "check",
  failed: "x",
  "not-sampled": "minus",
  "not-reached": "minus",
  "not-applicable": "minus",
};

const markVariants = cva("shrink-0", {
  variants: {
    status: {
      passed: "text-success-500",
      failed: "text-danger-500",
      "not-sampled": "text-03",
      "not-reached": "text-03",
      "not-applicable": "text-03",
    },
  },
});

const statusTextVariants = cva("w-[130px] shrink-0 text-body-sm", {
  variants: {
    status: {
      passed: "text-success-500",
      failed: "text-danger-500",
      "not-sampled": "text-02",
      "not-reached": "text-02",
      "not-applicable": "text-02",
    },
  },
});

const detailVariants = cva("w-full", {
  variants: {
    variant: {
      info: "text-body-13 text-03",
      error: "text-mono-12 font-mono text-danger-600",
    },
  },
  defaultVariants: {
    variant: "info",
  },
});

const CHECK_MARK_ICON: Record<"check" | "x" | "minus", React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  check: Check,
  x: X,
  minus: Minus,
};

function CheckMarkIcon({
  icon,
  className,
}: {
  icon: "check" | "x" | "minus";
  className?: string;
}) {
  const Icon = CHECK_MARK_ICON[icon];
  return <Icon aria-hidden="true" width={16} height={16} className={className} />;
}

/**
 * A vertical list of verification-pipeline checks (response shape, result
 * quality rules, independent cross-check, relevance judgement, …), each with
 * a status mark, a status word, an optional muted note, and an optional
 * detail line. One component renders both the "all passed" and the "stopped
 * at a failure" cases the design draws — the difference is entirely in the
 * `checks` data, not the markup.
 */
export const StageList = React.forwardRef<HTMLUListElement, StageListProps>(
  ({ checks, className, ...props }, ref) => (
    <ul ref={ref} className={cn("flex w-full flex-col", className)} {...props}>
      {checks.map((check, index) => (
        <li
          key={check.id ?? `${check.name}-${index}`}
          className="flex w-full flex-col gap-1 py-3"
        >
          <div className="flex w-full items-center gap-3">
            <CheckMarkIcon
              icon={STATUS_ICON[check.status]}
              className={markVariants({ status: check.status })}
            />
            <span className="w-[260px] shrink-0 text-label-sm text-01">
              {check.term ? <Term k={check.term}>{check.name}</Term> : check.name}
            </span>
            <span className={statusTextVariants({ status: check.status })}>
              {STATUS_LABEL[check.status]}
            </span>
            {check.note ? (
              <span className="min-w-0 flex-1 text-body-13 text-03">{check.note}</span>
            ) : null}
          </div>
          {check.detail ? (
            <div className="w-full pl-7">
              <p className={detailVariants({ variant: check.detailVariant ?? "info" })}>
                {check.detail}
              </p>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
);
StageList.displayName = "StageList";
