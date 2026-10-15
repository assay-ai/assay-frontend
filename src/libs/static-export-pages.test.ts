import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "src/app");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return pages(path);
    return entry === "page.tsx" || entry === "page.ts" ? [path] : [];
  });
}

// BUG-R16-V2-01: publish and backtest still read a `bindingId` route param after
// the static-export move to `?binding=`, so they sent `undefined` to the API.
describe("record pages in the static export", () => {
  it("read record ids from the query string, not from route params", () => {
    const offenders = pages(APP)
      .filter((file) => {
        const rel = relative(APP, file);
        // A real `[segment]` with generateStaticParams is the one place params exist.
        if (/\[[^\]]+\]/.test(rel)) return false;
        const source = readFileSync(file, "utf8");
        return /\bparams\s*:\s*Promise</.test(source) || /\buseParams\s*\(/.test(source);
      })
      .map((file) => relative(APP, file));
    expect(offenders).toEqual([]);
  });
});
