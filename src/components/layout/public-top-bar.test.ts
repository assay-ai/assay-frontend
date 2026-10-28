import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { publicFooterLinks } from "./public-footer";
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
      "Tools",
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

  it("links Analytics even when Demo is not configured", () => {
    for (const demo of [false, true]) {
      expect(flattenPublicNav(publicNavItems({ demo }))).toContainEqual(
        expect.objectContaining({ id: "analytics", label: "Analytics", href: "/analytics" }),
      );
    }
  });
});

describe("public footer links", () => {
  const routes = collectRoutes(APP_DIR);

  it.each(publicFooterLinks({ signedIn: false, reserves: true }).filter((l) => !l.external).map((l) => l.href))(
    "%s resolves to an existing app route",
    (href) => {
      expect(routes.some((route) => matches(route, href))).toBe(true);
    },
  );

  it("names /catalogue Tools, and links Sign in only when signed out", () => {
    expect(publicFooterLinks({ signedIn: false, reserves: true }).map((l) => l.label)).toEqual(
      expect.arrayContaining(["How it works", "Tools", "Why list here", "Proof of reserves", "Sign in"]),
    );
    expect(publicFooterLinks({ signedIn: false, reserves: true }).find((l) => l.href === "/catalogue")?.label).toBe("Tools");
    expect(publicFooterLinks({ signedIn: true, reserves: false }).map((l) => l.label)).not.toContain("Sign in");
  });

  // A (2026-10-18): a trust link that opens "Reserve figures are not published" hurts more than no link.
  it("links Proof of reserves only where reserves are published", () => {
    expect(publicFooterLinks({ signedIn: false, reserves: false }).map((l) => l.href)).not.toContain("/reserves");
    expect(publicFooterLinks({ signedIn: false, reserves: true }).map((l) => l.href)).toContain("/reserves");
  });
});
