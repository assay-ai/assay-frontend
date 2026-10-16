import { describe, expect, it } from "vitest";

import { isFocusVisible } from "./term";

/*
  A sheet focuses its first focusable element when it opens. When that is a
  glossary term in the description, its definition opened over the sheet until
  the pointer moved (regression 2026-10-17 P3-4): the term opens on focus only
  for keyboard focus.
*/
const element = (matches: (selector: string) => boolean) => ({ matches }) as unknown as Element;

describe("isFocusVisible", () => {
  it("is true only for keyboard focus", () => {
    expect(isFocusVisible(element((s) => s === ":focus-visible"))).toBe(true);
    expect(isFocusVisible(element(() => false))).toBe(false);
  });

  it("is false where the selector is not supported, so the definition never opens by itself", () => {
    expect(
      isFocusVisible(
        element(() => {
          throw new SyntaxError("unknown pseudo-class");
        }),
      ),
    ).toBe(false);
  });
});
