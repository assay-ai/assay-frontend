import { describe, expect, it } from "vitest";

import { loginHref, safeNextPath } from "./login-redirect";

describe("loginHref", () => {
  it("carries the path and query to return to", () => {
    expect(loginHref({ next: "/spend?window=7d", reason: "expired" })).toBe(
      "/login?next=%2Fspend%3Fwindow%3D7d&reason=expired",
    );
  });

  it("is plain /login when there is nowhere to return to", () => {
    expect(loginHref()).toBe("/login");
    expect(loginHref({ next: "/" })).toBe("/login");
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/funding/deposit?amount=20", "/funding/deposit?amount=20"],
    ["/receipts/view?id=abc#raw", "/receipts/view?id=abc#raw"],
  ])("keeps the in-app path %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    ["/provider", "/provider"],
    ["/provider/bindings?binding=abc", "/provider/bindings?binding=abc"],
    ["/connect?url=https%3A%2F%2Fmcp.example%2Fmy%2Fset", "/connect?url=https%3A%2F%2Fmcp.example%2Fmy%2Fset"],
    ["/operatorish", "/operatorish"],
  ])("keeps the in-app path %s (V1-13)", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  it.each([
    "https://evil.example/",
    "http:evil.example",
    "//evil.example/x",
    "///evil.example",
    "/\\evil.example",
    "/\\/evil.example",
    "\\\\evil.example",
    "/%2F%2Fevil.example",
    "/%2f/evil.example",
    "/%5Cevil.example",
    "/%5c%5cevil.example",
    "/%252F%252Fevil.example",
    "/%25252F%25252Fevil.example",
    "/%",
    "/a\\b",
    "/%09/evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    " /provider",
    "/provider ",
    "javascript:alert(1)",
    "data:text/html,x",
    "spend",
    "%2Fprovider",
    "/login",
    "/login?next=/x",
    "/operator",
    "/operator/cases",
    "",
    null,
    undefined,
  ])("refuses %j", (raw) => {
    expect(safeNextPath(raw)).toBe("/");
  });

  it("never returns anything that leaves the origin", () => {
    for (const raw of ["/x", "//x", "/\\x", "/%2F%2Fx", "/%5Cx", "https://x"]) {
      const next = safeNextPath(raw);
      expect(new URL(next, "https://app.invalid").origin).toBe("https://app.invalid");
      expect(next.startsWith("//")).toBe(false);
    }
  });
});
