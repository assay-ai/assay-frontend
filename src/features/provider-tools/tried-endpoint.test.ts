// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { clearSessionToken } from "@/libs/ApiClient";

import { cleanEndpoint, endpointPath, rememberTriedEndpoint, triedEndpointFor } from "./tried-endpoint";

afterEach(() => window.sessionStorage.clear());

/* Onboarding run 3: curl "https://api.frankfurter.app/latest?from=GBP&to=JPY" is tried at …/latest. */
describe("tried endpoint", () => {
  it("keeps origin and path, never a query, a fragment or credentials", () => {
    expect(cleanEndpoint("https://api.frankfurter.app/latest?from=GBP&to=JPY")).toBe("https://api.frankfurter.app/latest");
    expect(cleanEndpoint("https://api.frankfurter.app/latest/#x")).toBe("https://api.frankfurter.app/latest");
    expect(cleanEndpoint("https://user:pw@api.example.com/v1")).toBeNull();
    expect(cleanEndpoint("ftp://api.example.com/v1")).toBeNull();
    expect(cleanEndpoint("not a url")).toBeNull();
    expect(cleanEndpoint(null)).toBeNull();
  });

  it("is kept per tool for the tab, and cleared on logout", () => {
    rememberTriedEndpoint("tool-1", "https://api.frankfurter.app/latest");
    expect(triedEndpointFor("tool-1")).toBe("https://api.frankfurter.app/latest");
    expect(triedEndpointFor("tool-2")).toBeNull();
    expect(triedEndpointFor(null)).toBeNull();
    clearSessionToken();
    expect(triedEndpointFor("tool-1")).toBeNull();
  });

  it("names the path of an address", () => {
    expect(endpointPath("https://api.frankfurter.app/latest/")).toBe("/latest");
    expect(endpointPath("https://api.frankfurter.app")).toBe("");
    expect(endpointPath("nope")).toBe("");
  });
});
