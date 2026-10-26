import { describe, expect, it } from "vitest";

import type { Toolset, ToolsetSummary } from "@/services/toolsets.service";

import {
  changelogFrom,
  diffLines,
  diffSnapshots,
  handleErrorView,
  handleProblem,
  normaliseHandle,
  readUpdateNotice,
  shareDialogModel,
  sharedLink,
  shareStatus,
  shareUrlPreview,
  snapshotOfDraft,
  updateNoticeHref,
  updateNoticeText,
  type Snapshot,
} from "./sharing";

const ENTRY = { toolId: "t1", toolName: "search_web", providerMode: "BEST", providerIds: [] as string[], minTier: null, maxPrice: null, minQuality: null, onEmpty: "FAIL" };

function snap(entries: Partial<typeof ENTRY>[], extra: Partial<Snapshot> = {}): Snapshot {
  return { name: "Kit", description: null, icon: null, discovery: "AUTO", pinnedTools: [], entries: entries.map((e) => ({ ...ENTRY, ...e })), ...extra };
}

function set(patch: Partial<ToolsetSummary> = {}): ToolsetSummary {
  return {
    id: "s1",
    slug: "research",
    name: "Research kit",
    description: null,
    category: null,
    tags: [],
    icon: null,
    visibility: "PRIVATE",
    discovery: "AUTO",
    searchThreshold: 25,
    pinnedTools: [],
    mcpUrl: "https://mcp.example.com/my/research",
    toolCount: 2,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    latestVersion: null,
    ...patch,
  };
}

describe("the public name, claimed inline", () => {
  it("is checked before the request, in plain words", () => {
    expect(normaliseHandle(" @Acme ")).toBe("acme");
    expect(handleProblem("")).toBe("Choose a public name first.");
    expect(handleProblem("ab")).toMatch(/3–24 lowercase letters/);
    expect(handleProblem("9lives")).toMatch(/starting with a letter/);
    expect(handleProblem("support")).toBe("@support is reserved. Try another name.");
    expect(handleProblem("brightpath")).toBeNull();
  });

  it("turns every refusal into what to do next, never a code", () => {
    const reserved = handleErrorView("TOOLSET_HANDLE_INVALID", { reason: "RESERVED" }, "assay");
    expect(reserved.text).toBe("@assay is reserved. These are free to try:");
    expect(reserved.suggestions).toEqual(["assay-hq", "assay-team", "assay-labs"]);
    expect(handleErrorView("TOOLSET_HANDLE_INVALID", { reason: "FORMAT" }, "A!").text).toMatch(/3–24 lowercase/);
    const taken = handleErrorView("TOOLSET_HANDLE_TAKEN", { suggestions: ["acme-hq", "acme-labs", "Bad Name", "acme2"] }, "acme");
    expect(taken.text).toBe("@acme is taken. These are free:");
    expect(taken.suggestions).toEqual(["acme-hq", "acme-labs", "acme2"]);
    expect(handleErrorView("TOOLSET_HANDLE_TAKEN", {}, "acme").text).toBe("@acme is taken. Try another name.");
    expect(handleErrorView("TOOLSET_HANDLE_LOCKED", undefined, "x").text).toMatch(/Ask support to rename it/);
    const notVerified = handleErrorView("TOOLSET_HANDLE_CLAIM_REFUSED", { reason: "NOT_VERIFIED" }, "acme");
    expect(notVerified.text).toMatch(/in funds once/);
    expect(notVerified.action).toEqual({ label: "Add funds", href: "/funding?action=deposit" });
    expect(notVerified.minimumDepositUsd).toBe("5");
    expect(notVerified.text).toMatch(/at least \$5/);
    // The server's funding refusal (onboarding wave 3): its own minimum, and what a set-up provider is told.
    const unfunded = handleErrorView("TOOLSET_HANDLE_CLAIM_REFUSED", { reason: "NOT_VERIFIED", fundingRequired: true, minimumDepositUsd: 7, providerSetUp: false }, "acme");
    expect(unfunded.text).toBe("Add at least $7 in funds once, or finish provider setup, before you choose a public name. It keeps names from being grabbed in bulk.");
    expect(unfunded.minimumDepositUsd).toBe("7");
    expect(unfunded.action).toEqual({ label: "Add funds", href: "/funding?action=deposit" });
    const used = handleErrorView("TOOLSET_HANDLE_CLAIM_REFUSED", { reason: "NOT_VERIFIED", fundingRequired: true, minimumDepositUsd: 5, providerSetUp: true }, "acme");
    expect(used.text).toBe("Your free public name is already used. Add at least $5 in funds once to choose another.");
    // A minimum that is not a plain amount is never echoed.
    expect(handleErrorView("TOOLSET_HANDLE_CLAIM_REFUSED", { reason: "NOT_VERIFIED", minimumDepositUsd: "<b>" }, "acme").minimumDepositUsd).toBe("5");
    expect(handleErrorView("TOOLSET_HANDLE_CLAIM_REFUSED", { reason: "CLAIM_LIMIT" }, "acme").text).toMatch(/3 teams in the last 30 days/);
    for (const code of ["TOOLSET_HANDLE_INVALID", "TOOLSET_HANDLE_TAKEN", "TOOLSET_HANDLE_LOCKED", "TOOLSET_HANDLE_CLAIM_REFUSED", null]) {
      expect(handleErrorView(code, {}, "acme").text).not.toMatch(/TOOLSET|HANDLE|handle/);
    }
  });
});

describe("the version diff", () => {
  it("names added, removed and changed tools, and settings in plain words", () => {
    const before = snap([{ toolId: "t1" }, { toolId: "t2", toolName: "scrape_url" }]);
    const after = snap([{ toolId: "t1", providerMode: "ONLY", providerIds: ["p1"] }, { toolId: "t3", toolName: "get_weather" }], { discovery: "SEARCH", pinnedTools: ["get_weather"] });
    const diff = diffSnapshots(before, after);
    expect(diff).toEqual({ added: ["get_weather"], removed: ["scrape_url"], rulesChanged: ["search_web"], settingsChanged: ["discovery", "pinnedTools"] });
    expect(diffLines(diff).map((l) => l.text)).toEqual([
      "Added get_weather",
      "Removed scrape_url",
      "Changed provider rules for search_web",
      "Changed how the agent sees tools and always-loaded tools",
    ]);
    expect(diffLines(diff).map((l) => l.text).join(" ")).not.toMatch(/discovery|pinned/i);
  });

  it("is empty when only the order of provider ids changed", () => {
    const a = snap([{ providerMode: "ONLY", providerIds: ["p1", "p2"] }]);
    const b = snap([{ providerMode: "ONLY", providerIds: ["p2", "p1"] }]);
    expect(diffLines(diffSnapshots(a, b))).toEqual([]);
  });

  it("fills in the changelog: v1 counts the tools, later versions list the changes", () => {
    const first = diffSnapshots(null, snap([{}, { toolId: "t2", toolName: "scrape_url" }]));
    expect(changelogFrom(first, true, 2)).toBe("First version: 2 tools: search_web and scrape_url.");
    const next = diffSnapshots(snap([{}]), snap([{}, { toolId: "t2", toolName: "scrape_url" }]));
    expect(changelogFrom(next, false, 2)).toBe("Added scrape_url.");
    expect(changelogFrom(diffSnapshots(snap([{}]), snap([{}])), false, 1)).toBe("No changes to the tools or their rules.");
  });

  it("reads the Draft of a tool set as a snapshot", () => {
    const draft = snapshotOfDraft({ ...set(), entries: [] } as Toolset);
    expect(draft).toMatchObject({ name: "Research kit", discovery: "AUTO", entries: [] });
  });
});

describe("the Share dialog, state by state", () => {
  const diff = { added: ["a"], removed: [], rulesChanged: [], settingsChanged: [] };

  it("first share, no public name yet: claim it inline and publish v1", () => {
    const m = shareDialogModel({ set: set(), handle: { handle: null }, visibility: "UNLISTED", diff });
    expect(m).toMatchObject({ nextVersion: 1, needsHandle: true, primaryLabel: "Claim the name and share v1", canStop: false, canRotate: false });
    expect(m.outcome).toMatch(/Only people with the link/);
  });

  it("listed in the catalogue with a name: share the next version", () => {
    const m = shareDialogModel({ set: set({ visibility: "PUBLIC", latestVersion: 3 }), handle: { handle: "acme" }, visibility: "PUBLIC", diff });
    expect(m).toMatchObject({ nextVersion: 4, needsHandle: false, primaryLabel: "Share v4", canStop: true, canRotate: false, nothingToDo: false });
  });

  it("link-only can get a new link; nothing changed means nothing to publish", () => {
    const empty = { added: [], removed: [], rulesChanged: [], settingsChanged: [] };
    const m = shareDialogModel({ set: set({ visibility: "UNLISTED", latestVersion: 2 }), handle: { handle: "acme" }, visibility: "UNLISTED", diff: empty });
    expect(m).toMatchObject({ canRotate: true, nothingToDo: true });
  });

  it("only my team: saves a version to lock to; on a shared one it also stops sharing", () => {
    expect(shareDialogModel({ set: set({ latestVersion: 1 }), handle: null, visibility: "PRIVATE", diff }).primaryLabel).toBe("Save as v2");
    const stop = shareDialogModel({ set: set({ visibility: "PUBLIC", latestVersion: 3 }), handle: { handle: "acme" }, visibility: "PRIVATE", diff });
    expect(stop.primaryLabel).toBe("Save v4 and stop sharing");
    expect(stop.needsHandle).toBe(false);
  });

  it("a removed tool set can't be stopped or rotated", () => {
    const m = shareDialogModel({ set: set({ visibility: "UNLISTED", latestVersion: 1, removed: true }), handle: { handle: "acme" }, visibility: "UNLISTED", diff });
    expect(m).toMatchObject({ canStop: false, canRotate: false });
  });
});

describe("a tool set's sharing status", () => {
  it("is one plain line, with a notice when the owner must know", () => {
    expect(shareStatus(set())).toMatchObject({ label: "Only my team", notice: null });
    expect(shareStatus(set({ visibility: "UNLISTED", latestVersion: 2 })).label).toBe("Anyone with the link · v2");
    expect(shareStatus(set({ visibility: "PUBLIC", latestVersion: 3 })).label).toBe("Listed in the catalogue · v3");
    const delisted = shareStatus(set({ visibility: "PUBLIC", latestVersion: 3, delisted: true, sharingEndsAt: "2027-01-15T00:00:00.000Z" }));
    expect(delisted.notice).toMatch(/took it out of the catalogue/);
    expect(delisted.notice).toMatch(/UTC/);
    expect(shareStatus(set({ latestVersion: 3, sharingEndsAt: "2027-01-15T00:00:00.000Z" })).notice).toMatch(/You stopped sharing it/);
    expect(shareStatus(set({ visibility: "PUBLIC", removed: true })).tone).toBe("danger");
  });

  it("hands out the pinned link once shared", () => {
    const urls = { draft: "d", myPinned: "d@3", public: "p", publicPinned: "p@3", unlisted: "u", unlistedPinned: "u@3" };
    expect(sharedLink(set({ visibility: "PUBLIC", urls }))).toBe("p@3");
    expect(sharedLink(set({ visibility: "UNLISTED", urls }))).toBe("u@3");
    expect(sharedLink(set({ urls }))).toBeNull();
  });
});

describe("the update notice (toolset.update_available)", () => {
  const payload = {
    toolsetId: "ts1",
    handle: "marketkit",
    slug: "crypto-research",
    fromVersion: 2,
    toVersion: 3,
    mcpUrl: "https://mcp.example.com/@marketkit/crypto-research@3",
    diff: { added: ["get_usd_eur_rate"], removed: [], rulesChanged: ["get_token_market"], settingsChanged: ["discovery"] },
  };

  it("reads the payload defensively", () => {
    expect(readUpdateNotice(payload)).toMatchObject({ fromVersion: 2, toVersion: 3, handle: "marketkit" });
    expect(readUpdateNotice({ fromVersion: 3, toVersion: 2 })).toBeNull();
    expect(readUpdateNotice(null)).toBeNull();
  });

  it("says what changed and that the app keeps the old version", () => {
    const text = updateNoticeText(readUpdateNotice(payload)!);
    expect(text).toBe(
      "@marketkit/crypto-research v3 is out (you use v2). Added get_usd_eur_rate. Changed provider rules for get_token_market. Changed how the agent sees tools. Your app keeps v2 until you replace its URL.",
    );
  });

  it("opens the update in the app; the new URL (and any link token) stays in the fragment", () => {
    expect(updateNoticeHref(readUpdateNotice(payload)!)).toBe(
      `/agents?update=1&from=2&to=3#url=${encodeURIComponent("https://mcp.example.com/@marketkit/crypto-research@3")}`,
    );
    expect(updateNoticeHref({ ...readUpdateNotice(payload)!, mcpUrl: null })).toBe("/agents");
  });
});

import { humanToolName, ruleChangeText, ruleDetails } from "./sharing";

describe("what changed in a tool's provider rule, in words", () => {
  const any = { providerMode: "BEST", providerCount: 0, minTier: null, onEmpty: "FAIL" };
  it("names the before and the after", () => {
    expect(ruleChangeText(any, { ...any, providerMode: "ONLY", providerCount: 2 })).toBe("Any provider (Assay picks) → Only these providers (2)");
    expect(ruleChangeText({ ...any, maxPrice: { amount: "10000", decimals: 6 } }, { ...any, maxPrice: { amount: "20000", decimals: 6 } })).toBe("Max price $0.01 → $0.02");
    expect(ruleChangeText(any, { ...any, minTier: "ESTABLISHED", onEmpty: "FALLBACK_BEST" })).toBe(
      "Only verified providers: off → on; If no provider fits: Stop the call → Let Assay pick the best one",
    );
    expect(ruleChangeText(any, any)).toBeNull();
    const of = ruleDetails([{ toolName: "a", ...any }], [{ toolName: "a", ...any, providerMode: "EXCLUDE", providerCount: 1 }], (e) => e);
    expect(of("a")).toBe("Any provider (Assay picks) → All except 1 provider");
    expect(of("missing")).toBeNull();
  });

  it("gives a tool with no title a readable one", () => {
    expect(humanToolName("get_token_market")).toBe("Token market");
    expect(humanToolName("cobalt__news_search")).toBe("News search");
    expect(humanToolName("summarize_document")).toBe("Summarize document");
  });
});

describe("shareUrlPreview (D19: the final URL before the name is claimed)", () => {
  const base = { slug: "tools-i-use", nextVersion: 1, unlisted: null, host: "https://mcp.example.com" };
  it("a catalogue share shows @name/slug@version, with a placeholder until a name is typed", () => {
    expect(shareUrlPreview({ ...base, visibility: "PUBLIC", handle: "acme" })?.url).toBe("https://mcp.example.com/@acme/tools-i-use@1");
    expect(shareUrlPreview({ ...base, visibility: "PUBLIC", handle: null })?.url).toBe("https://mcp.example.com/@<your public name>/tools-i-use@1");
  });
  it("a link share has no name in it; its code is made on share, or kept when it exists", () => {
    const fresh = shareUrlPreview({ ...base, visibility: "UNLISTED", handle: "acme" });
    expect(fresh?.url).toBe("https://mcp.example.com/u/<private code>@1");
    expect(fresh?.note).toContain("does not contain your public name");
    expect(shareUrlPreview({ ...base, visibility: "UNLISTED", handle: "acme", nextVersion: 3, unlisted: "https://mcp.example.com/u/tok123" })?.url).toBe(
      "https://mcp.example.com/u/tok123@3",
    );
  });
  it("nothing for Only my team", () => {
    expect(shareUrlPreview({ ...base, visibility: "PRIVATE", handle: "acme" })).toBeNull();
  });
});
