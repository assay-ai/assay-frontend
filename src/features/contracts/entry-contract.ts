import type { ToolContractVersion, ToolVersionBrief, ToolVersionStatus } from "@/interfaces/contracts";

import { compareSemverText, formatVersionRange, parseVersionRange } from "./semver";
import { fieldList, mustReturnLabel, sunsetDay } from "./text";

/**
 * A tool set entry's contract terms (design spec §6.3, §7.3, T3): "Must
 * return: uv_index" (`requireOutputFields`) and the contract version
 * (`toolVersionRange`, majors only). The chip words, the choices the editor
 * offers and the warnings, from the tool's published versions. Pure.
 */

type VersionLike = Pick<ToolVersionBrief, "version" | "semver" | "major" | "status" | "sunsetAt" | "isCurrent"> & { changelog?: string | null };

/** "Calls can go to providers of v1 or v2" — what more than one version in a row means. */
export const MANY_VERSIONS_HINT =
  "With more than one version ticked, a call can go to a provider of any of them, so your agent must handle both shapes. The newest one a provider serves is used.";

export interface MajorChoice {
  major: number;
  /** The newest version in this major, e.g. "2.0.0". */
  latestSemver: string;
  status: ToolVersionStatus;
  sunsetAt: string | null;
  /** Unpinned URLs serve this major. */
  isCurrent: boolean;
}

/** One choice per published major, newest major first. A major's status is its newest version's. */
export function majorChoices(versions: readonly VersionLike[]): MajorChoice[] {
  const byMajor = new Map<number, VersionLike[]>();
  for (const v of versions) {
    if (v.status === "DRAFT") continue;
    byMajor.set(v.major, [...(byMajor.get(v.major) ?? []), v]);
  }
  return [...byMajor.entries()]
    .map(([major, list]) => {
      const newest = [...list].sort((a, b) => compareSemverText(b.semver, a.semver))[0]!;
      return {
        major,
        latestSemver: newest.semver,
        status: newest.status,
        sunsetAt: newest.sunsetAt,
        isCurrent: list.some((v) => v.isCurrent),
      };
    })
    .sort((a, b) => b.major - a.major);
}

/** The major unpinned URLs serve, or null. */
export function currentMajorOf(versions: readonly VersionLike[]): number | null {
  return versions.find((v) => v.isCurrent)?.major ?? null;
}

/**
 * The majors an entry routes to: its range, or the current major when it has
 * none (what the server stores for a new entry).
 */
export function entryMajors(range: string | null | undefined, versions: readonly VersionLike[]): number[] {
  const parsed = parseVersionRange(range);
  if (parsed) return parsed;
  const current = currentMajorOf(versions);
  return current ? [current] : [];
}

/** The newest version of each major in `majors`. */
function newestIn(versions: readonly ToolContractVersion[], majors: readonly number[]): ToolContractVersion[] {
  return majors
    .map((major) => versions.filter((v) => v.major === major && v.status !== "DRAFT").sort((a, b) => compareSemverText(b.semver, a.semver))[0])
    .filter((v): v is ToolContractVersion => Boolean(v));
}

/** The optional output fields offered by the majors in range (their newest versions), in order. */
export function optionalOutputsFor(versions: readonly ToolContractVersion[], majors: readonly number[]): string[] {
  return [...new Set(newestIn(versions, majors).flatMap((v) => v.optionalOutputFields))];
}

/** The optional input fields offered by the majors in range. */
export function optionalInputsFor(versions: readonly ToolContractVersion[], majors: readonly number[]): string[] {
  return [...new Set(newestIn(versions, majors).flatMap((v) => v.optionalInputFields))];
}

/** "v1 only", "v1 or v2", "v1, v2 or v3". */
export function majorsChipText(majors: readonly number[]): string {
  const names = [...new Set(majors)].sort((a, b) => a - b).map((m) => `v${m}`);
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} only`;
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * The contract part of the row chip: "Must return: uv_index", and the
 * version when it is not simply the current major ("v1 only", "v1 or v2").
 */
export function contractChipParts(
  entry: { toolVersionRange?: string | null; requireOutputFields?: readonly string[] },
  currentMajor: number | null,
): string[] {
  const parts: string[] = [];
  const required = entry.requireOutputFields ?? [];
  if (required.length > 0) parts.push(mustReturnLabel([...required]));
  const majors = parseVersionRange(entry.toolVersionRange);
  // Named as the tool's version, so it never reads like the tool set's own "Lock to v3".
  if (majors && !(majors.length === 1 && majors[0] === currentMajor)) parts.push(`tool ${majorsChipText(majors)}`);
  return parts;
}

/** The label of one major in the contract-version editor. */
export function majorChoiceLabel(choice: MajorChoice): string {
  const base = `v${choice.major} (latest ${choice.latestSemver})`;
  if (choice.status === "RETIRED") return `${base} · retired, no longer works`;
  if (choice.status === "DEPRECATED") return `${base} · stops on ${sunsetDay(choice.sunsetAt)} (UTC)`;
  return choice.isCurrent ? `${base} · current` : base;
}

export interface EntryContractWarning {
  tone: "warning" | "danger";
  text: string;
  /** The range that fixes it ("Allow v2"), when a newer servable major exists. */
  fix: { label: string; range: string } | null;
}

/**
 * A row whose versions are all on their way out: every major in range is
 * deprecated (it stops on its sunset) or retired (calls are refused now).
 */
export function entryContractWarning(range: string | null | undefined, versions: readonly VersionLike[]): EntryContractWarning | null {
  const choices = majorChoices(versions);
  const majors = entryMajors(range, versions);
  const inRange = choices.filter((c) => majors.includes(c.major));
  if (inRange.length === 0 || inRange.some((c) => c.status === "ACTIVE")) return null;
  const newer = choices.find((c) => c.status === "ACTIVE" && !majors.includes(c.major) && c.major > Math.max(...majors));
  const fix = newer ? { label: `Allow v${newer.major}`, range: formatVersionRange([...majors, newer.major]) } : null;
  // What the newer version changes, from its own changelog, so "Allow v2" is not a leap in the dark.
  const changed = newer ? versions.find((v) => v.major === newer.major && v.changelog)?.changelog ?? null : null;
  const allowText = newer ? ` Allow v${newer.major} too: calls can then use either.${changed ? ` v${newer.major}: ${changed}` : ""}` : "";
  const names = majorsChipText(majors).replace(/ only$/, "");
  if (inRange.every((c) => c.status === "RETIRED")) {
    return { tone: "danger", text: `Uses ${names}, which was retired: calls to this tool are refused.${allowText}`, fix };
  }
  const soonest = inRange.map((c) => c.sunsetAt).filter((s): s is string => Boolean(s)).sort()[0];
  return { tone: "warning", text: `Uses ${names}, which stops working on ${sunsetDay(soonest)} (UTC).${allowText}`, fix };
}

/** "Must return" fields that the chosen majors no longer offer (they would refuse every call). */
export function unknownRequiredFields(required: readonly string[], offered: readonly string[], coreOutputs: readonly string[] = []): string[] {
  return required.filter((field) => !offered.includes(field) && !coreOutputs.includes(field));
}

/** "Only providers that return uv_index serve these calls." */
export function mustReturnEffect(required: readonly string[]): string {
  if (required.length === 0) return "Any provider's answer is fine.";
  return `Only providers that return ${fieldList(required)} serve these calls, so fewer may fit.`;
}
