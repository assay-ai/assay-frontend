import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { bindingScreens, RETIRED_BINDING_PAGES } from "./screens";

describe("bindingScreens", () => {
  it("has three tabs: Overview, Settings, Quality", () => {
    expect(bindingScreens("b1").map((s) => [s.label, s.href])).toEqual([
      ["Overview", "/provider/bindings/view?binding=b1"],
      ["Settings", "/provider/bindings/view/settings?binding=b1"],
      ["Quality", "/provider/bindings/view/quality?binding=b1"],
    ]);
  });

  it("redirects every retired binding page to its successor", () => {
    const root = join(process.cwd(), "src/app/(console)/provider/bindings/view");
    for (const [old, to] of Object.entries(RETIRED_BINDING_PAGES)) {
      const source = readFileSync(join(root, old, "page.tsx"), "utf8");
      expect(source, old).toContain("ClientRedirect");
      expect(source, old).toContain(`RETIRED_BINDING_PAGES["${old}"]`);
      expect(to.startsWith("/provider/bindings/")).toBe(true);
    }
  });
});
