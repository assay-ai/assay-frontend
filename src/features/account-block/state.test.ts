import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccountBlockStatus } from "@/interfaces/account-block";

import {
  bannerStateFor,
  blockSummary,
  blockedWriteGuard,
  dismissBlockedRefusal,
  getAccountBlockSnapshot,
  hasBlockStatusSession,
  reportBlockedRefusal,
  resetAccountBlock,
  setAccountBlockConfirmed,
  settleBlockStatus,
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

  // BUG-X-02: the backend now refuses a blocked organization with ACCOUNT_BLOCKED and this wording.
  it("an ACCOUNT_BLOCKED refusal worded as this account's is this account's own block", () => {
    const refusal = { code: "ACCOUNT_BLOCKED", message: "Your account is blocked by Assay; contact support" };
    expect(bannerStateFor(undefined, refusal).kind).toBe("blocked");
    expect(bannerStateFor({ blocked: false, blocks: [] }, refusal).kind).toBe("blocked");
  });

  it("an ACCOUNT_BLOCKED refusal whose role is given is read by its role", () => {
    expect(bannerStateFor(undefined, { code: "ACCOUNT_BLOCKED", message: "x", role: "ORGANIZATION" }).kind).toBe("blocked");
    expect(bannerStateFor(undefined, { code: "ACCOUNT_BLOCKED", message: "Your account is blocked by Assay", role: "PAYEE" }).kind).toBe("refused");
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

  it("never refuses the read-only penalties lookup POST, and only that exact route", () => {
    expect(blockedWriteGuard(true, "POST", "/providers/me/slash-requests/lookup")).toBeNull();
    expect(blockedWriteGuard(true, "POST", "http://api.test/api/v1/providers/me/slash-requests/lookup")).toBeNull();
    expect(blockedWriteGuard(true, "POST", "/providers/me/slash-requests/lookup/x")?.code).toBe("ACCOUNT_BLOCKED");
    expect(blockedWriteGuard(true, "DELETE", "/providers/me/slash-requests/lookup")?.code).toBe("ACCOUNT_BLOCKED");
    expect(blockedWriteGuard(true, "POST", "/providers/me/slash-requests")?.code).toBe("ACCOUNT_BLOCKED");
  });

  it("lets a blocked provider build an on-chain dispute, which the chain allows", () => {
    expect(blockedWriteGuard(true, "POST", "/providers/me/slash-requests/dispute-intent")).toBeNull();
    expect(
      blockedWriteGuard(true, "POST", "http://api.test/api/v1/providers/me/slash-requests/dispute-intent"),
    ).toBeNull();
    expect(blockedWriteGuard(true, "PUT", "/providers/me/slash-requests/dispute-intent")?.code).toBe(
      "ACCOUNT_BLOCKED",
    );
  });

  it("lets a blocked account revoke its delegates and agent credentials (@AllowedWhileBlocked)", () => {
    expect(blockedWriteGuard(true, "POST", "/escrow/delegates/revoke-intent")).toBeNull();
    expect(blockedWriteGuard(true, "POST", "http://api.test/api/v1/escrow/delegates/revoke")).toBeNull();
    expect(blockedWriteGuard(true, "DELETE", "/agents/a1/credentials/c1")).toBeNull();
    expect(blockedWriteGuard(true, "DELETE", "http://api.test/api/v1/agents/a1/credentials/c1?x=1")).toBeNull();
  });

  it("allows only those exact revoke routes and methods", () => {
    expect(blockedWriteGuard(true, "POST", "/escrow/delegates/intent")?.code).toBe("ACCOUNT_BLOCKED");
    expect(blockedWriteGuard(true, "POST", "/escrow/delegates")?.code).toBe("ACCOUNT_BLOCKED");
    expect(blockedWriteGuard(true, "DELETE", "/escrow/delegates/revoke")?.code).toBe("ACCOUNT_BLOCKED");
    expect(blockedWriteGuard(true, "POST", "/agents/a1/credentials")?.code).toBe("ACCOUNT_BLOCKED");
    expect(blockedWriteGuard(true, "POST", "/agents/a1/credentials/c1")?.code).toBe("ACCOUNT_BLOCKED");
    expect(blockedWriteGuard(true, "DELETE", "/agents/a1/credentials/c1/x")?.code).toBe("ACCOUNT_BLOCKED");
    expect(blockedWriteGuard(true, "DELETE", "/agents/a1")?.code).toBe("ACCOUNT_BLOCKED");
  });
});

describe("hasBlockStatusSession", () => {
  it("is a session once Privy is ready and signed in", () => {
    expect(hasBlockStatusSession({ ready: true, authenticated: true, hasStoredToken: false })).toBe(true);
  });

  it("is a session with a stored token even while Privy never becomes ready (token-based sessions)", () => {
    expect(hasBlockStatusSession({ ready: false, authenticated: false, hasStoredToken: true })).toBe(true);
  });

  it("is no session for a signed-out visitor with no token", () => {
    expect(hasBlockStatusSession({ ready: false, authenticated: false, hasStoredToken: false })).toBe(false);
    expect(hasBlockStatusSession({ ready: true, authenticated: false, hasStoredToken: false })).toBe(false);
    // Privy not ready yet: `authenticated` is not to be trusted.
    expect(hasBlockStatusSession({ ready: false, authenticated: true, hasStoredToken: false })).toBe(false);
  });
});

describe("settleBlockStatus", () => {
  const SUSPENDED = { code: "AUTH_ORGANIZATION_SUSPENDED", message: "m" };

  it("a fresh blocked:false clears an organization refusal, and a later refusal sets it again", () => {
    vi.useFakeTimers({ now: 1_000 });
    try {
      reportBlockedRefusal(SUSPENDED);
      vi.setSystemTime(2_000);
      settleBlockStatus(false, Date.now());
      expect(getAccountBlockSnapshot().refusal).toBeNull();
      expect(bannerStateFor({ blocked: false, blocks: [] }, getAccountBlockSnapshot().refusal)).toEqual({ kind: "none" });

      vi.setSystemTime(3_000);
      reportBlockedRefusal(SUSPENDED);
      expect(getAccountBlockSnapshot().refusal).toEqual(SUSPENDED);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a fresh blocked:false clears an own ACCOUNT_BLOCKED refusal, never another party's", () => {
    vi.useFakeTimers({ now: 10_000 });
    try {
      reportBlockedRefusal({ code: "ACCOUNT_BLOCKED", message: "Your account is blocked by Assay; contact support" });
      vi.setSystemTime(11_000);
      settleBlockStatus(false, Date.now());
      expect(getAccountBlockSnapshot().refusal).toBeNull();

      const payee = { code: "ACCOUNT_BLOCKED", message: "This account is blocked (payee); contact support" };
      reportBlockedRefusal(payee);
      vi.setSystemTime(12_000);
      settleBlockStatus(false, Date.now());
      expect(getAccountBlockSnapshot().refusal).toEqual(payee);
      dismissBlockedRefusal();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a status asked for before the refusal does not clear it", () => {
    vi.useFakeTimers({ now: 5_000 });
    try {
      reportBlockedRefusal(SUSPENDED);
      settleBlockStatus(false, 4_000);
      expect(getAccountBlockSnapshot().refusal).toEqual(SUSPENDED);
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocked:true keeps the refusal", () => {
    reportBlockedRefusal(SUSPENDED);
    settleBlockStatus(true, Date.now() + 1);
    expect(getAccountBlockSnapshot().refusal).toEqual(SUSPENDED);
  });

  it("keeps another party's refusal while this account was never blocked", () => {
    const refusal = { code: "ACCOUNT_BLOCKED", message: "payee" };
    reportBlockedRefusal(refusal);
    settleBlockStatus(false, Date.now() + 1);
    expect(getAccountBlockSnapshot().refusal).toEqual(refusal);
  });

  it("clears every refusal when a confirmed block is lifted", () => {
    setAccountBlockConfirmed(true);
    reportBlockedRefusal({ code: "ACCOUNT_BLOCKED", message: "own wallet" });
    settleBlockStatus(false, Date.now() + 1);
    expect(getAccountBlockSnapshot().refusal).toBeNull();
  });
});

describe("blockSummary", () => {
  it("names what is blocked, since when and why — never the operator's note", () => {
    const line = blockSummary(BLOCKED.blocks[0], "en-US");
    expect(line).toBe("Your wallet is blocked since Oct 14, 2026 (reason: leaked key).");
  });
});
