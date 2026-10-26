import { buildMcpUrl } from "@/features/connect/mcp-url";
import { mcpHost } from "@/features/connect/mcp-endpoint";
import { rangeText } from "@/features/contracts/semver";
import { DEPOSIT_MINIMUM_USD } from "@/features/explorer/buyer-costs";
import { formatDate } from "@/libs/utc-time";
import type { Money } from "@/interfaces";
import type {
  OrgHandle,
  Toolset,
  ToolsetDiff,
  ToolsetSummary,
  ToolsetVersion,
  ToolsetVisibility,
} from "@/services/toolsets.service";

import { settingLabel, VISIBILITY_LABELS } from "./labels";

/**
 * The Share dialog, versions and their diffs (design spec §7.7, §7.10). Pure:
 * every state the dialog can be in is a value here, so each is tested
 * without a browser.
 */

/* ------------------------------------------------------- public name */

/** The reserved words of §7.1 (categories are checked by the server). */
const RESERVED = new Set([
  "assay", "official", "platform", "system", "admin", "operator", "mcp", "x402", "std", "standard",
  "tool", "tools", "toolset", "toolsets", "my", "u", "c", "t", "api", "docs", "status", "health", "support", "help",
]);

export const HANDLE_RE = /^[a-z][a-z0-9-]{2,23}$/;

/** "@Acme " → "acme": what a person typed, as the name it would be. */
export function normaliseHandle(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

export function isReservedHandle(input: string): boolean {
  return RESERVED.has(normaliseHandle(input));
}

/** Free-looking names next to one that can't be had: "acme" → acme-hq, acme-team, acme-labs. */
export function handleSuggestions(input: string): string[] {
  const base = normaliseHandle(input).replace(/[^a-z0-9-]/g, "").slice(0, 18) || "team";
  return [`${base}-hq`, `${base}-team`, `${base}-labs`].filter((h) => HANDLE_RE.test(h) && !RESERVED.has(h));
}

/** Checked before the request, in the same words the server's refusal gets. Null when it looks fine. */
export function handleProblem(input: string): string | null {
  const handle = normaliseHandle(input);
  if (handle === "") return "Choose a public name first.";
  if (!HANDLE_RE.test(handle)) return "Use 3–24 lowercase letters, digits or “-”, starting with a letter.";
  if (RESERVED.has(handle)) return `@${handle} is reserved. Try another name.`;
  return null;
}

export interface HandleErrorView {
  text: string;
  /** Free names to pick with one click. */
  suggestions: string[];
  /** A next step that lives elsewhere ("Add funds"). */
  action: { label: string; href: string } | null;
  /** On a refusal for funding: the least deposit that opens the claim, in whole dollars ("5"). */
  minimumDepositUsd?: string;
}

/** The server's minimum when it sent a plain amount, else the deposit drawer's own. */
function minimumDepositOf(context: Readonly<Record<string, unknown>> | undefined): string {
  const raw = context?.minimumDepositUsd;
  const text = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? String(raw) : typeof raw === "string" ? raw : "";
  return /^\d{1,6}(\.\d{1,2})?$/.test(text) ? text : DEPOSIT_MINIMUM_USD;
}

/** A refused claim, as a person reads it: never the code, always what to do next. */
export function handleErrorView(code: string | null, context: Readonly<Record<string, unknown>> | undefined, asked: string): HandleErrorView {
  const handle = normaliseHandle(asked);
  const none = { suggestions: [], action: null };
  switch (code) {
    case "TOOLSET_HANDLE_INVALID":
      return context?.reason === "RESERVED"
        ? { text: `@${handle} is reserved. These are free to try:`, suggestions: handleSuggestions(handle), action: null }
        : { text: "Use 3–24 lowercase letters, digits or “-”, starting with a letter.", ...none };
    case "TOOLSET_HANDLE_TAKEN": {
      const suggestions = Array.isArray(context?.suggestions)
        ? (context.suggestions as unknown[]).filter((s): s is string => typeof s === "string" && HANDLE_RE.test(s)).slice(0, 3)
        : [];
      return { text: suggestions.length > 0 ? `@${handle} is taken. These are free:` : `@${handle} is taken. Try another name.`, suggestions, action: null };
    }
    case "TOOLSET_HANDLE_LOCKED":
      return { text: "Your public name is in use by a shared tool set, so it can't change here. Ask support to rename it.", ...none };
    case "TOOLSET_HANDLE_CLAIM_REFUSED": {
      if (context?.reason === "CLAIM_LIMIT") {
        return { text: "You chose public names for 3 teams in the last 30 days. Try again later, or ask support.", ...none };
      }
      // NOT_VERIFIED: funded once opens the claim; a set-up provider's first name is free (onboarding wave 3).
      const minimumDepositUsd = minimumDepositOf(context);
      return {
        text:
          context?.providerSetUp === true
            ? `Your free public name is already used. Add at least $${minimumDepositUsd} in funds once to choose another.`
            : `Add at least $${minimumDepositUsd} in funds once, or finish provider setup, before you choose a public name. It keeps names from being grabbed in bulk.`,
        suggestions: [],
        action: { label: "Add funds", href: "/funding?action=deposit" },
        minimumDepositUsd,
      };
    }
    case "TOOLSET_HANDLE_REQUIRED":
      return { text: "Choose a public name before sharing.", ...none };
    default:
      return { text: "The public name could not be saved. Try again.", ...none };
  }
}

/* ------------------------------------------------------------ diffs */

/** What a version (or the Draft) holds, for comparing two of them. */
export interface Snapshot {
  name: string;
  description: string | null;
  icon: string | null;
  discovery: string;
  pinnedTools: string[];
  entries: {
    toolId: string;
    toolName: string;
    providerMode: string;
    providerIds: string[];
    minTier: string | null;
    maxPrice: Pick<Money, "amount" | "asset"> | null;
    minQuality: number | null;
    onEmpty: string;
    /** T3: contract majors, e.g. "^1". */
    toolVersionRange?: string | null;
    /** T3: "Must return". */
    requireOutputFields?: string[];
  }[];
}

export function snapshotOfDraft(set: Toolset): Snapshot {
  return {
    name: set.name,
    description: set.description,
    icon: set.icon,
    discovery: set.discovery,
    pinnedTools: set.pinnedTools,
    entries: set.entries,
  };
}

export function snapshotOfVersion(version: ToolsetVersion): Snapshot {
  return version;
}

function ruleKey(entry: Snapshot["entries"][number]): string {
  return JSON.stringify([
    entry.providerMode,
    [...entry.providerIds].sort(),
    entry.minTier,
    entry.maxPrice ? [entry.maxPrice.amount, entry.maxPrice.asset] : null,
    entry.minQuality,
    entry.onEmpty,
    entry.toolVersionRange ?? null,
    [...(entry.requireOutputFields ?? [])].sort(),
  ]);
}

/** The backend's diff (`domain/snapshot.ts`), computed here for the Draft against the last version. */
export function diffSnapshots(before: Snapshot | null, after: Snapshot): ToolsetDiff {
  const old = new Map((before?.entries ?? []).map((e) => [e.toolId, e]));
  const now = new Map(after.entries.map((e) => [e.toolId, e]));
  const added = after.entries.filter((e) => !old.has(e.toolId)).map((e) => e.toolName);
  const removed = (before?.entries ?? []).filter((e) => !now.has(e.toolId)).map((e) => e.toolName);
  const rulesChanged = after.entries
    .filter((e) => old.has(e.toolId) && ruleKey(old.get(e.toolId)!) !== ruleKey(e))
    .map((e) => e.toolName);
  const settingsChanged: string[] = [];
  if (before) {
    if (before.discovery !== after.discovery) settingsChanged.push("discovery");
    if ([...before.pinnedTools].sort().join(",") !== [...after.pinnedTools].sort().join(",")) settingsChanged.push("pinnedTools");
    if (before.name !== after.name) settingsChanged.push("name");
    if ((before.description ?? null) !== (after.description ?? null)) settingsChanged.push("description");
    if ((before.icon ?? null) !== (after.icon ?? null)) settingsChanged.push("icon");
  }
  return { added, removed, rulesChanged, settingsChanged };
}

export function isEmptyDiff(diff: ToolsetDiff | null | undefined): boolean {
  return !diff || diff.added.length + diff.removed.length + diff.rulesChanged.length + diff.settingsChanged.length === 0;
}

function list(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** One line per kind of change, in plain words — the diff view and the update notice. */
export function diffLines(diff: ToolsetDiff): { kind: "added" | "removed" | "rules" | "settings"; text: string }[] {
  const out: { kind: "added" | "removed" | "rules" | "settings"; text: string }[] = [];
  if (diff.added.length) out.push({ kind: "added", text: `Added ${list(diff.added)}` });
  if (diff.removed.length) out.push({ kind: "removed", text: `Removed ${list(diff.removed)}` });
  if (diff.rulesChanged.length) out.push({ kind: "rules", text: `Changed provider rules for ${list(diff.rulesChanged)}` });
  if (diff.settingsChanged.length) out.push({ kind: "settings", text: `Changed ${list(diff.settingsChanged.map(settingLabel))}` });
  return out;
}

/** The changelog the Share dialog fills in, from the diff (editable; at most 500 characters). */
export function changelogFrom(diff: ToolsetDiff, first: boolean, toolCount: number): string {
  if (first) {
    const names = diff.added.length === toolCount && toolCount > 0 && toolCount <= 8 ? `: ${list(diff.added)}` : "";
    return `First version: ${toolCount} tool${toolCount === 1 ? "" : "s"}${names}.`;
  }
  const lines = diffLines(diff);
  const text = lines.length > 0 ? lines.map((l) => `${l.text}.`).join(" ") : "No changes to the tools or their rules.";
  return text.length <= 500 ? text : `${text.slice(0, 499)}…`;
}

/* ----------------------------------------------------- sharing state */

export function visibilityOf(set: Pick<ToolsetSummary, "visibility">): ToolsetVisibility {
  return set.visibility === "UNLISTED" || set.visibility === "PUBLIC" ? set.visibility : "PRIVATE";
}

export interface ShareStatus {
  /** "Only my team", "Anyone with the link · v2"… */
  label: string;
  tone: "neutral" | "shared" | "warning" | "danger";
  /** A sentence that needs reading: delisted, stopped, removed. */
  notice: string | null;
}

/** Where a tool set stands, in one line plus a notice when something needs the owner. */
export function shareStatus(set: ToolsetSummary): ShareStatus {
  const visibility = visibilityOf(set);
  const v = set.latestVersion ? ` · v${set.latestVersion}` : "";
  if (set.removed) {
    return {
      label: `${VISIBILITY_LABELS[visibility]}${v}`,
      tone: "danger",
      notice: "This tool set was removed by Assay for breaking the rules. Only your team's own URL still works; shared links stopped at once.",
    };
  }
  if (set.delisted) {
    return {
      label: `Taken out of the catalogue${v}`,
      tone: "warning",
      notice: `Assay took it out of the catalogue after a report.${set.sharingEndsAt ? ` People who use it keep it until ${formatDate(set.sharingEndsAt)} UTC.` : ""} Fix it and ask support to list it again.`,
    };
  }
  if (visibility === "PRIVATE" && set.sharingEndsAt) {
    return {
      label: `Only my team${v}`,
      tone: "warning",
      notice: `You stopped sharing it. Links you shared keep working until ${formatDate(set.sharingEndsAt)} UTC, then stop.`,
    };
  }
  return { label: `${VISIBILITY_LABELS[visibility]}${visibility === "PRIVATE" ? "" : v}`, tone: visibility === "PRIVATE" ? "neutral" : "shared", notice: null };
}

/** The URL to hand out once shared: pinned to the newest version, so nobody gets surprise changes. */
export function sharedLink(set: Pick<ToolsetSummary, "visibility" | "urls">): string | null {
  const visibility = visibilityOf(set);
  if (visibility === "PUBLIC") return set.urls?.publicPinned ?? set.urls?.public ?? null;
  if (visibility === "UNLISTED") return set.urls?.unlistedPinned ?? set.urls?.unlisted ?? null;
  return null;
}

/** The web page a shared tool set opens on, for "View its page". */
export function sharedPage(set: Pick<ToolsetSummary, "visibility" | "handle" | "slug" | "unlistedToken">): string | null {
  const visibility = visibilityOf(set);
  if (visibility === "PUBLIC" && set.handle) return `/toolsets/view?handle=${set.handle}&slug=${set.slug}`;
  if (visibility === "UNLISTED" && set.unlistedToken) return `/toolsets/view#token=${set.unlistedToken}`;
  return null;
}

export interface ShareDialogModel {
  /** The version Share will publish: v1 the first time. */
  nextVersion: number;
  /** A public name must be claimed first, inline. */
  needsHandle: boolean;
  /** The main button. */
  primaryLabel: string;
  /** "Stop sharing" is offered. */
  canStop: boolean;
  /** "New link" is offered (link-only, now). */
  canRotate: boolean;
  /** One line on what happens. */
  outcome: string;
  /** Nothing to do: same visibility and no change since the last version. */
  nothingToDo: boolean;
}

/**
 * The Share dialog for one choice of visibility. Sharing always publishes the
 * next version (v1 the first time); "Only my team" on a tool set that was
 * never shared saves a version too, so the team can lock to it.
 */
export function shareDialogModel(input: {
  set: Pick<ToolsetSummary, "visibility" | "latestVersion" | "removed" | "slug">;
  handle: Pick<OrgHandle, "handle"> | null;
  visibility: ToolsetVisibility;
  diff: ToolsetDiff | null;
}): ShareDialogModel {
  const { set, handle, visibility } = input;
  const current = visibilityOf(set);
  const nextVersion = (set.latestVersion ?? 0) + 1;
  const needsHandle = visibility !== "PRIVATE" && !handle?.handle;
  const shared = current !== "PRIVATE";
  const unchanged = set.latestVersion !== null && set.latestVersion !== undefined && isEmptyDiff(input.diff);
  const nothingToDo = visibility === current && unchanged;
  let primaryLabel: string;
  let outcome: string;
  if (visibility === "PRIVATE" && shared) {
    primaryLabel = `Save v${nextVersion} and stop sharing`;
    outcome = `Saves the Draft as v${nextVersion} for your team only. Links you shared keep working for 90 days, then stop.`;
  } else if (visibility === "PRIVATE") {
    primaryLabel = `Save as v${nextVersion}`;
    outcome = `Saves the Draft as v${nextVersion}. Your team can lock an agent to it with /my/${set.slug}@${nextVersion}.`;
  } else {
    primaryLabel = needsHandle ? `Claim the name and share v${nextVersion}` : `Share v${nextVersion}`;
    outcome =
      visibility === "PUBLIC"
        ? `Publishes v${nextVersion} and lists it in the catalogue. People who connect it get v${nextVersion} until they choose to update.`
        : `Publishes v${nextVersion} behind a link. Only people with the link can connect it.`;
  }
  return {
    nextVersion,
    needsHandle,
    primaryLabel,
    canStop: shared && !set.removed,
    canRotate: current === "UNLISTED" && !set.removed,
    outcome,
    nothingToDo,
  };
}

/* ---------------------------------------------------- update notices */

export interface UpdateNotice {
  toolsetId: string | null;
  handle: string | null;
  slug: string | null;
  fromVersion: number;
  toVersion: number;
  mcpUrl: string | null;
  diff: ToolsetDiff | null;
}

/** `toolset.update_available`'s payload, read defensively (it arrives from the notification feed). */
export function readUpdateNotice(payload: unknown): UpdateNotice | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const from = Number(p.fromVersion);
  const to = Number(p.toVersion);
  if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from) return null;
  const d = p.diff as Record<string, unknown> | undefined;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    toolsetId: typeof p.toolsetId === "string" ? p.toolsetId : null,
    handle: typeof p.handle === "string" ? p.handle : null,
    slug: typeof p.slug === "string" ? p.slug : null,
    fromVersion: from,
    toVersion: to,
    mcpUrl: typeof p.mcpUrl === "string" ? p.mcpUrl : null,
    diff: d ? { added: strings(d.added), removed: strings(d.removed), rulesChanged: strings(d.rulesChanged), settingsChanged: strings(d.settingsChanged) } : null,
  };
}

/** The notice's sentence: "@marketkit/crypto-research v3: Added get_usd_eur_rate." */
export function updateNoticeText(notice: UpdateNotice): string {
  const name = notice.handle && notice.slug ? `@${notice.handle}/${notice.slug}` : "A tool set you use";
  const lines = notice.diff ? diffLines(notice.diff).map((l) => `${l.text}.`) : [];
  return `${name} v${notice.toVersion} is out (you use v${notice.fromVersion}).${lines.length ? ` ${lines.join(" ")}` : ""} Your app keeps v${notice.fromVersion} until you replace its URL.`;
}

/**
 * Where the notice's action goes: the update opened in place in the app
 * (`/agents`), with the new URL in the fragment so a link-only token never
 * reaches a server log.
 */
export function updateNoticeHref(notice: UpdateNotice): string {
  if (!notice.mcpUrl) return "/agents";
  return `/agents?update=1&from=${notice.fromVersion}&to=${notice.toVersion}#url=${encodeURIComponent(notice.mcpUrl)}`;
}

/* ------------------------------------------------- rule changes in words */

/** One entry's provider rule, as both a version snapshot and a public entry can give it. */
export interface RuleView {
  providerMode: string;
  /** Providers named by an "Only these" / "All except" rule. */
  providerCount: number;
  minTier: string | null;
  onEmpty: string;
  /** Atomic units; only owners' snapshots carry it. */
  maxPrice?: { amount: string; decimals: number } | null;
  /** T3: contract majors, e.g. "^1 || ^2". */
  toolVersionRange?: string | null;
  /** T3: "Must return" fields. */
  requireOutputFields?: string[];
}

function modeText(r: RuleView): string {
  if (r.providerMode === "ONLY") return `Only these providers (${r.providerCount})`;
  if (r.providerMode === "EXCLUDE") return `All except ${r.providerCount} provider${r.providerCount === 1 ? "" : "s"}`;
  return "Any provider (Assay picks)";
}

function priceWords(p: RuleView["maxPrice"]): string {
  if (!p) return "no limit";
  const value = Number(p.amount) / 10 ** p.decimals;
  return `$${value.toFixed(4).replace(/(\.\d\d\d*?)0+$/, "$1")}`;
}

/**
 * What changed in one tool's provider rule, e.g. "Any provider (Assay picks)
 * → Only these providers (2)" or "Max price $0.01 → $0.02". Null when the
 * views carry no visible difference (the change is in a field not published).
 */
export function ruleChangeText(before: RuleView, after: RuleView): string | null {
  const parts: string[] = [];
  if (before.providerMode !== after.providerMode || before.providerCount !== after.providerCount) parts.push(`${modeText(before)} → ${modeText(after)}`);
  if (Boolean(before.minTier) !== Boolean(after.minTier)) parts.push(`Only verified providers: ${before.minTier ? "on" : "off"} → ${after.minTier ? "on" : "off"}`);
  if (before.onEmpty !== after.onEmpty) {
    const words = (o: string) => (o === "FALLBACK_BEST" ? "Let Assay pick the best one" : "Stop the call");
    parts.push(`If no provider fits: ${words(before.onEmpty)} → ${words(after.onEmpty)}`);
  }
  if (before.maxPrice !== undefined && after.maxPrice !== undefined && priceWords(before.maxPrice) !== priceWords(after.maxPrice)) {
    parts.push(`Max price ${priceWords(before.maxPrice)} → ${priceWords(after.maxPrice)}`);
  }
  const must = (r: RuleView) => (r.requireOutputFields && r.requireOutputFields.length > 0 ? [...r.requireOutputFields].sort().join(", ") : "nothing extra");
  if (must(before) !== must(after)) parts.push(`Must return: ${must(before)} → ${must(after)}`);
  const range = (r: RuleView) => (r.toolVersionRange ? rangeText(r.toolVersionRange) : "current version");
  if ((before.toolVersionRange ?? null) !== (after.toolVersionRange ?? null) && range(before) !== range(after)) {
    parts.push(`Contract version: ${range(before)} → ${range(after)}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

/** A snapshot entry as a rule view (owners see the price limit too). */
export function ruleOfSnapshot(e: Snapshot["entries"][number] & { maxPrice: { amount: string; decimals?: number } | null }): RuleView {
  return {
    providerMode: e.providerMode,
    providerCount: e.providerIds.length,
    minTier: e.minTier,
    onEmpty: e.onEmpty,
    maxPrice: e.maxPrice ? { amount: e.maxPrice.amount, decimals: e.maxPrice.decimals ?? 6 } : null,
    toolVersionRange: e.toolVersionRange ?? null,
    requireOutputFields: e.requireOutputFields ?? [],
  };
}

/** For each tool whose rule changed, the words for it, from two lists of entries keyed by tool name. */
export function ruleDetails<T extends { toolName: string }>(before: readonly T[], after: readonly T[], view: (e: T) => RuleView): (toolName: string) => string | null {
  return (toolName) => {
    const a = before.find((e) => e.toolName === toolName);
    const b = after.find((e) => e.toolName === toolName);
    return a && b ? ruleChangeText(view(a), view(b)) : null;
  };
}

/** "get_token_market" → "Token market": a readable title for a tool that has none. */
export function humanToolName(name: string): string {
  const words = name.replace(/^[a-z0-9-]+__/, "").split(/[_-]+/).filter(Boolean);
  const verbs = new Set(["get", "search", "list", "find", "fetch", "lookup", "read", "run", "call"]);
  const rest = words.length > 1 && verbs.has(words[0]!) ? words.slice(1) : words;
  const text = rest.join(" ");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : name;
}

/** Why a shared tool set needs a public name (D19), said where the name is asked for. */
export const WHY_PUBLIC_NAME =
  "Every shared tool set says who published it, on its page and in the catalogue, so people know where the tools come from. That is your public name. Choose it once; it can change until your first share.";

/**
 * The URL people will connect with once Share is pressed, shown before the
 * public name is claimed (D19). `handle` is the claimed name, or the valid
 * name being typed; `null` shows a placeholder. A link-only share's private
 * code is made when it is shared, so it shows as one unless the set already
 * has one. `null` for "Only my team".
 */
export function shareUrlPreview(input: {
  visibility: ToolsetVisibility;
  handle: string | null;
  slug: string;
  nextVersion: number;
  /** `urls.unlisted` of a set already shared by link: its code stays. */
  unlisted: string | null;
  host?: string;
}): { url: string; note: string } | null {
  const host = input.host ?? mcpHost();
  if (input.visibility === "PUBLIC") {
    return {
      url: input.handle
        ? buildMcpUrl({ kind: "shared", handle: input.handle, slug: input.slug, version: input.nextVersion }, { free: false }, host)
        : `${host}/@<your public name>/${input.slug}@${input.nextVersion}`,
      note: "Listed in the catalogue under your public name.",
    };
  }
  if (input.visibility === "UNLISTED") {
    return input.unlisted
      ? { url: `${input.unlisted}@${input.nextVersion}`, note: "Your current link, now serving the new version." }
      : {
          url: `${host}/u/<private code>@${input.nextVersion}`,
          note: "The private code is made when you share. The link does not contain your public name; the page it opens shows who published it.",
        };
  }
  return null;
}
