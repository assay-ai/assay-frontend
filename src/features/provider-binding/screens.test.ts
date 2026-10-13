import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { bindingScreens } from "./screens";

// UX note R3-journey 13: the free-tier screen was reachable only by typing its URL.
describe("bindingScreens", () => {
  const screens = bindingScreens("b1");

  it("links every screen of a binding, the free tier included", () => {
    expect(screens.map((s) => s.href)).toEqual([
      "/provider/bindings/b1",
      "/provider/bindings/b1/configuration",
      "/provider/bindings/b1/configuration/pricing",
      "/provider/bindings/b1/configuration/free-tier",
      "/provider/bindings/b1/configuration/sla",
      "/provider/bindings/b1/test",
      "/provider/bindings/b1/publish",
      "/provider/bindings/b1/sla",
      "/provider/bindings/b1/verdicts",
    ]);
    expect(screens.find((s) => s.href.endsWith("/free-tier"))?.label).toBe("Free tier");
  });

  // BUG-R4-D-01: the Publish screen was the one screen without the link row.
  it("has the link row on every one of those screens", () => {
    const root = join(process.cwd(), "src/app/(console)/provider/bindings/[bindingId]");
    for (const screen of screens) {
      const dir = join(root, screen.href.replace("/provider/bindings/b1", ""));
      const sources = [join(dir, "page.tsx")];
      try {
        const parts = join(dir, "_components");
        sources.push(...readdirSync(parts).map((file) => join(parts, file)));
      } catch {
        // No `_components` folder: the page file is the whole screen.
      }
      const rendersNav = sources.some((file) => readFileSync(file, "utf8").includes("<BindingNav"));
      expect(rendersNav, screen.label).toBe(true);
    }
  });
});
