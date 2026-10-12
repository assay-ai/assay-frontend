import { describe, expect, it } from "vitest";

import { accountDiffers, type AccountForm } from "./account-form";

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
