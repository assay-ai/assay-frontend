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
});
