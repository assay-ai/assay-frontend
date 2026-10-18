import { describe, expect, it } from "vitest";

import type { EscrowDelegate, Money } from "@/interfaces";

import { agentReadiness, type ReadinessCredential } from "./agent-readiness";
import { capsAreSet, capsSentence, capsSuccessText, capsToForm, keyGroups, parseCaps, presetDescription, presetFor } from "./caps";
import { firstCallPrompt, getStartedComplete, getStartedStates, payByInvitation, payStage, stepOptional, type GetStartedFacts } from "./get-started";
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
    const parsed = JSON.parse(mcpConfig("claude-desktop", { url, token: "assay_sk_live_sk1" }));
    expect(parsed.mcpServers.assay.command).toBe("npx");
    expect(parsed.mcpServers.assay.args).toContain(url);
    expect(parsed.mcpServers.assay.env.ASSAY_AUTH).toBe("Bearer assay_sk_live_sk1");
  });
  it("gives Cursor and other clients the URL and header, with a placeholder when the key is not on screen", () => {
    expect(JSON.parse(mcpConfig("cursor", { url, token: "k" })).mcpServers.assay).toEqual({
      url,
      headers: { Authorization: "Bearer k" },
    });
    expect(mcpConfig("other", { url, token: null })).toContain(KEY_PLACEHOLDER);
    // A known key is named by its prefix, never a bare placeholder.
    const named = mcpConfig("cursor", { url, token: null, keyPrefix: "assay_sk_live_ab12…" });
    expect(named).toContain("assay_sk_live_ab12…REST_OF_YOUR_KEY");
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

  it("says up front that a free-calls-only chain needs no paying step (Solana)", () => {
    const r = agentReadiness(
      { agentAccount: "solana:devnet:abc", credentials: [key()], delegates: [], escrow: { ...escrow, exists: false }, paused: false, freeOnlyChain: "Solana Devnet" },
      now,
    );
    expect(r.next).toBeNull();
    expect(r.sentence).toBe("Free calls only: Solana Devnet serves free calls only, so this agent makes free calls there and pays for none.");
    // A key is still needed first.
    expect(agentReadiness({ agentAccount: evm, credentials: [], delegates: [], escrow, paused: false, freeOnlyChain: "Solana" }, now).next).toBe("key");
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

  it("does not say paying while a payment is owed (debt pauses paid calls)", () => {
    const bound = { ...key({ delegateAccount: "eip155:46630:0xdel" }), lastUsedAt: "2026-10-16T09:58:00Z" };
    const r = agentReadiness({ agentAccount: evm, credentials: [bound], delegates: [grant()], escrow, paused: false, debtOwed: true }, now);
    expect(r.status).toBe("owed");
    expect(r.sentence).toMatch(/^Paid calls are paused until you settle/);
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
  it("starts at the key, with the call step blocked and paying by invitation (D14)", () => {
    expect(getStartedStates(none)).toEqual({ key: "current", call: "blocked", funds: "todo", pay: "todo" });
    expect(payByInvitation(none)).toBe(true);
  });
  it("blocks paying until the escrow exists once the payment key is bound", () => {
    expect(getStartedStates({ ...none, keyBound: true })).toMatchObject({ pay: "blocked" });
  });
  it("moves on as the data arrives", () => {
    expect(getStartedStates({ ...none, hasLiveKey: true })).toMatchObject({ key: "done", call: "current" });
    expect(getStartedStates({ ...none, hasLiveKey: true, firstCallSeen: true, keyBound: true })).toMatchObject({ funds: "current", pay: "blocked" });
    expect(
      getStartedStates({ ...none, hasLiveKey: true, firstCallSeen: true, hasFunds: true, escrowExists: true, keyBound: true }),
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
  it("does not ask for a deposit while paying is by invitation: funds is optional too (review M1)", () => {
    const freeCalls = { ...none, hasLiveKey: true, firstCallSeen: true };
    expect(getStartedStates(freeCalls)).toEqual({ key: "done", call: "done", funds: "todo", pay: "todo" });
    expect(getStartedComplete(freeCalls)).toBe(true);
    expect(stepOptional(freeCalls, "funds")).toBe(true);
    expect(stepOptional(freeCalls, "pay")).toBe(true);
    expect(stepOptional({ ...freeCalls, keyBound: true }, "funds")).toBe(false);
    // The invited path: funds counts again once the payment key is bound.
    expect(getStartedStates({ ...freeCalls, keyBound: true }).funds).toBe("current");
    expect(getStartedComplete({ ...freeCalls, keyBound: true })).toBe(false);
  });
  it("does not count paying by invitation as unfinished (D14)", () => {
    const freeDone = { ...none, hasLiveKey: true, firstCallSeen: true, hasFunds: true, escrowExists: true };
    expect(payByInvitation(freeDone)).toBe(true);
    expect(getStartedStates(freeDone).pay).toBe("todo");
    expect(getStartedComplete(freeDone)).toBe(true);
    // No deposit needed either while paying is by invitation (review M1).
    expect(getStartedComplete({ ...freeDone, hasFunds: false, escrowExists: false })).toBe(true);
    expect(getStartedComplete({ ...freeDone, firstCallSeen: false })).toBe(false);
  });
  it("counts paying once the payment key is bound: the invited path", () => {
    const bound = { ...none, hasLiveKey: true, firstCallSeen: true, hasFunds: true, escrowExists: true, keyBound: true };
    expect(payByInvitation(bound)).toBe(false);
    expect(getStartedComplete(bound)).toBe(false);
    expect(getStartedComplete({ ...bound, capsSet: true, grantActive: true })).toBe(true);
  });
  it("never applies the invitation where no payment key is needed", () => {
    expect(payByInvitation({ ...none, needsDelegation: false })).toBe(false);
    expect(payByInvitation({ ...none, freeOnly: true })).toBe(false);
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

describe("capsSuccessText", () => {
  const now = { maxVoucherAmount: "1000000", maxPerWindow: "20000000" };
  it("promises no pause for a raise", () => {
    expect(capsSuccessText(now, { ...now, maxPerWindow: "30000000" }, 0)).toBe("It applies from the next payment.");
    expect(capsSuccessText(null, now, undefined)).toBe("It applies from the next payment.");
  });
  it("says a lowering pauses payments only without the tighten delay", () => {
    const lower = { ...now, maxVoucherAmount: "500000" };
    expect(capsSuccessText(now, lower, 0)).toMatch(/about 30 seconds/);
    const delayed = capsSuccessText(now, lower, 3600);
    expect(delayed).not.toMatch(/30 seconds/);
    expect(delayed).toMatch(/keep the old ones for 1 hour/);
  });
});

describe("step 2's example prompt", () => {
  const mcp = (tool: { name: string }) => (/^[a-z][a-z0-9_-]+$/.test(tool.name) ? tool.name : null);
  it("names a reachable free tool, FREE before free calls a day", () => {
    const tools = [
      { name: "search_web", pricingMode: "PAID", routable: true },
      { name: "get_quote", pricingMode: "FREEMIUM", routable: true, freeCallsPerDay: 20 },
      { name: "get_weather", pricingMode: "FREE", routable: true },
    ];
    expect(firstCallPrompt(tools, mcp)).toContain("“use the get_weather tool from Assay”");
    expect(firstCallPrompt(tools.slice(0, 2), mcp)).toContain("get_quote");
  });
  it("never names a tool the agent cannot reach or would pay for", () => {
    const tools = [
      { name: "get_weather", pricingMode: "FREE", routable: false },
      { name: "search_web", pricingMode: "PAID", routable: true },
    ];
    const prompt = firstCallPrompt(tools, mcp);
    expect(prompt).not.toContain("get_weather");
    expect(prompt).not.toContain("search_web");
  });
});
