import { describe, expect, it } from "vitest";

import type { EscrowDelegate, Money } from "@/interfaces";

import { agentReadiness, type ReadinessCredential } from "./agent-readiness";
import { capsAreSet, capsSentence, capsToForm, keyGroups, parseCaps, presetDescription, presetFor } from "./caps";
import { getStartedStates, payStage, type GetStartedFacts } from "./get-started";
import { KEY_PLACEHOLDER, keyPlaceholder, mcpConfig } from "./mcp-config";
import { PENDING_TX_MAX_AGE_MS, parsePending, withPending, withoutPending, type PendingTx } from "./pending-tx";
import { nextUtcMidnight, nextUtcMonth, windowRefillAt } from "./refill";
import { isLowBalance, runwayDays, runwayLine } from "./runway";

const usd = (major: string): Money => {
  const [whole, fraction = ""] = major.split(".");
  return { amount: String(BigInt(`${whole}${fraction.padEnd(6, "0")}`)), asset: "eip155:1/erc20:0xa", decimals: 6 };
};

describe("caps", () => {
  it("recognises presets numerically and describes them", () => {
    expect(presetFor("1.00", "20")).toBe("standard");
    expect(presetFor("0.5", "5.0")).toBe("light");
    expect(presetFor("2", "20")).toBe("custom");
    expect(presetDescription({ perCall: "0.50", perDay: "5" })).toBe("$0.50 a call · $5 per 24 h");
  });

  it("says what the caps mean in one sentence", () => {
    expect(capsSentence("1", "20")).toBe(
      "Any one call can cost at most $1.00, and your agents together can spend at most $20.00 in any 24 hours.",
    );
    expect(capsSentence("", "20")).toBeNull();
  });

  it("refuses a per-call cap above the per-day cap", () => {
    const parsed = parseCaps("30", "20", 6);
    expect(parsed.ok).toBe(false);
    expect(parsed.perCall.error).toMatch(/whole day/);
    expect(parseCaps("1", "20", 6)).toMatchObject({ ok: true, perCall: { atomic: "1000000" }, perDay: { atomic: "20000000" } });
    expect(parseCaps("", "20", 6).perCall.error).toBe("Enter an amount.");
  });

  it("treats zero caps as not set", () => {
    expect(capsAreSet({ maxVoucherAmount: usd("0"), maxPerWindow: usd("20") })).toBe(false);
    expect(capsAreSet({ maxVoucherAmount: usd("1"), maxPerWindow: usd("20") })).toBe(true);
    expect(capsToForm({ maxVoucherAmount: usd("1"), maxPerWindow: usd("20") })).toEqual({ perCall: "1", perDay: "20" });
    expect(capsToForm(null)).toBeNull();
  });
});

describe("refill", () => {
  const now = Date.parse("2026-10-16T10:00:00Z");
  it("ends the rolling window 24 h after it started, or says it is full", () => {
    expect(windowRefillAt("2026-10-16T08:00:00Z", 86400, now)).toBe("2026-10-17T08:00:00.000Z");
    expect(windowRefillAt("2026-10-14T08:00:00Z", 86400, now)).toBeNull();
    expect(windowRefillAt(null, 86400, now)).toBeNull();
  });
  it("finds the next UTC day and month", () => {
    expect(nextUtcMidnight(now)).toBe("2026-10-17T00:00:00.000Z");
    expect(nextUtcMonth(Date.parse("2026-12-31T23:00:00Z"))).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("runway", () => {
  it("divides the balance by the average day of the last week", () => {
    expect(runwayDays(usd("60"), usd("70"))).toBe(6);
    expect(runwayLine(6)).toBe("At this week's rate, your balance lasts about 6 days.");
    expect(runwayLine(1.5)).toBe("At this week's rate, your balance lasts about 1 day.");
    expect(runwayLine(0.4)).toMatch(/within a day/);
    expect(runwayLine(400)).toMatch(/more than two months/);
  });
  it("says nothing without spend or balance", () => {
    expect(runwayDays(usd("60"), usd("0"))).toBeNull();
    expect(runwayDays(null, usd("10"))).toBeNull();
    expect(runwayLine(null)).toBeNull();
  });
  it("calls a balance under $5 low", () => {
    expect(isLowBalance(usd("4.99"))).toBe(true);
    expect(isLowBalance(usd("5"))).toBe(false);
    expect(isLowBalance(null)).toBe(false);
  });
});

describe("mcp config", () => {
  const url = "https://mcp.example/mcp";
  it("wraps the remote server in mcp-remote for Claude Desktop", () => {
    const parsed = JSON.parse(mcpConfig("claude-desktop", { url, token: "assay_live_sk1" }));
    expect(parsed.mcpServers.assay.command).toBe("npx");
    expect(parsed.mcpServers.assay.args).toContain(url);
    expect(parsed.mcpServers.assay.env.ASSAY_AUTH).toBe("Bearer assay_live_sk1");
  });
  it("gives Cursor and other clients the URL and header, with a placeholder when the key is not on screen", () => {
    expect(JSON.parse(mcpConfig("cursor", { url, token: "k" })).mcpServers.assay).toEqual({
      url,
      headers: { Authorization: "Bearer k" },
    });
    expect(mcpConfig("other", { url, token: null })).toContain(KEY_PLACEHOLDER);
    // A known key is named by its prefix, never a bare placeholder.
    const named = mcpConfig("cursor", { url, token: null, keyPrefix: "assay_live_ab12…" });
    expect(named).toContain("assay_live_ab12…REST_OF_YOUR_KEY");
    expect(named).not.toContain(KEY_PLACEHOLDER);
    expect(keyPlaceholder(null)).toBe(KEY_PLACEHOLDER);
  });
});

describe("agent readiness", () => {
  const now = Date.parse("2026-10-16T10:00:00Z");
  const evm = "eip155:46630:0xabc";
  const key = (over: Partial<ReadinessCredential> = {}): ReadinessCredential => ({
    id: "c1",
    name: "runner",
    revokedAt: null,
    lastUsedAt: null,
    delegateAccount: null,
    ...over,
  });
  const escrow = {
    exists: true,
    maxVoucherAmount: usd("1"),
    maxPerWindow: usd("20"),
    withdrawRequested: usd("0"),
  };
  const grant = (over: Partial<EscrowDelegate> = {}): EscrowDelegate => ({
    delegate: "eip155:46630:0xdel",
    maxVoucherAmount: usd("1"),
    maxPerWindow: usd("10"),
    spentInWindow: usd("2"),
    validUntil: "2026-11-16T00:00:00Z",
    status: "ACTIVE",
    ...over,
  });

  it("walks the setup states in order", () => {
    expect(agentReadiness({ agentAccount: evm, credentials: [], delegates: [], escrow, paused: false }, now).status).toBe("no-key");
    expect(
      agentReadiness({ agentAccount: evm, credentials: [key({ revokedAt: "2026-10-01T00:00:00Z" })], delegates: [], escrow, paused: false }, now)
        .status,
    ).toBe("revoked");
    expect(agentReadiness({ agentAccount: evm, credentials: [key()], delegates: [], escrow: { ...escrow, exists: false }, paused: false }, now).next).toBe(
      "funds",
    );
    expect(
      agentReadiness({ agentAccount: evm, credentials: [key()], delegates: [], escrow: { ...escrow, maxVoucherAmount: usd("0") }, paused: false }, now)
        .status,
    ).toBe("caps-not-set");
    expect(agentReadiness({ agentAccount: evm, credentials: [key()], delegates: [], escrow, paused: false }, now).next).toBe("bind");
    const bound = key({ delegateAccount: "eip155:46630:0xDEL" });
    expect(agentReadiness({ agentAccount: evm, credentials: [bound], delegates: [], escrow, paused: false }, now).next).toBe("authorise");
    expect(agentReadiness({ agentAccount: evm, credentials: [bound], delegates: [grant()], escrow, paused: false }, now).status).toBe("ready");
    expect(
      agentReadiness({ agentAccount: evm, credentials: [{ ...bound, lastUsedAt: "2026-10-16T09:58:00Z" }], delegates: [grant()], escrow, paused: false }, now)
        .status,
    ).toBe("paying");
  });

  it("puts a stop ahead of everything else", () => {
    const bound = key({ delegateAccount: "eip155:46630:0xdel" });
    expect(agentReadiness({ agentAccount: evm, credentials: [bound], delegates: [grant()], escrow, paused: true }, now).status).toBe("paused");
    expect(
      agentReadiness({ agentAccount: evm, credentials: [bound], delegates: [grant()], escrow: { ...escrow, withdrawRequested: usd("5") }, paused: false }, now)
        .status,
    ).toBe("withdrawal-pending");
    const spent = agentReadiness(
      { agentAccount: evm, credentials: [bound], delegates: [grant({ spentInWindow: usd("10") })], escrow, paused: false },
      now,
    );
    expect(spent.status).toBe("cap-reached");
    expect(spent.sentence).toMatch(/used up/);
  });
});

describe("agent readiness when the escrow is unknown or empty", () => {
  it("never claims 'add funds' for an escrow it could not read", () => {
    const r = agentReadiness({ agentAccount: "eip155:1:0xa", credentials: [{ id: "c", name: "k", revokedAt: null, lastUsedAt: null }], delegates: [], escrow: undefined, escrowUnreadable: true, paused: false });
    expect(r.status).toBe("checking");
    expect(r.sentence).toMatch(/could not read/);
  });
  it("says an empty escrow cannot pay", () => {
    const r = agentReadiness({
      agentAccount: "eip155:1:0xa",
      credentials: [{ id: "c", name: "k", revokedAt: null, lastUsedAt: null, delegateAccount: "eip155:1:0xd" }],
      delegates: [{ delegate: "eip155:1:0xd", maxVoucherAmount: usd("1"), maxPerWindow: usd("10"), spentInWindow: usd("0"), validUntil: "2099-01-01T00:00:00Z", status: "ACTIVE" }],
      escrow: { exists: true, maxVoucherAmount: usd("1"), maxPerWindow: usd("20"), withdrawRequested: usd("0"), balance: usd("0") },
      paused: false,
    });
    expect(r.next).toBe("funds");
    expect(r.sentence).toMatch(/empty/);
  });
});

describe("get started", () => {
  const none: GetStartedFacts = {
    hasLiveKey: false,
    firstCallSeen: false,
    hasFunds: false,
    escrowExists: false,
    capsSet: false,
    keyBound: false,
    grantActive: false,
    needsDelegation: true,
  };
  it("starts at the key, with the call and pay steps blocked", () => {
    expect(getStartedStates(none)).toEqual({ key: "current", call: "blocked", funds: "todo", pay: "blocked" });
  });
  it("moves on as the data arrives", () => {
    expect(getStartedStates({ ...none, hasLiveKey: true })).toMatchObject({ key: "done", call: "current" });
    expect(getStartedStates({ ...none, hasLiveKey: true, firstCallSeen: true })).toMatchObject({ funds: "current", pay: "blocked" });
    expect(
      getStartedStates({ ...none, hasLiveKey: true, firstCallSeen: true, hasFunds: true, escrowExists: true }),
    ).toMatchObject({ funds: "done", pay: "current" });
    expect(
      getStartedStates({
        ...none,
        hasLiveKey: true,
        firstCallSeen: true,
        hasFunds: true,
        escrowExists: true,
        capsSet: true,
        keyBound: true,
        grantActive: true,
      }),
    ).toEqual({ key: "done", call: "done", funds: "done", pay: "done" });
  });
  it("finishes after the first call on a free-calls-only chain (Solana): no deposit or paying possible there", () => {
    const solana = { ...none, freeOnly: true };
    expect(getStartedStates({ ...solana, hasLiveKey: true })).toEqual({
      key: "done",
      call: "current",
      funds: "done",
      pay: "done",
    });
    expect(getStartedStates({ ...solana, hasLiveKey: true, firstCallSeen: true })).toEqual({
      key: "done",
      call: "done",
      funds: "done",
      pay: "done",
    });
  });
  it("orders the parts of step 4", () => {
    expect(payStage({ capsSet: false, keyBound: true, grantActive: false, needsDelegation: true })).toBe("caps");
    expect(payStage({ capsSet: true, keyBound: false, grantActive: false, needsDelegation: true })).toBe("bind");
    expect(payStage({ capsSet: true, keyBound: true, grantActive: false, needsDelegation: true })).toBe("authorise");
    expect(payStage({ capsSet: true, keyBound: false, grantActive: false, needsDelegation: false })).toBe("done");
  });
});

describe("pending transactions", () => {
  const tx = (id: string, submittedAt: number): PendingTx => ({
    id,
    kind: "claim",
    label: "Claim $5.00",
    chainId: "eip155:1",
    hash: "0x1",
    submittedAt,
  });
  it("survives a round trip and drops old or malformed entries", () => {
    const now = 1_000_000_000;
    const raw = JSON.stringify([tx("a", now - 1000), tx("b", now - PENDING_TX_MAX_AGE_MS - 1), { id: 3 }]);
    expect(parsePending(raw, now).map((t) => t.id)).toEqual(["a"]);
    expect(parsePending("not json", now)).toEqual([]);
    expect(parsePending(null, now)).toEqual([]);
  });
  it("replaces an entry with the same id and removes by id", () => {
    const list = withPending([tx("a", 1)], { ...tx("a", 2), hash: "0x2" });
    expect(list).toHaveLength(1);
    expect(list[0]!.hash).toBe("0x2");
    expect(withoutPending(list, "a")).toEqual([]);
  });
});

describe("keyGroups", () => {
  it("splits an address into groups of four for an eye check", () => {
    expect(keyGroups("eip155:46630:0x18ab00000000000000000000000000000000729f")).toEqual([
      "0x18ab",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "0000",
      "729f",
    ]);
  });
});
