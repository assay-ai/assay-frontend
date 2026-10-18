import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const path = vi.hoisted(() => ({ current: "/explore/toolsets" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));

import { ExploreNav } from "./explore-nav";

describe("Explore tabs", () => {
  it("has Tools, Providers and Tool sets, and marks the one open", () => {
    const html = renderToStaticMarkup(<ExploreNav />);
    expect([...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(["Tools", "Providers", "Tool sets"]);
    const selected = (markup: string) => [...markup.matchAll(/aria-selected="true"[^>]*>([^<]+)</g)].map((m) => m[1]);
    // Only Tool sets: "/explore/toolsets" must not also light up Tools.
    expect(selected(html)).toEqual(["Tool sets"]);
    path.current = "/explore";
    expect(selected(renderToStaticMarkup(<ExploreNav />))).toEqual(["Tools"]);
  });
});
