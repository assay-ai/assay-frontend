import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
  No layout engine runs in tests, so this pins the classes that keep provider
  Home's header readable at 390px (V1-10): the header stacks below tablet, and
  its text column takes the full width there instead of a zero-basis `flex-1`
  that shrank it to ~60px beside the buttons.
*/
describe("provider Home header at phone width", () => {
  const source = readFileSync(join(__dirname, "page.tsx"), "utf8");
  const header = source.match(/<header className="([^"]+)" data-testid="provider-home-header">\s*<div className="([^"]+)">/);

  it("stacks below tablet and is a row only from tablet up", () => {
    expect(header).not.toBeNull();
    const classes = header![1]!.split(/\s+/);
    expect(classes).toContain("flex-col");
    expect(classes).toContain("tablet:flex-row");
    expect(classes).not.toContain("flex-wrap");
  });

  it("gives the name and status the full width on a phone", () => {
    const classes = header![2]!.split(/\s+/);
    expect(classes).toContain("w-full");
    expect(classes).not.toContain("flex-1");
    expect(classes).toContain("tablet:flex-1");
  });
});
