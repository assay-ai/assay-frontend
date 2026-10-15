import { describe, expect, it, vi } from "vitest";

import type { WalletStep } from "@/components/patterns/wallet-steps";

import { PROVIDER_PENDING_TX_MAX_AGE_MS, parseProviderPending, trackSubmissions } from "./pending-chain-tx";
import { simulatedSteps } from "./wallet-readiness";

const NOW = 1_800_000_000_000;

function tracker() {
  return { track: vi.fn(), resolve: vi.fn(), release: vi.fn() };
}

const input = { kind: "dispute" as const, chainId: "eip155:46630", idPrefix: "dispute:0xabc", label: () => "Dispute the Weather now penalty" };

describe("trackSubmissions", () => {
  it("remembers a submitted step at once and forgets it once it confirms", async () => {
    const t = tracker();
    const report = vi.fn();
    const step: WalletStep = {
      id: "dispute",
      label: "Dispute",
      cost: "gas",
      run: async ({ report: r }) => {
        r({ stage: "submitted", data: "0xhash", explorerUrl: "https://x/tx/0xhash" });
        expect(t.track).toHaveBeenCalledWith({
          id: "dispute:0xabc:dispute",
          kind: "dispute",
          label: "Dispute the Weather now penalty",
          chainId: "eip155:46630",
          hash: "0xhash",
          explorerUrl: "https://x/tx/0xhash",
          submittedAt: NOW,
        });
        return { data: "0xhash" };
      },
    };
    const [wrapped] = trackSubmissions([step], input, t, () => NOW);
    await expect(wrapped!.run({ results: [], report })).resolves.toEqual({ data: "0xhash" });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ stage: "submitted" }));
    expect(t.resolve).toHaveBeenCalledWith("dispute:0xabc:dispute");
    expect(t.release).not.toHaveBeenCalled();
  });

  it("hands a submitted step that then fails to the page list, and tracks nothing before submission", async () => {
    const t = tracker();
    const submittedThenFails: WalletStep = {
      id: "dispute",
      label: "Dispute",
      cost: "gas",
      run: async ({ report }) => {
        report({ stage: "submitted", data: "0xhash" });
        throw new Error("receipt timeout");
      },
    };
    const refusedBeforeSending: WalletStep = {
      id: "dispute",
      label: "Dispute",
      cost: "gas",
      run: async () => {
        throw new Error("Nothing was sent");
      },
    };
    await expect(trackSubmissions([submittedThenFails], input, t, () => NOW)[0]!.run({ results: [], report: () => undefined })).rejects.toThrow(
      /receipt timeout/,
    );
    expect(t.release).toHaveBeenCalledWith("dispute:0xabc:dispute");
    t.release.mockClear();
    t.track.mockClear();
    await expect(trackSubmissions([refusedBeforeSending], input, t)[0]!.run({ results: [], report: () => undefined })).rejects.toThrow();
    expect(t.track).not.toHaveBeenCalled();
    expect(t.release).not.toHaveBeenCalled();
  });
});

describe("parseProviderPending", () => {
  it("keeps well-formed recent entries and drops the rest", () => {
    const good = { id: "a", kind: "stake", label: "Stake $5", chainId: "eip155:46630", hash: "0x1", submittedAt: NOW - 1000 };
    const old = { ...good, id: "b", submittedAt: NOW - PROVIDER_PENDING_TX_MAX_AGE_MS - 1 };
    const buyer = { ...good, id: "c", kind: "deposit" };
    expect(parseProviderPending(JSON.stringify([good, old, buyer, 42]), NOW)).toEqual([good]);
    expect(parseProviderPending("not json", NOW)).toEqual([]);
  });
});

describe("simulatedSteps (demo only)", () => {
  it("keeps the step names and costs and never runs the real step", async () => {
    const real = vi.fn();
    const steps = simulatedSteps([{ id: "approve", label: "Approve", cost: "gas", skip: true, run: real }], 0);
    expect(steps[0]).toMatchObject({ id: "approve", label: "Approve", cost: "gas", skip: true });
    await steps[0]!.run({ results: [], report: () => undefined });
    expect(real).not.toHaveBeenCalled();
  });
});
