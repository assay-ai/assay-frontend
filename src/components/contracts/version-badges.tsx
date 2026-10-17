import { Clock, Ban } from "lucide-react";
import * as React from "react";

import { deprecatedBadge, newerVersion, retiredBadge, sunsetDay } from "@/features/contracts/text";
import type { ToolVersionBrief } from "@/interfaces/contracts";
import { cn } from "@/utils";

/**
 * Contract version badges (design spec §7.12 "Status chips"): the version a
 * tool serves, "Deprecated" with its sunset day (UTC) and what to use
 * instead, and "Retired". Shared by the catalogue, the tool pages and the
 * tool set editor.
 */

const pill = "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-label-xs [overflow-wrap:anywhere]";

/** "v2.0.0", with "the version agents get by default" one hover away. */
export function VersionChip({ semver, className, title }: { semver: string | null | undefined; className?: string; title?: string }) {
  if (!semver) return null;
  return (
    <span className={cn(pill, "bg-03 font-mono text-02", className)} title={title ?? "The version agents get unless they lock another one"} data-testid="version-chip">
      v{semver}
    </span>
  );
}

/** "Deprecated · stops on Feb 1, 2027 (UTC) · use v2.0.0". */
export function DeprecatedBadge({
  sunsetAt,
  replacement,
  label,
  className,
}: {
  sunsetAt: string | null | undefined;
  replacement?: string | null;
  /** Names which version, e.g. "v1", ahead of the text. */
  label?: string;
  className?: string;
}) {
  const text = `${label ? `${label} ` : ""}${deprecatedBadge(sunsetAt)}${replacement ? ` · use ${replacement}` : ""}`;
  return (
    <span
      className={cn(pill, "bg-warning-10 text-warning-700", className)}
      title="Still works until that day; after it, calls to this version are refused"
      data-testid="deprecated-badge"
    >
      <Clock aria-hidden="true" className="size-3 shrink-0" />
      {text}
    </span>
  );
}

/** "Retired · use v2.0.0". */
export function RetiredBadge({ replacement, label, className }: { replacement?: string | null; label?: string; className?: string }) {
  return (
    <span className={cn(pill, "bg-danger-10 text-danger-700", className)} title="No longer works: calls to this version are refused" data-testid="retired-badge">
      <Ban aria-hidden="true" className="size-3 shrink-0" />
      {label ? `${label} ` : ""}
      {retiredBadge(replacement)}
    </span>
  );
}

/**
 * The badges a catalogue card shows: the current version, and one badge for
 * each older major that is on its way out ("v1 deprecated · stops on …").
 */
export function ToolVersionBadges({
  version,
  versions,
  deprecatedMajors,
  className,
}: {
  version?: string | null;
  versions?: readonly ToolVersionBrief[];
  deprecatedMajors?: readonly number[];
  className?: string;
}) {
  const list = versions ?? [];
  const majors = [...new Set([...(deprecatedMajors ?? []), ...list.filter((v) => v.status === "DEPRECATED").map((v) => v.major)])].sort((a, b) => a - b);
  if (!version && majors.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <VersionChip semver={version} />
      {majors.map((major) => {
        const sunset = list.find((v) => v.major === major && v.sunsetAt)?.sunsetAt ?? null;
        return <DeprecatedBadge key={major} label={`v${major}`} sunsetAt={sunset} replacement={newerVersion(list, major)} />;
      })}
    </span>
  );
}

/** "Stops on Feb 1, 2027 (UTC)" — for a sentence that already says which version. */
export function SunsetText({ sunsetAt }: { sunsetAt: string | null | undefined }) {
  return <span className="tabular-nums">{sunsetDay(sunsetAt)} (UTC)</span>;
}
