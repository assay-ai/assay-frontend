import { describe, expect, it, vi } from "vitest";

import type { KeyRow } from "@/components/buyer-money/use-agents";
import type { EscrowDelegate } from "@/interfaces";

import { credentialRowView, withLabel } from "./agents-view";
import { revokeDialogCopy, runRevokeCredential } from "./revoke-credential-dialog";

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
    expect(unread.paymentLine).toBe("Payment key B447 D10C · could not be read from the chain");

    const builtinUnread = view(key({ delegateAccount: DELEGATE }), [], { delegates: undefined });
    expect(builtinUnread.paymentLine).toBe("Payment key B447 D10C · checking the chain…");
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

  it("Revoke offers the on-chain stop only for a key active on chain that no other live row holds", () => {
    expect(view(key({ delegateAccount: DELEGATE }), [grant()]).offerStopOnRevoke).toBe(true);
    expect(view(key({ delegateAccount: DELEGATE }), []).offerStopOnRevoke).toBe(false);
    expect(view(key({ delegateAccount: DELEGATE }), [], { delegates: undefined }).offerStopOnRevoke).toBe(false);
    const a = key({ id: "a", delegateAccount: DELEGATE });
    const b = key({ id: "b", delegateAccount: DELEGATE });
    expect(credentialRowView(a, { delegates: [grant()], delegatesUnreadable: false, keys: [a, b], nowMs: NOW }).offerStopOnRevoke).toBe(false);
  });
});

describe("the Revoke dialog (spec F3)", () => {
  it("dialog checkbox default on only when key active", () => {
    const active = revokeDialogCopy({ name: "Assay app on this Mac", issuedVia: "OAUTH", keyActiveOnChain: true });
    expect(active.title).toBe("Revoke Assay app on this Mac?");
    expect(active.description).toBe("The app stops working at once and must sign in again.");
    expect(active.alsoStop).toEqual({ label: "Also stop its payment key on chain (one signature)", defaultChecked: true });

    const none = revokeDialogCopy({ name: "Assay app on this Mac", issuedVia: "OAUTH", keyActiveOnChain: false });
    expect(none.alsoStop).toBeNull();
  });

  it("revokes first, then revoke-intent → wallet → revoke when ticked", async () => {
    const calls: string[] = [];
    const outcome = await runRevokeCredential({
      alsoStop: true,
      revoke: async () => void calls.push("delete"),
      stopOnChain: async () => void calls.push("on-chain"),
    });
    expect(calls).toEqual(["delete", "on-chain"]);
    expect(outcome).toEqual({ revoked: true, chain: "stopped" });
  });

  it("keeps the credential revoked when the wallet step is declined or fails", async () => {
    const declined = new Error("User rejected");
    const outcome = await runRevokeCredential({
      alsoStop: true,
      revoke: async () => undefined,
      stopOnChain: async () => {
        throw declined;
      },
    });
    expect(outcome).toEqual({ revoked: true, chain: "failed", error: declined });
  });

  it("does not touch the chain when unticked, and never asks the wallet when the revoke fails", async () => {
    const stop = vi.fn(async () => undefined);
    expect(await runRevokeCredential({ alsoStop: false, revoke: async () => undefined, stopOnChain: stop })).toEqual({
      revoked: true,
      chain: "untouched",
    });
    const down = new Error("down");
    expect(
      await runRevokeCredential({
        alsoStop: true,
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
