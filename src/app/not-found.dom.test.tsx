import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: false }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/no-such-page" }));
vi.mock("@/features/explorer/use-public-explorer", () => ({
  usePublicFeatures: () => ({ demo: false, reserves: false, isPending: false }),
}));
vi.mock("@/components/layout/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/patterns/testnet-chip", () => ({ TestnetChip: () => null }));

import NotFound from "./not-found";

/* A (2026-10-18): the 404 had no header or footer, Title Case, and one "Return to Home" button. */
describe("404 page", () => {
  const html = renderToStaticMarkup(<NotFound />);

  it("sits in the public shell: the public top bar and footer", () => {
    expect(html).toContain('aria-label="Footer"');
    expect(html).toContain("How it works");
    expect(html).toContain("Start free");
  });

  it("speaks in sentence case", () => {
    expect(html).toContain("Page not found");
    expect(html).not.toContain("Page Not Found");
    expect(html).not.toContain("Return to Home");
  });

  it("links Tools, How it works and For providers", () => {
    const nav = html.slice(html.indexOf('aria-label="Where to go instead"'));
    expect(nav).toContain('href="/catalogue"');
    expect(nav).toContain('href="/how-it-works"');
    expect(nav).toContain('href="/why-list-here"');
  });

  it("does not link Proof of reserves where none are published", () => {
    expect(html).not.toContain('href="/reserves"');
  });
});
