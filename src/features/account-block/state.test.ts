import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccountBlockStatus } from "@/interfaces/account-block";

import {
  bannerStateFor,
  blockSummary,
  blockedWriteGuard,
  dismissBlockedRefusal,
  getAccountBlockSnapshot,
  reportBlockedRefusal,
  resetAccountBlock,
  setAccountBlockConfirmed,
  subscribeAccountBlock,
} from "./state";

const BLOCKED: AccountBlockStatus = {
  blocked: true,
  blocks: [
    {
      role: "PAYER",
      subjectKind: "WALLET",
      subject: "eip155:84532:0xa271a3407d3302f4b4fbe469b9188487cedd7d45",
      reasonCode: "LEAKED_KEY",
      blockedAt: "2026-10-14T10:00:00.000Z",
    },
  ],
};

afterEach(() => resetAccountBlock());

describe("bannerStateFor", () => {
  it("shows nothing for an account that is not blocked and was not refused", () => {
    expect(bannerStateFor(undefined, null)).toEqual({ kind: "none" });
    expect(bannerStateFor({ blocked: false, blocks: [] }, null)).toEqual({ kind: "none" });
  });

  it("shows the blocked banner when the status says so", () => {
    expect(bannerStateFor(BLOCKED, null)).toEqual({ kind: "blocked", blocks: BLOCKED.blocks });
  });

  it("an organization refusal is this account's own block, before the status confirms it", () => {
    const state = bannerStateFor(undefined, { code: "AUTH_ORGANIZATION_SUSPENDED", message: "x" });
    expect(state.kind).toBe("blocked");
  });

  it("an ACCOUNT_BLOCKED refusal the status does not confirm is worded as another party's", () => {
    const refusal = { code: "ACCOUNT_BLOCKED", message: "This account is blocked (payee)" };
    expect(bannerStateFor({ blocked: false, blocks: [] }, refusal)).toEqual({ kind: "refused", refusal });
    expect(bannerStateFor(undefined, refusal).kind).toBe("refused");
    expect(bannerStateFor(BLOCKED, refusal).kind).toBe("blocked");
  });
});

describe("the store", () => {
  it("records a refusal once, notifies, and can be dismissed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAccountBlock(listener);

    reportBlockedRefusal({ code: "ACCOUNT_BLOCKED", message: "m" });
    reportBlockedRefusal({ code: "ACCOUNT_BLOCKED", message: "m" });
    expect(getAccountBlockSnapshot().refusal).toEqual({ code: "ACCOUNT_BLOCKED", message: "m" });
    expect(listener).toHaveBeenCalledTimes(1);

    dismissBlockedRefusal();
    expect(getAccountBlockSnapshot().refusal).toBeNull();
    unsubscribe();
  });

  it("resets on identity change", () => {
    setAccountBlockConfirmed(true);
    reportBlockedRefusal({ code: "AUTH_ORGANIZATION_SUSPENDED", message: "m" });
    resetAccountBlock();
    expect(getAccountBlockSnapshot()).toEqual({ confirmed: false, refusal: null });
  });
});

describe("blockedWriteGuard", () => {
  it("lets everything through until the block is confirmed", () => {
    expect(blockedWriteGuard(false, "POST", "/payment-intents")).toBeNull();
  });

  it("refuses writes of a confirmed blocked account with ACCOUNT_BLOCKED", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      const error = blockedWriteGuard(true, method, "/providers/me/tool-bindings");
      expect(error?.code).toBe("ACCOUNT_BLOCKED");
      expect(error?.status).toBe(403);
    }
  });

  it("never refuses reads, nor the sign-in wallet link", () => {
    expect(blockedWriteGuard(true, "GET", "/account/block-status")).toBeNull();
    expect(blockedWriteGuard(true, "HEAD", "/x")).toBeNull();
    expect(blockedWriteGuard(true, "POST", "/auth/wallet/link")).toBeNull();
    expect(blockedWriteGuard(true, "POST", "http://api.test/api/v1/auth/wallet/link")).toBeNull();
  });
});

describe("blockSummary", () => {
  it("names what is blocked, since when and why — never the operator's note", () => {
    const line = blockSummary(BLOCKED.blocks[0], "en-US");
    expect(line).toBe("Your wallet is blocked since Oct 14, 2026 (reason: leaked key).");
  });
});
