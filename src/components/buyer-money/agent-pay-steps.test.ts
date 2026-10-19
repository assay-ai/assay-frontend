import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLOCK_SKEW_TEXT, pageExpiry } from "@/features/delegation/enable-paid";

const spies = vi.hoisted(() => ({
  createDelegateIntent: vi.fn(async (body: unknown) => ({ kind: "AUTHORIZE_DELEGATE", body })),
  submitRelayedDelegation: vi.fn(async (_intent: unknown, _signer: unknown, expected: unknown) => ({
    transactionHash: "0xfeed",
    expected,
  })),
  createEscrowLimitsIntent: vi.fn(async (body: unknown) => ({ kind: "SET_LIMITS", body })),
  runEscrowAction: vi.fn(async () => ({ kind: "relayed", relayed: { transactionHash: "0xbeef", escrow: null } })),
}));

vi.mock("@/services/delegation.service", () => ({
  createDelegateIntent: spies.createDelegateIntent,
  submitDelegate: vi.fn(),
  getEscrowUnsettled: vi.fn(),
}));
vi.mock("@/features/delegation/relayed-delegation", () => ({ submitRelayedDelegation: spies.submitRelayedDelegation }));
vi.mock("@/services/escrow.service", () => ({ createEscrowLimitsIntent: spies.createEscrowLimitsIntent }));
vi.mock("@/features/escrow/relayed-submission", () => ({ runEscrowAction: spies.runEscrowAction }));
vi.mock("@/features/escrow/after-set-limits", () => ({ applyLimitsSubmitted: vi.fn(async () => undefined) }));

import { agentPaySteps, type AgentPayStepsInput } from "./let-agent-pay-sheet";

const NOW = Date.parse("2026-10-19T10:00:00.000Z");
const DAY = 86_400;
const KEY = `eip155:46630:0x${"1".repeat(32)}1a2b9f3c`;

function money(): AgentPayStepsInput["money"] {
  return {
    signerState: { status: "ready", signer: { address: "0x2222222222222222222222222222222222222222" } },
    escrow: { escrowPda: "eip155:46630:0x3333333333333333333333333333333333333333" },
    chainId: "eip155:46630",
    chain: null,
    decimals: 6,
    ownerShort: null,
  } as unknown as AgentPayStepsInput["money"];
}

function steps(overrides: Partial<AgentPayStepsInput> = {}) {
  return agentPaySteps({
    money: money(),
    queryClient: new QueryClient(),
    agentName: "research-bot",
    delegateAccount: KEY,
    chosen: { maxVoucherAmount: "500000", maxPerWindow: "5000000" },
    form: { perCall: "0.50", perDay: "5", days: 30 },
    openingCaps: { perCall: "100000", perWindow: "900000000000" },
    nowSeconds: NOW / 1000,
    ...overrides,
  });
}

const report = () => undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const spy of Object.values(spies)) spy.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("agentPaySteps on the enable-paid page", () => {
  it("a server time 335 days ahead never signs 365 days: the page refuses, and the step refuses such an expiry", async () => {
    const skewed = pageExpiry({
      localNowMs: NOW,
      serverTime: new Date(NOW + 335 * DAY * 1000).toISOString(),
      receivedAtMs: NOW,
      days: 30,
    });
    expect(skewed).toEqual({ ok: false, text: CLOCK_SKEW_TEXT });

    const grant = steps({ expiry: { validUntil: NOW / 1000 + 365 * DAY, maxDays: 30 } })[1]!;
    await expect(grant.run({ report } as never)).rejects.toThrow(/more than 30 days/);
    expect(spies.createDelegateIntent).not.toHaveBeenCalled();
    expect(spies.submitRelayedDelegation).not.toHaveBeenCalled();
  });

  it("signs exactly the shown expiry: 30 days from this device's clock", async () => {
    const expiry = pageExpiry({ localNowMs: NOW, serverTime: new Date(NOW + 60_000).toISOString(), receivedAtMs: NOW, days: 30 });
    if (!expiry.ok) throw new Error(expiry.text);
    expect(expiry.validUntil).toBe(NOW / 1000 + 30 * DAY);
    const grant = steps({ expiry: { validUntil: expiry.validUntil, maxDays: 30 } })[1]!;
    await grant.run({ report } as never);
    expect(spies.createDelegateIntent).toHaveBeenCalledWith({
      delegate: `0x${"1".repeat(32)}1a2b9f3c`,
      maxVoucherAmount: "500000",
      maxPerWindow: "5000000",
      validUntil: String(NOW / 1000 + 30 * DAY),
    });
  });

  it("SetLimits signs the shown ceiling, not one derived from the API's escrow caps", async () => {
    const ceiling = { maxVoucherAmount: "500000", maxPerWindow: "5000000" };
    const caps = steps({ ceiling })[0]!;
    expect(caps.skip).toBe(false);
    await caps.run({ report } as never);
    expect(spies.createEscrowLimitsIntent).toHaveBeenCalledWith(ceiling);
    expect(spies.runEscrowAction).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      kind: "SET_LIMITS",
      ...ceiling,
    });
  });

  it("the sheet (no ceiling given) still raises each cap to fit and never lowers one", async () => {
    await steps()[0]!.run({ report } as never);
    expect(spies.createEscrowLimitsIntent).toHaveBeenCalledWith({
      maxVoucherAmount: "500000",
      maxPerWindow: "900000000000",
    });
  });
});
