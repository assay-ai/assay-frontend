import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
  The app-wide touch rule (T1 review; every width since the T2 retest):
  every control is at least 40px. Layout cannot be measured
  without a browser, so this pins the rule itself: its media query, the
  elements it covers and the size. (A Chrome check at phone width measured
  every visible control on /agents, /connect and the tool set editor.)
*/
const css = readFileSync(join(process.cwd(), "src/styles/globals.scss"), "utf8");

function phoneBlock(): string {
  const start = css.indexOf("The app-wide rule (T1 review, extended to every width");
  expect(start).toBeGreaterThan(-1);
  // Not inside a media query any more: desktop gets it too.
  expect(css.slice(Math.max(0, start - 200), start)).not.toContain("@media (max-width: 833.98px)");
  return css.slice(start, css.indexOf(".touch-target {", start) + 200);
}

describe("touch targets at every width", () => {
  it("covers every kind of control", () => {
    const block = phoneBlock();
    for (const selector of ["button", "a[href]", "select", "summary", '[role="tab"]', '[role="button"]', '[role="radio"]', '[role="switch"]']) {
      expect(block).toContain(selector);
    }
    expect(block).toContain('label:has(> input[type="checkbox"])');
    expect(block).toContain('label:has(> input[type="radio"])');
  });

  it("makes each at least 40px tall and wide, without beating a component's own sizing (zero specificity)", () => {
    const block = phoneBlock();
    expect(block).toMatch(/:where\(button, a\[href\][^{]*\{\s*min-height: 40px;\s*min-width: 40px;/);
  });
});
