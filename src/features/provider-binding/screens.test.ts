import { describe, expect, it } from "vitest";

import { bindingScreens } from "./screens";

describe("bindingScreens", () => {
  it("has three tabs: Overview, Settings, Quality", () => {
    expect(bindingScreens("b1").map((s) => [s.label, s.href])).toEqual([
      ["Overview", "/provider/bindings/view?binding=b1"],
      ["Settings", "/provider/bindings/view/settings?binding=b1"],
      ["Quality", "/provider/bindings/view/quality?binding=b1"],
    ]);
  });

});
