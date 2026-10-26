import { describe, expect, it } from "vitest";

import { needsSecondContact, secondContactGiven } from "./second-contact";

describe("second contact", () => {
  it("is optional: an empty pair is not a given contact", () => {
    expect(secondContactGiven({ ownerName: " ", ownerEmail: "" })).toBe(false);
    expect(secondContactGiven({ ownerName: "Sam", ownerEmail: "" })).toBe(true);
  });

  it("is asked before a paid listing, never for a free one", () => {
    expect(needsSecondContact({ paid: false, ownerContact: null, gateUnmet: false })).toBe(false);
    expect(needsSecondContact({ paid: true, ownerContact: null, gateUnmet: false })).toBe(true);
    expect(needsSecondContact({ paid: true, ownerContact: { name: "Sam", email: "s@x.example", phone: null }, gateUnmet: false })).toBe(false);
    expect(needsSecondContact({ paid: true, ownerContact: undefined, gateUnmet: false })).toBe(false);
    expect(needsSecondContact({ paid: false, ownerContact: null, gateUnmet: true })).toBe(true);
  });
});
