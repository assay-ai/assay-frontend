import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  allProviderNavHrefs,
  PROVIDER_EXPLAINER,
  PROVIDER_NAV_ITEMS,
  PROVIDER_TOOLS_TABS,
  providerSectionFor,
  providerTitleFor,
} from "./provider-nav-config";

const APP_DIR = join(__dirname, "../../app");

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

describe("provider navigation", () => {
  const appRoutes = routesUnder(APP_DIR);

  it("has the seven sections in order", () => {
    expect(PROVIDER_NAV_ITEMS.map((item) => item.label)).toEqual([
      "Home",
      "Inbox",
      "Listings",
      "Penalties",
      "Money",
      "Stake",
      "Account",
    ]);
  });

  it.each(allProviderNavHrefs())("%s is an existing route", (href) => {
    expect(appRoutes).toContain(href);
  });

  it("puts at most five sections in the phone tab bar", () => {
    expect(PROVIDER_NAV_ITEMS.filter((item) => item.phoneTab).length).toBeLessThanOrEqual(5);
  });

  it("maps every console route to a section", () => {
    const consoleRoutes = appRoutes.filter((route) => route === "/provider" || route.startsWith("/provider/"));
    const outside = consoleRoutes.filter(
      (route) => providerSectionFor(route) === null && !route.startsWith("/provider/setup"),
    );
    // Retired URLs that only redirect elsewhere have no section; everything else does.
    const redirectsOnly = ["/provider/view", "/provider/traffic", "/provider/flags", "/provider/listing-path"];
    expect(outside.filter((route) => !redirectsOnly.includes(route))).toEqual([]);
  });

  it("picks the longest prefix", () => {
    expect(providerSectionFor("/provider")).toBe("home");
    expect(providerSectionFor("/provider/capital")).toBe("stake");
    expect(providerSectionFor("/provider/capital/penalties")).toBe("penalties");
    expect(providerSectionFor("/provider/bindings/view/settings")).toBe("tools");
    expect(providerSectionFor("/provider/policy-changes")).toBe("account");
    expect(providerSectionFor("/providers")).toBeNull();
  });

  it("titles pages for the phone bar", () => {
    expect(providerTitleFor("/provider")).toBe("Home");
    expect(providerTitleFor("/provider/bindings/new")).toBe("List a tool");
    expect(providerTitleFor("/provider/bindings/view/quality")).toBe("Listing");
    expect(providerTitleFor("/provider/apis")).toBe("Your APIs");
    expect(providerTitleFor("/provider/cases/view")).toBe("Penalties");
  });

  it("uses one word per thing: Listings for bindings, Your APIs for provider tools, never Tools or binding", () => {
    const labels = [
      ...PROVIDER_NAV_ITEMS.map((item) => item.label),
      ...PROVIDER_TOOLS_TABS.map((tab) => tab.label),
      ...["/provider/bindings", "/provider/bindings/view", "/provider/apis", "/provider/apis/new"].map(providerTitleFor),
    ];
    expect(labels).toContain("Listings");
    expect(labels).toContain("Your APIs");
    expect(labels.filter((label) => /^Tools$|binding|own API/i.test(label))).toEqual([]);
  });

  it("links the business explainer to an existing route", () => {
    expect(routesUnder(APP_DIR)).toContain(PROVIDER_EXPLAINER.href);
  });
});
