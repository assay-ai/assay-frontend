import { describe, expect, it } from "vitest";

import { providerEntryFor } from "./entry";

const step = (status: "DONE" | "IN_PROGRESS" | "NOT_STARTED") => ({ key: "account" as const, title: "", caption: "", status });

describe("providerEntryFor", () => {
  it("offers List your API to a buyer with no provider row", () => {
    expect(providerEntryFor({ state: undefined, notRegistered: true })).toEqual({
      provider: false,
      label: "List your API",
      href: "/provider/setup",
    });
  });

  it("says nothing while the registration is unknown", () => {
    expect(providerEntryFor({ state: undefined, notRegistered: false })).toBeNull();
  });

  it("sends a registered provider with setup left back to setup", () => {
    expect(providerEntryFor({ state: { steps: [step("DONE"), step("IN_PROGRESS")] }, notRegistered: false })).toEqual({
      provider: true,
      label: "Finish provider setup",
      href: "/provider/setup",
    });
  });

  it("shows Provider console once setup is done", () => {
    expect(providerEntryFor({ state: { steps: [step("DONE"), step("DONE")] }, notRegistered: false })).toEqual({
      provider: true,
      label: "Provider console",
      href: "/provider",
    });
  });
});
