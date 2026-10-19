import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { pathOf, routes } from "./routes";

describe("routes", () => {
  it("puts the record id in the query string on a fixed path", () => {
    expect(routes.receipt("int_1")).toBe("/receipts/view?id=int_1");
    expect(routes.disputes()).toBe("/spend/disputes");
    expect(routes.operatorCase("p 1/2")).toBe("/operator/cases/view?id=p+1%2F2");
    expect(routes.binding("b1")).toBe("/provider/bindings/view?binding=b1");
    expect(routes.binding("b1", "settings")).toBe("/provider/bindings/view/settings?binding=b1");
    expect(routes.verdict("b1", "v2", "evidence")).toBe(
      "/provider/bindings/view/verdicts/view/evidence?binding=b1&verdict=v2",
    );
  });

  it("builds explorer and calls links", () => {
    expect(routes.publicTool("t1")).toBe("/catalogue/view?tool=t1");
    expect(routes.publicProvider("p1")).toBe("/catalogue/provider?id=p1");
    expect(routes.exploreTool("t1")).toBe("/explore?tool=t1");
    expect(routes.calls()).toBe("/spend/calls");
    expect(routes.calls({ status: "not-charged", tool: "" })).toBe("/spend/calls?status=not-charged");
    expect(routes.calls({ status: "refused", call: "c1" })).toBe("/spend/calls?status=refused&call=c1");
    expect(routes.payment("c1")).toBe("/payments/view?id=c1");
  });

  it("gives the path a link points at, without its query", () => {
    expect(pathOf(routes.binding("b1", "quality"))).toBe("/provider/bindings/view/quality");
  });

  // A static export has no dynamic segment, so a page gets no route params:
  // reading them yields `undefined` (the publish and backtest screens asked
  // the API for binding "undefined").
  it("reads no route params on any page", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name === "page.tsx" && /\bparams\s*:/.test(readFileSync(path, "utf8"))) offenders.push(path);
      }
    };
    walk(join(process.cwd(), "src/app"));
    expect(offenders).toEqual([]);
  });
});

describe("routes.connectTools", () => {
  it("opens Connect with the tools chosen", () => {
    expect(routes.connectTools(["get_weather"])).toBe("/connect?tools=get_weather");
    expect(routes.connectTools(["a_b", "c-d"])).toBe("/connect?tools=a_b,c-d");
  });
});
