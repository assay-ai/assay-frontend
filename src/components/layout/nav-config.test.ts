import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_MENU_LINKS,
  activeTabFor,
  allBuyerNavHrefs,
  BUYER_NAV_ITEMS,
  BUYER_SECTION_TABS,
  documentTitleFor,
  mobileTitleFor,
  pageTitleFor,
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
  "/calls": "redirects to /spend/calls",
  "/explore/providers": "inside Explore",
  "/explore/providers/view": "a record page, opened from a row",
  "/explore/tools": "inside Explore",
  "/explore/toolsets": "inside Explore",
  "/receipts/view": "a record page, opened from a call",
  "/spend/disputes/view": "a record page, opened from a report or a receipt",
  "/payments/view": "a record page, opened from a notification",
  "/team": "says an account is one person for now; not a menu entry",
  "/settings/close": "linked from Settings",
  "/funding/deposit": "opened from Funding",
  "/funding/withdraw": "opened from Funding",
  "/funding/escrow": "opened from Funding",
  "/funding/escrow/limits": "opened from Funding",
  "/funding/auto-top-up": "says there is no auto top-up and points at the alerts",
  "/connect/preview": "where the MCP host sends a browser that opens a filtered MCP URL",
  "/connect/authorize": "the OAuth consent page; the MCP host sends a browser there for one sign-in",
  "/connect/authorize-error": "where the MCP host sends a browser when an app's sign-in cannot start",
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

  it("reaches Get started, Connect, Statements, Account history and Settings", () => {
    const linked = allBuyerNavHrefs();
    for (const href of ["/onboarding", "/connect", "/statements", "/audit-log", "/settings", "/alerts"]) {
      expect(linked).toContain(href);
    }
  });

  it("does not link pages that cannot act yet", () => {
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
    expect(activeTabFor(tabs, "/spend/disputes/view")).toBe("reports");
    expect(activeTabFor(BUYER_SECTION_TABS.money!, "/funding/withdraw")).toBe("funding");
  });

  it("does not treat a shared prefix as a match", () => {
    expect(sectionFor("/spending")).toBeNull();
  });
});

/** A page that only sends the browser on (`ClientRedirect` or `redirect()`), so it never shows a title. */
function isRedirectPage(route: string): boolean {
  const file = join(MAIN_DIR, route === "/" ? "" : route, "page.tsx");
  return /ClientRedirect|redirect\(/.test(readFileSync(file, "utf8"));
}

describe("page titles", () => {
  const buyerRoutes = routesUnder(MAIN_DIR);

  it("gives every buyer page that renders its own title", () => {
    const untitled = buyerRoutes.filter((route) => !isRedirectPage(route) && pageTitleFor(route) === null);
    expect(untitled).toEqual([]);
  });

  it("names the page in the browser tab, the record kind on a record page", () => {
    expect(documentTitleFor("/spend/calls")).toBe("Calls — Assay");
    expect(documentTitleFor("/spend/disputes")).toBe("Reports — Assay");
    expect(documentTitleFor("/spend/disputes/view")).toBe("Report — Assay");
    expect(documentTitleFor("/receipts/view")).toBe("Receipt — Assay");
    expect(documentTitleFor("/payments/view")).toBe("Payment — Assay");
    expect(documentTitleFor("/audit-log")).toBe("Account history — Assay");
    expect(documentTitleFor("/nowhere")).toBe("Assay");
  });

  it("gives the tabs of one section different titles", () => {
    for (const tabs of Object.values(BUYER_SECTION_TABS)) {
      const titles = (tabs ?? []).map((tab) => documentTitleFor(tab.href));
      expect(new Set(titles).size).toBe(titles.length);
    }
  });

  it("shows the section in the mobile header, and the page outside the five", () => {
    expect(mobileTitleFor("/connect")).toBe("Controls");
    expect(mobileTitleFor("/toolsets/mine")).toBe("Controls");
    expect(mobileTitleFor("/spend/disputes/view")).toBe("Activity");
    expect(mobileTitleFor("/payments/view")).toBe("Activity");
    expect(mobileTitleFor("/")).toBe("Overview");
    expect(mobileTitleFor("/settings")).toBe("Settings");
    expect(mobileTitleFor("/audit-log")).toBe("Account history");
  });
});

describe("labels", () => {
  it("keeps the Controls tabs short enough for a phone", () => {
    expect(BUYER_SECTION_TABS.controls!.map((tab) => tab.label)).toEqual(["Agents", "Connect", "Limits", "Tool sets"]);
  });

  it("calls the audit log Account history, never Activity", () => {
    expect(ACCOUNT_MENU_LINKS.find((link) => link.href === "/audit-log")?.label).toBe("Account history");
  });
});
