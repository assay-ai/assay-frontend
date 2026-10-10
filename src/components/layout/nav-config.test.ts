import { describe, expect, it } from "vitest";

import { BUYER_NAV_ITEMS, reachableNavIds, topBarPlacement } from "./nav-config";

const WIDTHS = [320, 390, 767, 768, 800, 833, 834, 1000, 1099, 1100, 1439, 1440, 1920];

describe("buyer nav reachability", () => {
  it.each(WIDTHS)("reaches every section at %ipx", (width) => {
    expect([...reachableNavIds(width)].sort()).toEqual(BUYER_NAV_ITEMS.map((i) => i.id).sort());
  });

  it("never lists an item both inline and in the overflow menu", () => {
    for (const width of WIDTHS.filter((w) => w >= 768)) {
      const { inline, overflow } = topBarPlacement(width);
      const ids = inline.map((i) => i.id).filter((id) => overflow.some((o) => o.id === id));
      expect(ids).toEqual([]);
    }
  });

  it("has no overflow menu at desktop width and shows something inline from 768", () => {
    expect(topBarPlacement(1440).overflow).toEqual([]);
    expect(topBarPlacement(768).inline.length).toBeGreaterThan(0);
  });
});
