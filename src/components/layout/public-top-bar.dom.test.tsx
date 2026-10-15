import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./theme-toggle", () => ({ ThemeToggle: () => null }));

import { PublicTopBar } from "./public-top-bar";

/*
  No layout engine runs here, so this pins the classes that keep the bar
  inside a 360-390px phone: at 390px the chip, "Sign in", "Start free" and the
  menu button measured 406px and pushed the menu button off the screen. Below
  420px "Sign in" leaves the bar (it is in the menu, and "Start free" opens the
  same sign-in page), and every control is at least 40px tall.
*/
function render(props: React.ComponentProps<typeof PublicTopBar> = {}) {
  return renderToStaticMarkup(<PublicTopBar {...props} />);
}

function tagWith(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf("<", at);
  return html.slice(start, html.indexOf(">", at) + 1);
}

describe("public top bar at phone width", () => {
  it("hides the bar's Sign in below 420px and shows it from there up", () => {
    const tag = tagWith(render(), 'data-testid="public-bar-sign-in"');
    expect(tag).toMatch(/class="hidden /);
    expect(tag).toContain("min-[420px]:inline-flex");
    expect(tag).toContain("min-h-10");
  });

  it("uses the tighter gap below 420px", () => {
    const html = render();
    expect(html).toContain("gap-x-3 px-4 min-[420px]:gap-x-[18px]");
  });

  it("keeps Start free and the menu button at least 40px and unshrinkable", () => {
    const html = render();
    expect(html).toMatch(/class="flex min-h-10 shrink-0 [^"]*bg-primary-400[^"]*">Start free</);
    const menu = tagWith(html, 'aria-label="Open menu"');
    expect(menu).toContain("size-10");
    expect(menu).toContain("shrink-0");
  });

  it("offers no Sign in at all once signed in", () => {
    const html = render({ signedIn: true });
    expect(html).not.toContain("public-bar-sign-in");
    expect(html).toContain("Open app");
  });
});
