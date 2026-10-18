import { describe, expect, it } from "vitest";

import { labelForEndpoint, SELF_HOSTED } from "@/utils/provider-label";

import { bindingLabelOf } from "./tool-name";

describe("a listing's name", () => {
  it("is the tool's name", () => {
    expect(bindingLabelOf("Market quote", false)).toBe("Market quote");
  });

  it("is never the endpoint: … while loading, then Unknown tool", () => {
    expect(bindingLabelOf(null, true)).toBe("…");
    expect(bindingLabelOf(null, false)).toBe("Unknown tool");
  });
});

describe("an endpoint's short label", () => {
  it("shows a domain name, without port or path", () => {
    expect(labelForEndpoint("https://api.acme.example:8443/v1/quote?x=1")).toBe("api.acme.example");
  });

  it.each([
    "http://[2001:db8::1]:4010/v1",
    "http://203.0.113.7:4010/v1",
    "http://localhost:4010",
    "http://api.localhost/v1",
    "http://internal-box/v1",
    "not a url",
  ])("never shows a host or IP for %s", (endpoint) => {
    const label = labelForEndpoint(endpoint);
    expect(label).toBe(SELF_HOSTED);
    expect(label).not.toMatch(/\d+\.\d+|::|:\d+|localhost/);
  });
});
