import { Clock, Ban } from "lucide-react";
import * as React from "react";

import { deprecatedBadge, newerVersion, replacementLabel, retiredBadge } from "@/features/contracts/text";
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

/** "Retired on Feb 14, 2027 (UTC) · use v2.0.0". */
export function RetiredBadge({
  replacement,
  label,
  sunsetAt,
  className,
}: {
  replacement?: string | null;
  label?: string;
  /** The day it stopped. */
  sunsetAt?: string | null;
  className?: string;
}) {
  return (
    <span className={cn(pill, "bg-danger-10 text-danger-700", className)} title="No longer works: calls to this version are refused" data-testid="retired-badge">
      <Ban aria-hidden="true" className="size-3 shrink-0" />
      {label ? `${label} ` : ""}
      {retiredBadge(replacement, sunsetAt)}
    </span>
  );
}

/**
 * The badges a catalogue card shows: the current version, and one badge for
 * each older major on its way out ("v1 Deprecated · stops on …") or gone
 * ("v1 Retired on … · use v2.0.0"), naming the replacement the API gives.
 */
export function ToolVersionBadges({
  name,
  version,
  versions,
  deprecatedMajors,
  replacementName,
  replacementVersion,
  className,
}: {
  name?: string;
  version?: string | null;
  versions?: readonly ToolVersionBrief[];
  deprecatedMajors?: readonly number[];
  replacementName?: string | null;
  replacementVersion?: string | null;
  className?: string;
}) {
  const list = versions ?? [];
  const deprecated = [...new Set([...(deprecatedMajors ?? []), ...list.filter((v) => v.status === "DEPRECATED").map((v) => v.major)])].sort((a, b) => a - b);
  const retired = [...new Set(list.filter((v) => v.status === "RETIRED").map((v) => v.major))].filter((m) => !deprecated.includes(m)).sort((a, b) => a - b);
  if (!version && deprecated.length === 0 && retired.length === 0) return null;
  const named = replacementLabel({ replacementName, replacementVersion }, name);
  const replacementFor = (major: number) => named ?? newerVersion(list, major);
  const sunsetOf = (major: number) => list.find((v) => v.major === major && v.sunsetAt)?.sunsetAt ?? null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)}>
      <VersionChip semver={version} />
      {deprecated.map((major) => (
        <DeprecatedBadge key={major} label={`v${major}`} sunsetAt={sunsetOf(major)} replacement={replacementFor(major)} />
      ))}
      {retired.map((major) => (
        <RetiredBadge key={major} label={`v${major}`} sunsetAt={sunsetOf(major)} replacement={replacementFor(major)} />
      ))}
    </span>
  );
}
