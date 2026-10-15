import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_PUBLIC_NAV_ITEMS, flattenPublicNav, publicNavItems } from "./public-top-bar";

const APP_DIR = join(__dirname, "../../app");

/** Every `page.tsx` under src/app as a URL pattern (route groups stripped). */
function collectRoutes(dir: string, segments: string[] = [], out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      const isGroup = name.startsWith("(") && name.endsWith(")");
      collectRoutes(full, isGroup ? segments : [...segments, name], out);
    } else if (name === "page.tsx") {
      out.push("/" + segments.join("/"));
    }
  }
  return out;
}

function matches(route: string, href: string): boolean {
  const r = route.split("/").filter(Boolean);
  const h = href.split("/").filter(Boolean);
  return r.length === h.length && r.every((seg, i) => /^\[.+\]$/.test(seg) || seg === h[i]);
}

describe("public top bar links", () => {
  const routes = collectRoutes(APP_DIR);

  it("finds the app routes", () => {
    expect(existsSync(APP_DIR)).toBe(true);
    expect(routes).toContain("/login");
  });

  it.each([
    ...flattenPublicNav(DEFAULT_PUBLIC_NAV_ITEMS)
      .filter((i) => !i.external)
      .map((i) => i.href),
    "/login",
    "/provider/setup",
  ])("%s resolves to an existing app route", (href) => {
    expect(routes.some((route) => matches(route, href))).toBe(true);
  });

  it("has the agreed items, providers' pages grouped", () => {
    expect(DEFAULT_PUBLIC_NAV_ITEMS.map((i) => i.label).slice(0, 4)).toEqual([
      "How it works",
      "Explore",
      "Demo",
      "For providers",
    ]);
    expect(flattenPublicNav(DEFAULT_PUBLIC_NAV_ITEMS).map((i) => i.href)).toEqual(
      expect.arrayContaining(["/why-list-here", "/catalogue", "/demo", "/how-it-works"]),
    );
  });

  it("hides Demo while the demo is not configured", () => {
    expect(publicNavItems({ demo: false }).map((i) => i.id)).not.toContain("demo");
    expect(publicNavItems({ demo: true }).map((i) => i.id)).toContain("demo");
  });
});
