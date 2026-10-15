import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_MENU_LINKS,
  activeTabFor,
  allBuyerNavHrefs,
  BUYER_NAV_ITEMS,
  BUYER_SECTION_TABS,
  sectionFor,
} from "./nav-config";

const MAIN_DIR = join(__dirname, "../../app/(main)");
const APP_DIR = join(__dirname, "../../app");

/** Every `page.tsx` under a directory as a URL path (route groups stripped). */
function routesUnder(dir: string, segments: string[] = [], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const isGroup = name.startsWith("(") && name.endsWith(")");
      routesUnder(full, isGroup ? segments : [...segments, name], out);
    } else if (name === "page.tsx") {
      out.push("/" + segments.join("/"));
    }
  }
  return out;
}

/** Buyer pages that are deliberately not linked from the chrome, with the reason. */
const UNLINKED: Record<string, string> = {
  "/overview": "redirects to /",
  "/explore/providers": "inside Explore",
  "/explore/providers/view": "a record page, opened from a row",
  "/explore/tools": "inside Explore",
  "/receipts/view": "a record page, opened from a call",
  "/approvals": "redirects to /limits",
  "/approvals/view": "a record page, opened from a link",
  "/team": "redirects to /limits",
  "/settings/close": "linked from Settings",
  "/funding/deposit": "opened from Funding",
  "/funding/withdraw": "opened from Funding",
  "/funding/escrow": "opened from Funding",
  "/funding/escrow/limits": "opened from Funding",
  "/funding/auto-top-up": "opened from Funding",
};

describe("buyer navigation", () => {
  const appRoutes = routesUnder(APP_DIR);
  const buyerRoutes = routesUnder(MAIN_DIR);

  it("has exactly five sections", () => {
    expect(BUYER_NAV_ITEMS.map((item) => item.label)).toEqual(["Overview", "Activity", "Money", "Controls", "Explore"]);
  });

  it.each(allBuyerNavHrefs())("%s is an existing route", (href) => {
    expect(appRoutes).toContain(href.split("?")[0]);
  });

  it("links every buyer page, or says why not", () => {
    const linked = new Set(allBuyerNavHrefs());
    const missing = buyerRoutes.filter((route) => route !== "/" && !linked.has(route) && !UNLINKED[route]);
    expect(missing).toEqual([]);
  });

  it("reaches Get started, Connect, Statements, Activity log and Settings", () => {
    const linked = allBuyerNavHrefs();
    for (const href of ["/onboarding", "/connect", "/statements", "/audit-log", "/settings", "/alerts"]) {
      expect(linked).toContain(href);
    }
  });

  it("does not link pages that cannot act yet", () => {
    expect(allBuyerNavHrefs()).not.toContain("/approvals");
    expect(allBuyerNavHrefs()).not.toContain("/team");
  });

  it("has a Help link either way", () => {
    expect(ACCOUNT_MENU_LINKS.some((link) => link.id === "help")).toBe(true);
  });
});

describe("active section and tab", () => {
  it.each([
    ["/", "overview"],
    ["/onboarding", "overview"],
    ["/spend", "activity"],
    ["/spend/calls", "activity"],
    ["/guarantee", "activity"],
    ["/receipts/view", "activity"],
    ["/funding/deposit", "money"],
    ["/statements", "money"],
    ["/limits", "controls"],
    ["/connect", "controls"],
    ["/explore/providers", "explore"],
    ["/settings", null],
    ["/alerts", null],
  ])("%s belongs to %s", (path, section) => {
    expect(sectionFor(path)).toBe(section);
  });

  it("picks the most specific tab", () => {
    const tabs = BUYER_SECTION_TABS.activity!;
    expect(activeTabFor(tabs, "/spend")).toBe("spend");
    expect(activeTabFor(tabs, "/spend/calls")).toBe("calls");
    expect(activeTabFor(tabs, "/receipts/view")).toBe("calls");
    expect(activeTabFor(tabs, "/guarantee")).toBe("not-charged");
    expect(activeTabFor(BUYER_SECTION_TABS.money!, "/funding/withdraw")).toBe("funding");
  });

  it("does not treat a shared prefix as a match", () => {
    expect(sectionFor("/spending")).toBeNull();
  });
});
