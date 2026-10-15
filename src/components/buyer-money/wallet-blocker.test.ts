import { describe, expect, it } from "vitest";

import { walletBlockerText } from "./use-buyer-money";

describe("walletBlockerText", () => {
  it("is null once the wallet is ready", () => {
    expect(walletBlockerText({ status: "ready" }, null, { slow: false })).toBeNull();
  });

  it("waits, then says what to do when the wallet never connects", () => {
    expect(walletBlockerText({ status: "hydrating" }, null, { slow: false })).toBe("Connecting your wallet…");
    const slow = walletBlockerText({ status: "hydrating" }, null, { slow: true });
    expect(slow).toMatch(/Reload the page/);
    expect(slow).toMatch(/sign out and sign in again/);
  });

  it("names the owner's wallet when another one is connected", () => {
    expect(walletBlockerText({ status: "address-not-connected" }, "0x12…ab", { slow: false })).toMatch(/0x12…ab/);
  });

  it("asks for a wallet when there is none", () => {
    expect(walletBlockerText({ status: "no-wallet" }, null, { slow: false })).toBe("Connect a wallet to sign.");
  });
});
