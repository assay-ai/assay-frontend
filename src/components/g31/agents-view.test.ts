import { describe, expect, it, vi } from "vitest";

import type { KeyRow } from "@/components/buyer-money/use-agents";
import type { EscrowDelegate } from "@/interfaces";

import { credentialRowView, withLabel } from "./agents-view";
import { revokeDialogCopy, revokedToast, runRevokeCredential, stopMode } from "./revoke-credential-dialog";

const EVM = "eip155:46630";
const ASSET = `${EVM}/erc20:0xDbbC`;
const DELEGATE = `${EVM}:0x76B98fD03eE16e2673532769891f1400b447d10C`;
const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const usdg = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });

const BUILTIN = {
  clientId: "https://mcp.example.test/oauth/clients/assay-mcp",
  name: "Assay app",
  registrableDomain: null,
  verified: false,
  paymentClient: true,
};
const THIRD_PARTY = {
  clientId: "https://claude.ai/oauth/mcp-client.json",
  name: "Claude Code",
  registrableDomain: "claude.ai",
  verified: true,
  paymentClient: false,
};

function key(patch: Partial<KeyRow> = {}): KeyRow {
  return {
    id: "k1",
    agentId: "a",
    name: "Assay app on this Mac",
    issuedVia: "OAUTH",
    oauthClient: BUILTIN,
    prefix: null,
    scopes: [],
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    delegateAccount: null,
    delegateBoundAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...patch,
  };
}

function grant(patch: Partial<EscrowDelegate> = {}): EscrowDelegate {
  return {
    delegate: DELEGATE,
    maxVoucherAmount: usdg("500000"),
    maxPerWindow: usdg("5000000"),
    spentInWindow: usdg("0"),
    validUntil: "2026-11-18T12:00:00.000Z",
    status: "ACTIVE",
    unsettled: { count: 0, amount: usdg("0"), largest: usdg("0"), windowNeeds: usdg("0"), redeemableUntil: null },
    ...patch,
  } as EscrowDelegate;
}

function view(row: KeyRow, delegates: EscrowDelegate[] | undefined = [], extra: Partial<Parameters<typeof credentialRowView>[1]> = {}) {
  return credentialRowView(row, { delegates, delegatesUnreadable: false, keys: [row], nowMs: NOW, ...extra });
}

describe("Agents & keys rows (spec §9.2)", () => {
  it("OAuth builtin row text", () => {
    const withKey = view(key({ delegateAccount: DELEGATE }), [grant()]);
    expect(withKey.source).toBe("Signed in from Assay app (assay-mcp)");
    expect(withKey.paymentLine).toBe("Payment key B447 D10C · on · $0.50 a call · $5 per 24 h · until Nov 18");
    expect(withKey.activeOnChain).toBe(true);

    const noKey = view(key());
    expect(noKey.source).toBe("Signed in from Assay app (assay-mcp)");
    expect(noKey.paymentLine).toBe("Payment key: none — free tools only");
    expect(noKey.activeOnChain).toBe(false);
  });

  it("third-party row says free tools only", () => {
    const row = view(key({ name: "Claude Code · Oct 19", oauthClient: THIRD_PARTY }));
    expect(row.source).toBe("Signed in from Claude Code (claude.ai) · free tools only");
    expect(row.paymentClient).toBe(false);
    // The source line already says it: no second payment line.
    expect(row.paymentLine).toBeNull();
    // A DCR client has no proven domain.
    expect(view(key({ oauthClient: { ...THIRD_PARTY, registrableDomain: null } })).source).toBe(
      "Signed in from Claude Code · free tools only",
    );
  });

  it("never says free tools only while a payment key is active on chain, or while that cannot be read", () => {
    const bound = key({ oauthClient: THIRD_PARTY, delegateAccount: DELEGATE });
    const active = view(bound, [grant()]);
    expect(active.source).toBe("Signed in from Claude Code (claude.ai)");
    expect(active.paymentLine).toContain("· on ·");
    expect(`${active.source} ${active.paymentLine}`).not.toContain("free tools only");

    const unread = view(bound, [], { delegates: undefined, delegatesUnreadable: true });
    expect(`${unread.source} ${unread.paymentLine}`).not.toContain("free tools only");
    expect(unread.paymentLine).toBe("Payment key: may still be active on chain (couldn't check)");

    const builtinPending = view(key({ delegateAccount: DELEGATE }), [], { delegates: undefined });
    expect(builtinPending.paymentLine).toBe("Payment key: may still be active on chain (couldn't check)");
  });

  it("reads the on-chain state from the chain list, never from the credential", () => {
    // Bound on the credential, but nothing authorised on chain.
    expect(view(key({ delegateAccount: DELEGATE }), []).paymentLine).toBe(
      "Payment key B447 D10C · not turned on — free tools only",
    );
    expect(view(key({ delegateAccount: DELEGATE }), [grant({ status: "EXPIRED", validUntil: "2026-10-01T00:00:00.000Z" })]).paymentLine).toBe(
      "Payment key B447 D10C · expired Oct 1 — free tools only",
    );
  });

  it("an API key row names its key", () => {
    const row = view(key({ issuedVia: "API_KEY", oauthClient: null, prefix: "assay_sk_live_ab12", name: "CI deploy" }));
    expect(row.source).toBe("API key assay_sk_live_ab12…");
    expect(row.paymentClient).toBe(true);
    expect(row.paymentLine).toBe("Payment key: none — free tools only");
  });

  it("an expired grant is not live, and its active key is offered Stop it", () => {
    const expired = key({ expiresAt: "2026-10-18T00:00:00.000Z", delegateAccount: DELEGATE });
    const row = view(expired, [grant()]);
    expect(row.live).toBe(false);
    expect(row.stopIt?.delegate).toBe(DELEGATE);
  });

  it("a revoked row whose key a live row holds is not offered Stop it (the live row owns it)", () => {
    const revoked = key({ id: "old", revokedAt: "2026-10-18T00:00:00.000Z", delegateAccount: DELEGATE });
    const live = key({ id: "new", delegateAccount: DELEGATE });
    const row = credentialRowView(revoked, { delegates: [grant()], delegatesUnreadable: false, keys: [revoked, live], nowMs: NOW });
    expect(row.stopIt).toBeNull();
  });

  it("Revoke's key state: active, unknown while the chain is pending or failed, none when proven or held by another live row", () => {
    expect(view(key({ delegateAccount: DELEGATE }), [grant()]).keyState).toBe("active");
    expect(view(key({ delegateAccount: DELEGATE }), []).keyState).toBe("none");
    expect(view(key()).keyState).toBe("none");
    expect(view(key({ delegateAccount: DELEGATE }), [], { delegates: undefined }).keyState).toBe("unknown");
    expect(view(key({ delegateAccount: DELEGATE }), [], { delegates: undefined, delegatesUnreadable: true }).keyState).toBe("unknown");
    const a = key({ id: "a", delegateAccount: DELEGATE });
    const b = key({ id: "b", delegateAccount: DELEGATE });
    expect(credentialRowView(a, { delegates: [grant()], delegatesUnreadable: false, keys: [a, b], nowMs: NOW }).keyState).toBe("none");
  });

  it("a revoked row with a bound key may still be active while the chain read is pending or failed", () => {
    const revoked = key({ revokedAt: "2026-10-18T00:00:00.000Z", delegateAccount: DELEGATE });
    for (const unreadable of [false, true]) {
      const row = view(revoked, [], { delegates: undefined, delegatesUnreadable: unreadable });
      expect(row.mayBeActive).toBe(true);
      expect(row.stopIt).toBeNull();
      expect(row.paymentLine).toBe("Payment key: may still be active on chain (couldn't check)");
    }
    // Once read: proven off, it is folded away like any ended row.
    expect(view(revoked, []).mayBeActive).toBe(false);
  });
});

describe("the Revoke dialog (spec F3)", () => {
  it("dialog checkbox default on only when key active", () => {
    const active = revokeDialogCopy({ name: "Assay app on this Mac", issuedVia: "OAUTH", keyState: "active" });
    expect(active.title).toBe("Revoke Assay app on this Mac?");
    expect(active.description).toBe("The app stops working at once and must sign in again.");
    expect(active.alsoStop).toEqual({ label: "Also stop its payment key on chain (one signature)", defaultChecked: true });
    expect(active.note).toBeNull();

    const none = revokeDialogCopy({ name: "Assay app on this Mac", issuedVia: "OAUTH", keyState: "none" });
    expect(none.alsoStop).toBeNull();

    // Chain unread: the key may still be active, so the checkbox is offered, on, with the note.
    const unknown = revokeDialogCopy({ name: "Assay app on this Mac", issuedVia: "OAUTH", keyState: "unknown" });
    expect(unknown.alsoStop).toEqual({ label: "Also stop its payment key on chain (one signature)", defaultChecked: true });
    expect(unknown.note).toContain("may still be active");
  });

  it("signs in the dialog only for a key active on chain with a known tighten delay; else hands off to the sheet", () => {
    expect(stopMode({ keyState: "active", alsoStop: true, tightenDelaySeconds: 3600 })).toBe("inline");
    expect(stopMode({ keyState: "active", alsoStop: true, tightenDelaySeconds: 0 })).toBe("sheet");
    expect(stopMode({ keyState: "active", alsoStop: true, tightenDelaySeconds: undefined })).toBe("sheet");
    expect(stopMode({ keyState: "unknown", alsoStop: true, tightenDelaySeconds: 3600 })).toBe("sheet");
    expect(stopMode({ keyState: "active", alsoStop: false, tightenDelaySeconds: 3600 })).toBe("none");
    expect(stopMode({ keyState: "none", alsoStop: true, tightenDelaySeconds: 3600 })).toBe("none");
  });

  it("the toast never says stopped alone while the key is, or may be, active", () => {
    expect(revokedToast("none", "untouched")).toBe("Revoked. It stopped working at once.");
    expect(revokedToast("active", "untouched")).toContain("still active on chain");
    expect(revokedToast("unknown", "untouched")).toContain("may still be active on chain");
    expect(revokedToast("unknown", "handoff")).toContain("sign to stop its payment key");
    expect(revokedToast("active", "stopped")).toContain("stopped on chain");
  });

  it("revokes first, then revoke-intent → wallet → revoke when ticked", async () => {
    const calls: string[] = [];
    const outcome = await runRevokeCredential({
      mode: "inline",
      revoke: async () => void calls.push("delete"),
      stopOnChain: async () => void calls.push("on-chain"),
    });
    expect(calls).toEqual(["delete", "on-chain"]);
    expect(outcome).toEqual({ revoked: true, chain: "stopped" });
  });

  it("keeps the credential revoked when the wallet step is declined or fails", async () => {
    const declined = new Error("User rejected");
    const outcome = await runRevokeCredential({
      mode: "inline",
      revoke: async () => undefined,
      stopOnChain: async () => {
        throw declined;
      },
    });
    expect(outcome).toEqual({ revoked: true, chain: "failed", error: declined });
  });

  it("does not touch the chain when unticked, and never asks the wallet when the revoke fails", async () => {
    const stop = vi.fn(async () => undefined);
    expect(await runRevokeCredential({ mode: "none", revoke: async () => undefined, stopOnChain: stop })).toEqual({
      revoked: true,
      chain: "untouched",
    });
    // The sheet signs, not the dialog.
    expect(await runRevokeCredential({ mode: "sheet", revoke: async () => undefined, stopOnChain: stop })).toEqual({
      revoked: true,
      chain: "handoff",
    });
    const down = new Error("down");
    expect(
      await runRevokeCredential({
        mode: "inline",
        revoke: async () => {
          throw down;
        },
        stopOnChain: stop,
      }),
    ).toEqual({ revoked: false, error: down });
    expect(stop).not.toHaveBeenCalled();
  });
});

describe("withLabel — a rename patched into the agents cache", () => {
  it("replaces one agent's label and leaves the rest", () => {
    const page = { items: [{ agentId: "a", label: "My agent" }, { agentId: "b", label: "other" }], pageInfo: { hasMore: false } };
    expect(withLabel(page, "a", "Research bot")).toEqual({
      items: [{ agentId: "a", label: "Research bot" }, { agentId: "b", label: "other" }],
      pageInfo: { hasMore: false },
    });
  });
  it("leaves anything that is not a page alone", () => {
    expect(withLabel(undefined, "a", "x")).toBeUndefined();
    expect(withLabel({ chainId: "eip155:1" }, "a", "x")).toEqual({ chainId: "eip155:1" });
  });
});
