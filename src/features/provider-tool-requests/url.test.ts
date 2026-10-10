import { describe, expect, it } from "vitest";

import { isHttpsUrl, isLinkableUrl } from "./url";

describe("tool request upstream url", () => {
  it("links only http(s) urls", () => {
    expect(isLinkableUrl("https://api.example.com/v1")).toBe(true);
    expect(isLinkableUrl("http://api.example.com")).toBe(true);
    expect(isLinkableUrl("javascript:alert(1)")).toBe(false);
    expect(isLinkableUrl("data:text/html,x")).toBe(false);
    expect(isLinkableUrl("not a url")).toBe(false);
  });

  it("accepts only https for filing", () => {
    expect(isHttpsUrl("https://api.example.com")).toBe(true);
    expect(isHttpsUrl("http://api.example.com")).toBe(false);
    expect(isHttpsUrl("ftp://x.example.com")).toBe(false);
  });
});
