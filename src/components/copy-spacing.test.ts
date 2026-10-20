import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/*
  Next's SWC drops the space after `{expr}` in a multi-line JSX text run that
  holds an entity (see BUG-M1-02 in connect-copy-spacing.dom.test.tsx). These
  are the other runs it hit; each keeps its space as `{" "}`.
*/
const CASES = [
  ["src/app/(console)/provider/money/page.tsx", "from the buyer's escrow"],
  ["src/app/(operator)/operator/cases/view/_components/more-actions.tsx", "from the treasury"],
  ["src/app/(public)/catalogue/view/page.tsx", "only: it is one maker"],
  ["src/components/buyer-money/funding-view.tsx", "a call, for all your agents"],
  ["src/features/provider-binding/mapping-editor.tsx", "may be missing, give a"],
] as const;

describe("Next's compiler keeps the space after an expression", () => {
  it.each(CASES)("%s: ' %s'", async (file, text) => {
    const swc = await import("next/dist/build/swc/index.js");
    await swc.loadBindings();
    const source = readFileSync(path.resolve(file), "utf8");
    const { code } = await swc.transform(source, {
      filename: file,
      jsc: { parser: { syntax: "typescript", tsx: true }, transform: { react: { runtime: "automatic", development: true } } },
    });
    const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Either a `" "` child right before the text, or the text's own string starts with a space.
    expect(code).toMatch(new RegExp(`(" ",\\s*"|" )${escaped}`));
  });
});
