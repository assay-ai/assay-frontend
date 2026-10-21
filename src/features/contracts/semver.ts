import type { VersionBump } from "@/interfaces/contracts";

/**
 * Contract versions and version ranges, as assay-backend
 * `tool/domain/contract/semver.ts` and `version-range.ts` define them (design
 * spec §7.5). Pure.
 *
 * A version is `MAJOR.MINOR.PATCH`. A range is a set of majors: `^1`, or
 * `^1 || ^2`. Minors never break anyone, so a range names majors only.
 */

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

const SEMVER_RE = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;

export function parseSemver(text: string | null | undefined): Semver | null {
  const match = SEMVER_RE.exec(text ?? "");
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Negative when `a` is older than `b`; an unparsable string sorts first. */
export function compareSemverText(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return left ? 1 : right ? -1 : 0;
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/** The version after `from` for `bump`; no `from` is the first version, 1.0.0. */
export function bumpSemver(from: string | null, bump: VersionBump | null): string {
  const base = parseSemver(from);
  if (!base) return "1.0.0";
  switch (bump) {
    case "MAJOR":
      return `${base.major + 1}.0.0`;
    case "MINOR":
      return `${base.major}.${base.minor + 1}.0`;
    default:
      return `${base.major}.${base.minor}.${base.patch + 1}`;
  }
}

const BUMP_RANK: Record<VersionBump, number> = { PATCH: 1, MINOR: 2, MAJOR: 3 };

/** The larger of two bumps. */
export function maxBump(a: VersionBump | null, b: VersionBump | null): VersionBump | null {
  const rank = (bump: VersionBump | null) => (bump ? BUMP_RANK[bump] : 0);
  return rank(a) >= rank(b) ? a : b;
}

/* ------------------------------------------------------------------ ranges */

/** The column cap of `tool_version_range`. */
export const VERSION_RANGE_MAX_LENGTH = 32;

const RANGE_RE = /^\^\d{1,4}( \|\| \^\d{1,4})*$/;

/** The majors in a range, ascending and distinct, or null when it is not one. */
export function parseVersionRange(text: string | null | undefined): number[] | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim().replace(/\s*\|\|\s*/g, " || ");
  if (trimmed.length > VERSION_RANGE_MAX_LENGTH || !RANGE_RE.test(trimmed)) return null;
  const majors = trimmed.split(" || ").map((part) => Number(part.slice(1)));
  if (majors.some((major) => major < 1)) return null;
  return [...new Set(majors)].sort((a, b) => a - b);
}

/** The canonical spelling, `^1 || ^2`; an empty list is "". */
export function formatVersionRange(majors: readonly number[]): string {
  return [...new Set(majors)]
    .sort((a, b) => a - b)
    .map((major) => `^${major}`)
    .join(" || ");
}

/** A binding's range; a missing or malformed one reads as the column default `^1`. */
export function bindingMajors(text: string | null | undefined): number[] {
  return parseVersionRange(text ?? "^1") ?? [1];
}

/** "v1", "v1 and v2", "v1, v2 and v3". */
export function majorsText(majors: readonly number[]): string {
  const names = [...new Set(majors)].sort((a, b) => a - b).map((major) => `v${major}`);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** "v1 and v2" for `^1 || ^2`; the raw text when it does not parse. */
export function rangeText(range: string | null | undefined): string {
  const majors = parseVersionRange(range);
  return majors ? majorsText(majors) : (range ?? "");
}

/** The major of a semver, or null. */
export function majorOf(semver: string | null | undefined): number | null {
  return parseSemver(semver)?.major ?? null;
}
