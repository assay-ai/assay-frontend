import type {
  ContractChange,
  ToolDeprecation,
  ToolVersionBrief,
  ToolVersionStatus,
  VersionBump,
} from "@/interfaces/contracts";

import { compareSemverText, parseSemver } from "./semver";

/**
 * Contract versions in plain words (design spec §6.3, §7.5, §7.12). Every
 * screen that shows a version, a bump, a change, a deprecation or a problem
 * says it through here, so an internal word (`MAJOR`, `FIELD_PROMOTED`,
 * `DEPRECATED`) never reaches a person. Pure; all dates are UTC.
 */

/* ------------------------------------------------------------------- bumps */

export const BUMP_LABEL: Readonly<Record<VersionBump, string>> = Object.freeze({
  PATCH: "Small fix",
  MINOR: "New optional field",
  MAJOR: "Breaking change",
});

/** The one-line explainer of what a version number is, shown once on the editor. */
export const VERSION_NUMBER_HINT =
  "A version is three numbers, like 2.1.0. The last one goes up for wording fixes, the middle one for new optional fields, " +
  "and the first one for a breaking change that providers must re-test for.";

/** "Breaking change → v2.0.0", or "No changes yet". */
export function bumpTitle(bump: VersionBump | null, nextSemver: string | null): string {
  if (!bump) return "No changes yet";
  return `${BUMP_LABEL[bump]} → v${nextSemver ?? "?"}`;
}

/**
 * What publishing a bump does to whom.
 *
 *   bumpEffect("MAJOR", "2.0.0") → "Every provider must re-map and pass a new test for v2 before it serves v2. …"
 */
export function bumpEffect(bump: VersionBump | null, nextSemver: string | null, options: { firstVersion?: boolean } = {}): string {
  if (options.firstVersion) {
    return "This is the first version. Once it is published, providers can serve the tool and it appears in the catalogue.";
  }
  const next = parseSemver(nextSemver);
  switch (bump) {
    case "PATCH":
      return "Wording only. Providers and agents don't need to do anything.";
    case "MINOR":
      return "Nothing breaks. Providers can choose to return the new fields, and agents can ask for them with \"Must return\".";
    case "MAJOR": {
      const n = next?.major ?? 0;
      const old = n > 1 ? `v${n - 1}` : "the old version";
      return (
        `Every provider must re-map and pass a new test for v${n} before it serves v${n}. ` +
        `Agents keep using ${old} until you make v${n} the default, and ${old} keeps running until you deprecate it (at least 90 days' notice).`
      );
    }
    default:
      return "Nothing has changed from the published version yet.";
  }
}

/** The confirm-step button and title name the bump: "Publish breaking change v2.0.0". */
export function publishLabel(bump: VersionBump | null, nextSemver: string, options: { firstVersion?: boolean } = {}): string {
  if (options.firstVersion) return `Publish first version v${nextSemver}`;
  if (!bump) return `Publish v${nextSemver}`;
  const word = bump === "MAJOR" ? "breaking change" : bump === "MINOR" ? "new optional field" : "small fix";
  return `Publish ${word} v${nextSemver}`;
}

/* ----------------------------------------------------------------- changes */

function sideWord(side: "input" | "output" | null): string {
  return side === "input" ? "Input" : side === "output" ? "Output" : "";
}

function duty(side: "input" | "output" | null): string {
  return side === "input" ? "accept" : "return";
}

function capitalise(text: string): string {
  return text.length === 0 ? text : `${text[0]!.toUpperCase()}${text.slice(1)}`;
}

/** One diff line as a sentence: "New optional output field: uv_index". */
export function changeText(change: Pick<ContractChange, "kind" | "side" | "field" | "detail">): string {
  const side = sideWord(change.side);
  const field = change.field ?? "";
  switch (change.kind) {
    case "DOCS_CHANGED":
      if (change.field) return `${side} field ${field}: wording changed`;
      return capitalise(change.detail.replace(/ annotations changed$/, " wording changed"));
    case "FIELD_ADDED_OPTIONAL":
      return `New optional ${side.toLowerCase()} field: ${field}`;
    case "FIELD_ADDED_CORE":
      return `New ${side.toLowerCase()} field every provider must ${duty(change.side)}: ${field}`;
    case "FIELD_REMOVED":
      return `${side} field removed: ${field}`;
    case "FIELD_PROMOTED":
      return `${side} field ${field} is no longer optional: every provider must ${duty(change.side)} it`;
    case "FIELD_DEMOTED":
      return `${side} field ${field} became optional: agents can no longer count on it`;
    case "FIELD_REQUIRED_CHANGED":
      return /now required/.test(change.detail)
        ? `${side} field ${field} is now required`
        : `${side} field ${field} is no longer required`;
    case "TYPE_CHANGED":
      return `${side} field ${field} changed type`;
    case "SCHEMA_CHANGED":
      return `${side} schema rules changed`;
    case "POLICY_CHANGED":
      return "How answers are checked changed (checking rules or tier)";
    default:
      return capitalise(change.detail);
  }
}

/* ---------------------------------------------------------------- problems */

const PROBLEM_TEXT: ReadonlyArray<readonly [RegExp, (m: RegExpExecArray) => string]> = [
  [/^summary is empty$/, () => "Write a one-line summary."],
  [/^summary is longer than (\d+) characters$/, (m) => `Shorten the summary to ${m[1]} characters or fewer.`],
  [/^summary must be one line of plain text$/, () => "Keep the summary on one line."],
  [/^description is empty$/, () => "Write a description."],
  [/^(input|output) schema is not an object$/, (m) => `The ${m[1]} schema must be a JSON object.`],
  [/^(input|output) schema must have type "object"$/, (m) => `The ${m[1]} schema needs "type": "object" at the top.`],
  [/^optional (input|output) field "(.+)" is not in the (?:input|output) schema$/, (m) => `"${m[2]}" is marked optional but is not a field of the ${m[1]} schema.`],
  [/^optional (input|output) field "(.+)" cannot also be required$/, (m) => `"${m[2]}" can't be both optional and required. Remove it from "required" or from the optional list.`],
  [/^(input|output) schema requires "(.+)", which it does not define$/, (m) => `The ${m[1]} schema requires "${m[2]}" but has no such field.`],
  [/^output field "(.+)" is neither required nor optional/, (m) => `Output "${m[1]}" is neither required nor an extra field. Keep it as an extra field, or make it required.`],
  [/^a publish of this draft awaits a second operator \(approval ([^)]+)\); reject it to edit$/, () => "This draft is waiting for approval to publish, so it can't change. Reject that request in Approvals to edit it."],
  [/^the draft changed after its publish was requested; request it again$/, () => "The draft changed after its publish was requested. Send the publish again."],
  [/^v(\d+) is the current major; move the current version first$/, (m) => `v${m[1]} is the version agents get by default. Make another version the default first.`],
  [/^sunsetAt must be at least 90 days from now \(UTC\)$/, () => "Pick a stop date at least 90 days from today (UTC)."],
  [/^identical to v(.+)$/, (m) => `Nothing changed from v${m[1]} yet. Edit something before publishing.`],
  [/^example (\d+) has no arguments object$/, (m) => `Example ${m[1]} needs an "arguments" object.`],
];

/** A problem from the server (or the live check) in plain words. */
export function problemText(problem: string): string {
  for (const [re, say] of PROBLEM_TEXT) {
    const match = re.exec(problem);
    if (match) return say(match);
  }
  const text = capitalise(problem.trim());
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/* -------------------------------------------------------- status and dates */

export const STATUS_LABEL: Readonly<Record<ToolVersionStatus, string>> = Object.freeze({
  DRAFT: "Draft",
  ACTIVE: "Active",
  DEPRECATED: "Deprecated",
  RETIRED: "Retired",
});

/** "Feb 1, 2027" — the UTC day, always with its year (a sunset is months away). */
export function sunsetDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(date);
}

/** "Deprecated · stops on Feb 1, 2027 (UTC)" — the badge text. */
export function deprecatedBadge(sunsetAt: string | null | undefined): string {
  return sunsetAt ? `Deprecated · stops on ${sunsetDay(sunsetAt)} (UTC)` : "Deprecated";
}

/** "Retired on Feb 14, 2027 (UTC) · use v2.0.0" — the badge text. */
export function retiredBadge(replacement: string | null | undefined, sunsetAt?: string | null): string {
  const head = sunsetAt ? `Retired on ${sunsetDay(sunsetAt)} (UTC)` : "Retired";
  return replacement ? `${head} · use ${replacement}` : head;
}

/**
 * What the catalogue names as the replacement of a tool's old majors: "v2.0.0"
 * when it is this tool at a newer major, "get_weather_pro v1.0.0" when it is
 * another tool. null when the API names none.
 */
export function replacementLabel(
  fields: { replacementName?: string | null; replacementVersion?: string | null },
  toolName?: string,
): string | null {
  if (!fields.replacementName) return fields.replacementVersion ? `v${fields.replacementVersion}` : null;
  if (toolName && fields.replacementName === toolName) return fields.replacementVersion ? `v${fields.replacementVersion}` : null;
  return fields.replacementVersion ? `${fields.replacementName} v${fields.replacementVersion}` : fields.replacementName;
}

/** The newest servable version of a newer major than `major`, as "v2.0.0", or null. */
export function newerVersion(versions: readonly Pick<ToolVersionBrief, "semver" | "major" | "status">[], major: number): string | null {
  const newer = versions
    .filter((v) => v.major > major && (v.status === "ACTIVE" || v.status === "DEPRECATED"))
    .sort((a, b) => compareSemverText(b.semver, a.semver))[0];
  return newer ? `v${newer.semver}` : null;
}

/**
 * The full deprecation sentence: "Version 1 stops working on Feb 1, 2027
 * (UTC). Use v2.0.0 instead."
 */
export function deprecationSentence(major: number, deprecation: Pick<ToolDeprecation, "sunsetAt" | "replacement">): string {
  const stops = `Version ${major} stops working on ${sunsetDay(deprecation.sunsetAt)} (UTC).`;
  return deprecation.replacement ? `${stops} Use ${deprecation.replacement} instead.` : stops;
}

/* ----------------------------------------------------------------- sunsets */

export const MIN_SUNSET_DAYS = 90;
const DAY_MS = 86_400_000;

/** The first whole UTC day at or after the API's `earliestSunsetAt`. */
export function sunsetDayFrom(earliestSunsetAt: string): string {
  const at = Date.parse(earliestSunsetAt);
  const day = new Date(at);
  const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return new Date(midnight < at ? midnight + DAY_MS : midnight).toISOString().slice(0, 10);
}

/** "2027-02-01" → "2027-02-01T00:00:00Z", the instant `sunsetAt` takes. */
export function sunsetInstant(day: string): string {
  return `${day}T00:00:00Z`;
}

/** Why a sunset day can't be used, or null. `earliestSunsetAt` is the API's. */
export function sunsetProblem(day: string, earliestSunsetAt: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(sunsetInstant(day)))) return "Pick a date.";
  if (Date.parse(sunsetInstant(day)) < Date.parse(earliestSunsetAt)) {
    const first = sunsetDayFrom(earliestSunsetAt);
    return `Pick ${sunsetDay(sunsetInstant(first))} or later: callers get at least ${MIN_SUNSET_DAYS} days' notice.`;
  }
  return null;
}

/* ------------------------------------------------------------------ fields */

/** "uv_index", "uv_index and humidity", "a, b and c". */
export function fieldList(fields: readonly string[]): string {
  if (fields.length <= 1) return fields[0] ?? "";
  return `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
}

/** "Must return: uv_index" (design spec §6.3). */
export function mustReturnLabel(fields: readonly string[]): string {
  return `Must return: ${fields.join(", ")}`;
}

export const OPTIONAL_OUTPUT_HINT = "Extra fields a provider may choose to return. Agents can insist on one with \"Must return\".";
export const OPTIONAL_INPUT_HINT = "Extra inputs a provider may choose to accept. A call that uses one goes only to providers that accept it.";
