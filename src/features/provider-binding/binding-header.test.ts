import { describe, expect, it } from "vitest";

import { notPublicText } from "./binding-header";

/*
  Only a live listing has a public page. A draft, paused or blocked one says so
  in place of "How buyers see it", instead of linking to a not-found page
  (review 2026-10-17 sync 2, P1-1).
*/
describe("notPublicText", () => {
  it("says a draft becomes public once it is live", () => {
    expect(notPublicText("DRAFT")).toBe("Not public yet: buyers see it once it is live");
  });

  it("says a paused or blocked listing is not shown to buyers", () => {
    expect(notPublicText("PAUSED")).toMatch(/^Paused: not shown to buyers/);
    expect(notPublicText("SUSPENDED")).toMatch(/^Blocked: not shown to buyers/);
  });
});
