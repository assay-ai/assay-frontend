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
    "https://evil.example/",
    "//evil.example/x",
    "/\\evil.example",
    "javascript:alert(1)",
    "spend",
    "/login?next=/x",
    "/operator/cases",
    "",
    null,
  ])("refuses %s", (raw) => {
    expect(safeNextPath(raw)).toBe("/");
  });
});
