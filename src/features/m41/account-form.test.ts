import { describe, expect, it } from "vitest";

import { accountDiffers, accountErrorsOf, isTimezone, type AccountForm } from "./account-form";

const saved: AccountForm = {
  legalName: "Open Meteo",
  technicalName: "Tess",
  technicalEmail: "tech@open-meteo-demo.test",
  ownerName: "Owen",
  ownerEmail: "owner@open-meteo-demo.test",
  timezone: "Europe/Oslo",
};

describe("accountDiffers (BUG-R2-V1-01)", () => {
  it("is clean for the registration as loaded, whitespace aside", () => {
    expect(accountDiffers({ ...saved, ownerName: " Owen " }, saved)).toBe(false);
  });

  it("sees an edited field, so Save and continue saves instead of leaving", () => {
    expect(accountDiffers({ ...saved, ownerEmail: "TECH@open-meteo-demo.test" }, saved)).toBe(true);
  });

  it("is dirty before any registration exists", () => {
    expect(accountDiffers(saved, null)).toBe(true);
  });
});

describe("isTimezone: the IANA check the error text asks for", () => {
  it("accepts real zones and refuses made-up ones and blanks", () => {
    expect(isTimezone("Europe/Oslo")).toBe(true);
    expect(isTimezone(" UTC ")).toBe(true);
    expect(isTimezone("Mars/Base")).toBe(false);
    expect(isTimezone("hello")).toBe(false);
    expect(isTimezone("  ")).toBe(false);
  });
});

/* Onboarding wave 2 item 5: the second contact is optional at sign-up. */
describe("accountErrorsOf", () => {
  const solo: AccountForm = { ...saved, ownerName: "", ownerEmail: "" };

  it("accepts a solo developer with no second contact", () => {
    expect(accountErrorsOf(solo, false)).toEqual({});
  });

  it("checks a second contact once one is typed", () => {
    expect(accountErrorsOf({ ...solo, ownerName: "Sam" }, false)).toEqual({ ownerEmail: "Enter an email address we can reach a person at." });
    expect(accountErrorsOf({ ...solo, ownerName: "Sam", ownerEmail: saved.technicalEmail }, false).ownerEmail).toMatch(/same inbox/);
    expect(accountErrorsOf(saved, false)).toEqual({});
  });

  it("keeps a saved second contact required: it can be replaced, not removed", () => {
    expect(Object.keys(accountErrorsOf(solo, true))).toEqual(["ownerName", "ownerEmail"]);
  });
});
