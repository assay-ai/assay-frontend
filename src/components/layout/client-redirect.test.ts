import { describe, expect, it } from "vitest";

import { redirectTarget } from "./client-redirect";

describe("redirectTarget", () => {
  it("keeps the query string, so record ids survive the move", () => {
    expect(redirectTarget("/provider/bindings/view/settings", "?binding=b1")).toBe("/provider/bindings/view/settings?binding=b1");
  });

  it("lets the target add or override parameters and rename old ones", () => {
    expect(redirectTarget("/provider/penalties?tab=disputed", "?id=p1", { rename: { id: "case" } })).toBe(
      "/provider/penalties?case=p1&tab=disputed",
    );
  });

  it("can drop the old query", () => {
    expect(redirectTarget("/provider", "?x=1", { keep: false })).toBe("/provider");
  });
});
