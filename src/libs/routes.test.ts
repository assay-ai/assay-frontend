import { describe, expect, it } from "vitest";

import { pathOf, routes } from "./routes";

describe("routes", () => {
  it("puts the record id in the query string on a fixed path", () => {
    expect(routes.receipt("int_1")).toBe("/receipts/view?id=int_1");
    expect(routes.operatorCase("p 1/2")).toBe("/operator/cases/view?id=p+1%2F2");
    expect(routes.binding("b1")).toBe("/provider/bindings/view?binding=b1");
    expect(routes.binding("b1", "configuration/pricing")).toBe(
      "/provider/bindings/view/configuration/pricing?binding=b1",
    );
    expect(routes.verdict("b1", "v2", "evidence")).toBe(
      "/provider/bindings/view/verdicts/view/evidence?binding=b1&verdict=v2",
    );
  });

  it("gives the path a link points at, without its query", () => {
    expect(pathOf(routes.binding("b1", "test"))).toBe("/provider/bindings/view/test");
  });
});
