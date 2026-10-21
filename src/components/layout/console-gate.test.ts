import { describe, expect, it } from "vitest";

import { consoleShellReady } from "./console-gate";

const base = { demo: false, ready: true, authenticated: false, storedToken: false };

describe("the console shell gate", () => {
  it("draws nothing while Privy has not settled", () => {
    expect(consoleShellReady({ ...base, ready: false, authenticated: true, storedToken: true })).toBe(false);
  });

  it("draws nothing for a signed-out visitor (the 401 redirect does the rest)", () => {
    expect(consoleShellReady(base)).toBe(false);
  });

  it("draws the shell for a signed-in person", () => {
    expect(consoleShellReady({ ...base, authenticated: true })).toBe(true);
  });

  it("keeps working for a stored session token, as the API client does", () => {
    expect(consoleShellReady({ ...base, storedToken: true })).toBe(true);
  });

  it("always draws on a demo build", () => {
    expect(consoleShellReady({ ...base, demo: true, ready: false })).toBe(true);
  });

  it("never waits forever: after the timeout the page renders as before the gate", () => {
    expect(consoleShellReady({ ...base, ready: false, timedOut: true })).toBe(true);
  });
});
