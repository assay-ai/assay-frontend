import { describe, expect, it } from "vitest";

import type { EscrowDelegate } from "@/interfaces";

import { agentReadiness, type ReadinessCredential } from "./agent-readiness";

const usd = (amount: string) => ({ amount: String(Math.round(Number(amount) * 1e6)), decimals: 6, asset: "usd" }) as never;
const now = Date.parse("2026-10-16T10:00:00Z");
const evm = "eip155:46630:0xabc";
const escrow = { exists: true, maxVoucherAmount: usd("1"), maxPerWindow: usd("20"), withdrawRequested: usd("0") };
const key = (over: Partial<ReadinessCredential> = {}): ReadinessCredential => ({
  id: "c1",
  name: "runner",
  revokedAt: null,
  lastUsedAt: null,
  delegateAccount: null,
  ...over,
});

describe("agent readiness while its data loads", () => {
  it("is loading, never 'No key', while the keys are not read yet", () => {
    const r = agentReadiness({ agentAccount: evm, credentials: undefined, delegates: [], escrow, paused: false }, now);
    expect(r.loading).toBe(true);
    expect(r.status).not.toBe("no-key");
    expect(r.sentence).not.toMatch(/no key/i);
    expect(r.next).toBeNull();
  });

  it("is loading while a bound key's pay permission is not read yet", () => {
    const bound = key({ delegateAccount: "eip155:46630:0xdel" });
    const r = agentReadiness({ agentAccount: evm, credentials: [bound], delegates: undefined, escrow, paused: false }, now);
    expect(r.loading).toBe(true);
    expect(r.next).toBeNull();
  });

  it("says 'No key' only once the keys are read and there are none", () => {
    const r = agentReadiness({ agentAccount: evm, credentials: [], delegates: [], escrow, paused: false }, now);
    expect(r.loading).toBe(false);
    expect(r.status).toBe("no-key");
  });

  it("states the paid path as an invitation when the agent has no payment key (D14)", () => {
    const r = agentReadiness({ agentAccount: evm, credentials: [key()], delegates: [] as EscrowDelegate[], escrow, paused: false }, now);
    expect(r.next).toBe("bind");
    expect(r.status).toBe("ready");
    expect(r.sentence).toBe("Free calls work. Paid calls are by invitation during testnet.");
  });
});
