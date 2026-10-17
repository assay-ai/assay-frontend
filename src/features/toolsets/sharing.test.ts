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
    expect(handleErrorView("TOOLSET_HANDLE_INVALID", { reason: "RESERVED" }, "assay").text).toBe("@assay is reserved. Try another name.");
    expect(handleErrorView("TOOLSET_HANDLE_INVALID", { reason: "FORMAT" }, "A!").text).toMatch(/3–24 lowercase/);
    const taken = handleErrorView("TOOLSET_HANDLE_TAKEN", { suggestions: ["acme-hq", "acme-labs", "Bad Name", "acme2"] }, "acme");
    expect(taken.text).toBe("@acme is taken. These are free:");
    expect(taken.suggestions).toEqual(["acme-hq", "acme-labs", "acme2"]);
    expect(handleErrorView("TOOLSET_HANDLE_TAKEN", {}, "acme").text).toBe("@acme is taken. Try another name.");
    expect(handleErrorView("TOOLSET_HANDLE_LOCKED", undefined, "x").text).toMatch(/Ask support to rename it/);
    const notVerified = handleErrorView("TOOLSET_HANDLE_CLAIM_REFUSED", { reason: "NOT_VERIFIED" }, "acme");
    expect(notVerified.text).toMatch(/Add funds once/);
    expect(notVerified.action).toEqual({ label: "Add funds", href: "/funding?action=deposit" });
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
    expect(changelogFrom(first, true, 2)).toBe("First version: 2 tools.");
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

  it("links to the tool set's page opened on the update; a link-only one keeps its token in the fragment", () => {
    expect(updateNoticeHref(readUpdateNotice(payload)!)).toBe("/toolsets/view?handle=marketkit&slug=crypto-research&v=3&from=2");
    const link = readUpdateNotice({ ...payload, mcpUrl: "https://mcp.example.com/u/h3j8d2k9s6a1f4g7l0q5wz@3" })!;
    expect(updateNoticeHref(link)).toBe("/toolsets/view?from=2#token=h3j8d2k9s6a1f4g7l0q5wz&v=3");
  });
});
