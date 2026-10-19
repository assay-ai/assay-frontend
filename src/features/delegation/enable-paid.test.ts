import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import type { EscrowDelegate } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";

import {
  CLOCK_SKEW_TEXT,
  DEFAULT_CAPS,
  ENABLE_PAID_STRINGS,
  STRICT_PAGE_RPC_ORIGINS,
  actionLabelFor,
  collectPages,
  depositRunsHere,
  enablePaidPlan,
  enablePaidReturnHref,
  enablePaidReturnTo,
  initialDraft,
  pageExpiry,
  boundLine,
  enablePaidState,
  enablePaidFailure,
  fingerprint,
  lossBound,
  parseEnablePaidCaps,
  planSignatures,
  readPaymentKey,
  takePaymentKey,
  walletCheckCopy,
  type EnablePaidCredential,
  type CapsDraft,
  type EnablePaidInput,
} from "./enable-paid";

const KEY = "0x11111111111111111111111111111111" + "1A2b9F3c";
const KEY_ACCOUNT = `eip155:46630:${KEY.toLowerCase()}`;
const NOW = Date.parse("2026-10-19T10:00:00.000Z");
const DAY = 86_400_000;
const usd = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x0", decimals: 6 });

function credential(overrides: Partial<EnablePaidCredential> = {}): EnablePaidCredential {
  return {
    id: "cred-1",
    agentId: "agt-1",
    name: "Assay app on laptop",
    issuedVia: "OAUTH",
    oauthClient: { name: "Assay app", paymentClient: true },
    expiresAt: "2026-11-18T10:00:00.000Z",
    revokedAt: null,
    delegateAccount: KEY_ACCOUNT,
    ...overrides,
  };
}

function delegation(overrides: Partial<EscrowDelegate> = {}): EscrowDelegate {
  return {
    delegate: KEY_ACCOUNT,
    maxVoucherAmount: usd("500000"),
    maxPerWindow: usd("5000000"),
    spentInWindow: usd("0"),
    validUntil: new Date(NOW + 20 * DAY).toISOString(),
    status: "ACTIVE",
    unsettled: { count: 0, amount: usd("0"), largest: usd("0"), windowNeeds: usd("0"), redeemableUntil: null },
    ...overrides,
  };
}

function input(overrides: Partial<EnablePaidInput> = {}): EnablePaidInput {
  return {
    credentialId: "cred-1",
    fragmentKey: KEY,
    agents: [{ agentId: "agt-1", label: "research-bot" }],
    credentials: { "agt-1": [credential()] },
    delegates: [],
    nowMs: NOW,
    servesPaid: () => true,
    ...overrides,
  };
}

describe("readPaymentKey", () => {
  it("reads #key=0x…", () => {
    expect(readPaymentKey(`#key=${KEY}`)).toEqual({ kind: "key", address: KEY });
  });
  it("no fragment, or no key in it, is missing", () => {
    expect(readPaymentKey("")).toEqual({ kind: "missing" });
    expect(readPaymentKey("#other=1")).toEqual({ kind: "missing" });
  });
  it("a malformed key is not a key", () => {
    expect(readPaymentKey("#key=0x1234")).toEqual({ kind: "malformed" });
  });
});

describe("enablePaidState: checks before anything is approvable", () => {
  it("missing #key → refuse", () => {
    const state = enablePaidState(input({ fragmentKey: null }));
    expect(state).toMatchObject({ kind: "refused", reason: "missing-key", text: ENABLE_PAID_STRINGS.missingKey });
  });

  it("#key ≠ delegateAccount → the exact refusal text", () => {
    const state = enablePaidState(input({ fragmentKey: "0x2222222222222222222222222222222222222222" }));
    expect(state).toEqual({
      kind: "refused",
      reason: "key-mismatch",
      text: "This link doesn't match the payment key bound to this app. Don't approve.",
    });
  });

  it("a malformed #key, or no key bound at all, is a mismatch", () => {
    expect(enablePaidState(input({ fragmentKey: "nonsense" }))).toMatchObject({ reason: "key-mismatch" });
    const unbound = input({ credentials: { "agt-1": [credential({ delegateAccount: null })] } });
    expect(enablePaidState(unbound)).toMatchObject({ reason: "key-mismatch" });
  });

  it("the key match ignores address case", () => {
    expect(enablePaidState(input({ fragmentKey: KEY.toUpperCase().replace("0X", "0x") })).kind).toBe("ready");
  });

  it('third-party OAuth credential → "This app can\'t hold a payment key."', () => {
    const third = credential({ oauthClient: { name: "Claude Code", paymentClient: false }, delegateAccount: null });
    const state = enablePaidState(input({ credentials: { "agt-1": [third] } }));
    expect(state).toEqual({ kind: "refused", reason: "not-payment-client", text: "This app can't hold a payment key." });
  });

  it("an OAuth credential with no client named is refused too", () => {
    const state = enablePaidState(input({ credentials: { "agt-1": [credential({ oauthClient: null })] } }));
    expect(state).toMatchObject({ reason: "not-payment-client" });
  });

  it("an API key may hold a payment key", () => {
    const key = credential({ issuedVia: "API_KEY", oauthClient: null, name: "CI deploy" });
    const state = enablePaidState(input({ credentials: { "agt-1": [key] } }));
    expect(state).toMatchObject({ kind: "ready", registeredBy: "Registered with an API key" });
  });

  it("a revoked or expired credential: signed out", () => {
    for (const dead of [credential({ revokedAt: "2026-10-18T00:00:00.000Z" }), credential({ expiresAt: "2026-10-19T09:00:00.000Z" })]) {
      const state = enablePaidState(input({ credentials: { "agt-1": [dead] } }));
      expect(state).toEqual({
        kind: "refused",
        reason: "signed-out",
        text: "This app was signed out. Sign in again from the app.",
      });
    }
  });

  it("a credential of another account (not in the list): not found", () => {
    expect(enablePaidState(input({ credentialId: "cred-other" }))).toMatchObject({ kind: "refused", reason: "not-found" });
    expect(enablePaidState(input({ credentialId: null }))).toMatchObject({ kind: "refused", reason: "not-found" });
  });

  it("a chain without rail B", () => {
    const state = enablePaidState(input({ servesPaid: () => false }));
    expect(state).toEqual({ kind: "refused", reason: "no-rail", text: "Paid calls aren't available on this network yet." });
  });

  it("ready: the header, the source, the fingerprint and the key", () => {
    const state = enablePaidState(input());
    expect(state).toMatchObject({
      kind: "ready",
      title: "Turn on paid calls for Assay app on laptop",
      registeredBy: "Registered by Assay app on this computer",
      agentLabel: "research-bot",
      address: KEY,
      chainId: "eip155:46630",
      fingerprint: "1A2B 9F3C",
      keyCheck: "Check this matches what your app showed: 1A2B 9F3C",
      grant: { kind: "none" },
    });
  });

  it("the credential name is folded: no trust marks", () => {
    const state = enablePaidState(input({ credentials: { "agt-1": [credential({ name: "Assay app ✓ Verified" })] } }));
    expect(state).toMatchObject({ title: "Turn on paid calls for Assay app" });
  });
});

describe("enablePaidState: the key's on-chain grant", () => {
  it('active key → "Paid calls are already on for this key" with Renew', () => {
    const state = enablePaidState(input({ delegates: [delegation()] }));
    expect(state).toMatchObject({ kind: "ready", grant: { kind: "active", daysLeft: 20 } });
    if (state.kind !== "ready") throw new Error("not ready");
    expect(state.notice).toBe("Paid calls are already on for this key");
    expect(state.actionLabel).toBe("Renew");
    expect(state.renewCaps).toEqual({ perCall: "0.5", perDay: "5" });
  });

  it('≤ 7 days left → "Renew for 30 days"', () => {
    const state = enablePaidState(input({ delegates: [delegation({ validUntil: new Date(NOW + 7 * DAY).toISOString() })] }));
    expect(state).toMatchObject({ kind: "ready", grant: { kind: "expiring", daysLeft: 7 }, actionLabel: "Renew for 30 days" });
  });

  it("an expired grant is a new approval", () => {
    const expired = delegation({ status: "EXPIRED", validUntil: new Date(NOW - DAY).toISOString() });
    expect(enablePaidState(input({ delegates: [expired] }))).toMatchObject({ grant: { kind: "none" }, actionLabel: "Approve" });
  });

  it("another key's grant does not count", () => {
    const other = delegation({ delegate: "eip155:46630:0x2222222222222222222222222222222222222222" });
    expect(enablePaidState(input({ delegates: [other] }))).toMatchObject({ grant: { kind: "none" } });
  });
});

describe("caps", () => {
  it("default to Light: $0.50, $5, 30 days", () => {
    expect(DEFAULT_CAPS).toEqual({ perCall: "0.50", perDay: "5", days: "30" });
  });

  it("bound for 5/day × 30 days = $155", () => {
    expect(lossBound("5", "30")).toBe("$155");
    expect(boundLine("5", "30")).toBe(
      "Most this key can spend before it expires: $155. One budget covers every Assay server on this computer; your agent's limits apply on top.",
    );
    expect(lossBound("20", "7")).toBe("$160");
    expect(lossBound("2.5", "1")).toBe("$5");
    expect(lossBound("x", "30")).toBeNull();
  });

  it("parses into atomic amounts, with the chain's rules", () => {
    expect(parseEnablePaidCaps(DEFAULT_CAPS, 6)).toEqual({
      ok: true,
      maxVoucherAmount: "500000",
      maxPerWindow: "5000000",
      days: 30,
    });
    expect(parseEnablePaidCaps({ perCall: "6", perDay: "5", days: "30" }, 6)).toMatchObject({ ok: false });
    expect(parseEnablePaidCaps({ perCall: "0.5", perDay: "5", days: "0" }, 6)).toMatchObject({ ok: false });
    expect(parseEnablePaidCaps({ perCall: "0.5", perDay: "5", days: "31" }, 6)).toMatchObject({ ok: false });
    expect(parseEnablePaidCaps({ perCall: "0.5", perDay: "5", days: "30" }, 6)).toMatchObject({ ok: true, days: 30 });
  });

  it("the wallet copy names the fingerprint and the limits", () => {
    expect(walletCheckCopy(KEY, "0.50", "5")).toBe(
      "In the wallet window, check the payment key ends with 1A2B9F3C and the limits are $0.50 a call and $5 per 24 hours.",
    );
  });

  it("fingerprint is the last 8 hex characters, upper case, in two groups", () => {
    expect(fingerprint(KEY_ACCOUNT)).toBe("1A2B 9F3C");
  });
});

describe("planSignatures", () => {
  const chosen = { maxVoucherAmount: "500000", maxPerWindow: "5000000" };
  it("ceiling below caps → two signatures planned", () => {
    expect(planSignatures({ perCall: "250000", perWindow: "9000000" }, chosen)).toEqual(["SET_LIMITS", "AUTHORIZE_DELEGATE"]);
    expect(planSignatures({ perCall: "500000", perWindow: "4999999" }, chosen)).toEqual(["SET_LIMITS", "AUTHORIZE_DELEGATE"]);
    expect(planSignatures(null, chosen)).toEqual(["SET_LIMITS", "AUTHORIZE_DELEGATE"]);
  });
  it("otherwise one", () => {
    expect(planSignatures({ perCall: "500000", perWindow: "5000000" }, chosen)).toEqual(["AUTHORIZE_DELEGATE"]);
    expect(planSignatures({ perCall: "1000000", perWindow: "20000000" }, chosen)).toEqual(["AUTHORIZE_DELEGATE"]);
  });
});

describe("enablePaidFailure", () => {
  it('SETTLEMENT_RELAYED_INTENT_RATE_LIMITED → "Try again in {n} minutes."', () => {
    const at = new Date(NOW + 12 * 60_000 - 5_000).toISOString();
    const error = new ApiError("SETTLEMENT_RELAYED_INTENT_RATE_LIMITED", `Relay budget spent. You can make the next one from ${at}.`, 429);
    expect(enablePaidFailure(error, NOW)).toBe("Try again in 12 minutes.");
  });
  it("one minute is singular; no time named reads as a few minutes", () => {
    const at = new Date(NOW + 30_000).toISOString();
    expect(enablePaidFailure(new ApiError("SETTLEMENT_RELAYED_INTENT_RATE_LIMITED", `from ${at}`, 429), NOW)).toBe(
      "Try again in 1 minute.",
    );
    expect(enablePaidFailure(new ApiError("SETTLEMENT_RELAYED_INTENT_RATE_LIMITED", "busy", 429), NOW)).toBe(
      "Try again in a few minutes.",
    );
  });
  it("anything else is not handled here", () => {
    expect(enablePaidFailure(new ApiError("OTHER", "x", 400), NOW)).toBeNull();
    expect(enablePaidFailure(new Error("x"), NOW)).toBeNull();
  });
});

describe("takePaymentKey", () => {
  function fakeWindow(hash: string, store: Map<string, string>) {
    return {
      location: { hash },
      sessionStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    } as unknown as Window;
  }

  it("keeps the fragment's key for this credential, and finds it again after a sign-in drops the fragment", () => {
    const store = new Map<string, string>();
    expect(takePaymentKey("cred-1", fakeWindow(`#key=${KEY}`, store))).toBe(KEY);
    expect(takePaymentKey("cred-1", fakeWindow("", store))).toBe(KEY);
  });

  it("never hands one credential's key to another", () => {
    const store = new Map<string, string>();
    takePaymentKey("cred-1", fakeWindow(`#key=${KEY}`, store));
    expect(takePaymentKey("cred-2", fakeWindow("", store))).toBeNull();
  });

  it("a malformed key is passed on as it is (refused as a mismatch) and not kept", () => {
    const store = new Map<string, string>();
    expect(takePaymentKey("cred-1", fakeWindow("#key=0x12", store))).toBe("0x12");
    expect(store.size).toBe(0);
  });
});

describe("fix round 1", () => {
  it("a credential without issuedVia is not taken for an API key", () => {
    const legacy = { ...credential({ oauthClient: null }), issuedVia: undefined } as unknown as EnablePaidCredential;
    expect(enablePaidState(input({ credentials: { "agt-1": [legacy] } }))).toMatchObject({ reason: "not-payment-client" });
  });

  it("a renewal starts on the grant's caps, never above Light", () => {
    const big = delegation({ maxVoucherAmount: usd("100000000"), maxPerWindow: usd("1000000000") });
    const state = enablePaidState(input({ delegates: [big] }));
    if (state.kind !== "ready") throw new Error("not ready");
    expect(initialDraft(state)).toEqual({ perCall: "0.50", perDay: "5", days: "30" });
    const small = enablePaidState(input({ delegates: [delegation({ maxVoucherAmount: usd("200000"), maxPerWindow: usd("2000000") })] }));
    if (small.kind !== "ready") throw new Error("not ready");
    expect(initialDraft(small)).toEqual({ perCall: "0.2", perDay: "2", days: "30" });
    const fresh = enablePaidState(input());
    if (fresh.kind !== "ready") throw new Error("not ready");
    expect(initialDraft(fresh)).toEqual(DEFAULT_CAPS);
  });

  it("the expiry comes from this device's clock; the server's only checks it (±120 s)", () => {
    const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
    expect(pageExpiry({ localNowMs: NOW, serverTime: at(119_000), receivedAtMs: NOW, days: 30 })).toEqual({
      ok: true,
      validUntil: NOW / 1000 + 30 * 86_400,
      boundDays: 30,
    });
    for (const skew of [121_000, -121_000, 335 * DAY]) {
      expect(pageExpiry({ localNowMs: NOW, serverTime: at(skew), receivedAtMs: NOW, days: 30 })).toEqual({
        ok: false,
        text: CLOCK_SKEW_TEXT,
      });
    }
    expect(pageExpiry({ localNowMs: NOW, serverTime: null, receivedAtMs: NOW, days: 30 }).ok).toBe(false);
    expect(pageExpiry({ localNowMs: NOW, serverTime: at(0), receivedAtMs: NOW, days: 31 }).ok).toBe(false);
  });

  it("the renew label follows the typed days", () => {
    const grant = { kind: "expiring" as const, delegation: delegation(), daysLeft: 3 };
    expect(actionLabelFor(grant, "10")).toBe("Renew for 10 days");
    expect(actionLabelFor({ kind: "none" }, "10")).toBe("Approve");
  });

  it("Add funds runs here only for an RPC origin the page's connect-src allows, exactly", () => {
    const require = createRequire(import.meta.url);
    const { CONNECT_ORIGINS } = require("../../../scripts/csp-policy.js") as { CONNECT_ORIGINS: string[] };
    for (const origin of STRICT_PAGE_RPC_ORIGINS) {
      expect(CONNECT_ORIGINS).toContain(origin);
      expect(origin).not.toContain("*");
    }
    expect(depositRunsHere("https://rpc.testnet.chain.robinhood.com/")).toBe(true);
    expect(depositRunsHere("https://rpc.testnet.chain.robinhood.com.evil.example/")).toBe(false);
    expect(depositRunsHere("https://mainnet.example/rpc")).toBe(false);
    expect(depositRunsHere(null)).toBe(false);
  });

  it("collectPages follows the cursor", async () => {
    const pages: Record<string, { items: number[]; pageInfo: { nextCursor: string | null; hasMore: boolean } }> = {
      start: { items: [1, 2], pageInfo: { nextCursor: "b", hasMore: true } },
      b: { items: [3], pageInfo: { nextCursor: null, hasMore: false } },
    };
    await expect(collectPages(async (cursor) => pages[cursor ?? "start"]!)).resolves.toEqual([1, 2, 3]);
  });
});

describe("fix round 2", () => {
  const plan = (serverOffsetMs: number, draft: CapsDraft = { ...DEFAULT_CAPS }) =>
    enablePaidPlan({
      parsed: parseEnablePaidCaps(draft, 6),
      serverTime: new Date(NOW + serverOffsetMs).toISOString(),
      receivedAtMs: NOW,
      localNowMs: NOW,
    });

  it("enablePaidPlan: the ceiling and the grant are the caps on the form; the expiry is local now + days", () => {
    expect(plan(30_000)).toEqual({
      ok: true,
      ceiling: { maxVoucherAmount: "500000", maxPerWindow: "5000000" },
      chosen: { maxVoucherAmount: "500000", maxPerWindow: "5000000" },
      expiry: { validUntil: NOW / 1000 + 30 * 86_400, maxDays: 30 },
      validUntil: new Date(NOW + 30 * DAY).toISOString(),
      boundDays: 30,
      nowSeconds: NOW / 1000,
    });
    expect(plan(0, { perCall: "1", perDay: "20", days: "7" })).toMatchObject({
      ok: true,
      ceiling: { maxVoucherAmount: "1000000", maxPerWindow: "20000000" },
      expiry: { validUntil: NOW / 1000 + 7 * 86_400 },
    });
  });

  it("enablePaidPlan: a server time 335 days ahead (or 121 s) signs nothing", () => {
    expect(plan(335 * DAY)).toEqual({ ok: false, problem: CLOCK_SKEW_TEXT });
    expect(plan(121_000)).toEqual({ ok: false, problem: CLOCK_SKEW_TEXT });
  });

  it("enablePaidPlan: invalid caps sign nothing, and the form says why", () => {
    expect(plan(0, { perCall: "6", perDay: "5", days: "30" })).toEqual({ ok: false, problem: null });
    expect(plan(0, { perCall: "0.5", perDay: "5", days: "31" })).toEqual({ ok: false, problem: null });
  });

  it("enablePaidReturnTo: exactly this page with its credential id, nothing else (no key in any URL)", () => {
    const back = "/agents/enable-paid?credential=00000000-0000-4000-8000-000000000001";
    expect(enablePaidReturnTo(back)).toBe(back);
    expect(enablePaidReturnHref("00000000-0000-4000-8000-000000000001")).toBe(back);
    expect(enablePaidReturnHref("a&b=c")).toBeNull();
    for (const bad of [
      null,
      "",
      `${back}#key=${KEY}`,
      `${back}&key=${KEY}`,
      `${back}&perDay=1000`,
      `/agents/enable-paid?key=${KEY}&credential=cred-1`,
      "/agents/enable-paid",
      "/agents/enable-paid?credential=",
      "/agents/enable-paid?credential=a%26b",
      "/agents/enable-paid/?credential=cred-1",
      "/funding",
      "//evil.example/agents/enable-paid?credential=cred-1",
      "https://evil.example/agents/enable-paid?credential=cred-1",
      "/agents/enable-paid/../../evil?credential=cred-1",
      "/%2F%2Fevil.example/agents/enable-paid?credential=cred-1",
      "javascript:alert(1)",
    ]) {
      expect(enablePaidReturnTo(bad)).toBeNull();
    }
  });

  it("the RPC list is one source, exact origins, inside the page's connect-src", () => {
    const require = createRequire(import.meta.url);
    const csp = require("../../../scripts/csp-policy.js") as { CONNECT_ORIGINS: string[]; STRICT_RPC_ORIGINS: string[] };
    expect(csp.STRICT_RPC_ORIGINS).toEqual([...STRICT_PAGE_RPC_ORIGINS]);
    for (const origin of STRICT_PAGE_RPC_ORIGINS) {
      expect(new URL(origin).origin).toBe(origin);
      expect(origin.startsWith("https://")).toBe(true);
      expect(csp.CONNECT_ORIGINS).toContain(origin);
    }
  });
});
