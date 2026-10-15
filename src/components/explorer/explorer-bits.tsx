import { BadgeCheck, Gift, TriangleAlert } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Small pieces the public Explorer and the signed-in Explore share, so a tool
 * row reads the same signed in or out.
 */

/** "Free · 100 calls/day" — a free tier is the way in for a newcomer. */
export function FreeTierBadge({ label, className }: { label: string | null; className?: string }) {
  if (!label) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-teal-10 px-2 py-0.5 text-label-xs text-teal-600",
        className,
      )}
    >
      <Gift aria-hidden="true" className="size-3" />
      {label}
    </span>
  );
}

/** Identity checked by the platform — not a quality claim. */
export function VerifiedMark({ verified, className }: { verified: boolean; className?: string }) {
  if (!verified) return null;
  return (
    <span
      title="Assay checked who this company is. This is not a quality score."
      className={cn("inline-flex items-center gap-1 whitespace-nowrap text-label-xs text-primary-600", className)}
    >
      <BadgeCheck aria-hidden="true" className="size-3.5" />
      Verified
    </span>
  );
}

/** A muted label + value pair, for a row's facts. */
export function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-body-xs text-03">{label}</span>
      <span className="text-body-13 text-01">{children}</span>
    </div>
  );
}

/** A grey "not available right now" tag for a tool nobody is serving. */
export function UnavailableTag() {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-03 px-2 py-0.5 text-label-xs text-02">
      No provider yet
    </span>
  );
}

/**
 * A provider whose observed failure rate is high (see `failsOften`). A warning,
 * not a filter: the provider stays listed and the buyer decides.
 */
export function FailsOftenChip({ className }: { className?: string }) {
  return (
    <span
      title="At least 1 in 5 of this provider's checked calls failed. Failed calls are not charged, but they cost your agent time."
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-warning-10 px-2 py-0.5 text-label-xs text-warning-700",
        className,
      )}
    >
      <TriangleAlert aria-hidden="true" className="size-3" />
      Fails often
    </span>
  );
}
