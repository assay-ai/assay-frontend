import { describe, expect, it, vi } from "vitest";

import { sendFromInjectedWallet } from "./injected-send";

const HASH = `0x${"ab".repeat(32)}`;
const FROM = "0x4924000000000000000000000000000000000d89";
const TO = "0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec";

function fakeWallet(answer: unknown = HASH) {
  const calls: string[] = [];
  const request = vi.fn(async (args: { method: string; params?: unknown[] }) => {
    calls.push(args.method);
    return answer;
  });
  const switchChain = vi.fn(async (id: number) => {
    calls.push(`switchChain:${id}`);
  });
  return { provider: { request }, switchChain, calls, request };
}

describe("sendFromInjectedWallet", () => {
  it("moves the wallet onto the transaction's chain BEFORE asking it to send", async () => {
    const wallet = fakeWallet();

    await sendFromInjectedWallet({
      provider: wallet.provider,
      switchChain: wallet.switchChain,
      chainId: "eip155:46630",
      from: FROM,
      to: TO,
      data: "0x095ea7b3",
    });

    // A wallet left on mainnet would broadcast the approve THERE.
    expect(wallet.calls).toEqual(["switchChain:46630", "eth_sendTransaction"]);
  });

  it("sends exactly from, to, data and zero value — the wallet fills gas and nonce itself", async () => {
    const wallet = fakeWallet();

    const hash = await sendFromInjectedWallet({
      provider: wallet.provider,
      switchChain: wallet.switchChain,
      chainId: "eip155:46630",
      from: FROM,
      to: TO,
      data: "0x095ea7b3",
    });

    expect(hash).toBe(HASH);
    expect(wallet.request).toHaveBeenCalledWith({
      method: "eth_sendTransaction",
      params: [{ from: FROM, to: TO, data: "0x095ea7b3", value: "0x0" }],
    });
  });

  it("refuses an answer that is not a transaction hash rather than passing it on", async () => {
    const wallet = fakeWallet({ not: "a hash" });

    await expect(
      sendFromInjectedWallet({
        provider: wallet.provider,
        switchChain: wallet.switchChain,
        chainId: "eip155:46630",
        from: FROM,
        to: TO,
        data: "0x",
      }),
    ).rejects.toThrow(/transaction hash/);
  });

  it("refuses a non-eip155 chain before touching the wallet", async () => {
    const wallet = fakeWallet();

    await expect(
      sendFromInjectedWallet({
        provider: wallet.provider,
        switchChain: wallet.switchChain,
        chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
        from: FROM,
        to: TO,
        data: "0x",
      }),
    ).rejects.toThrow(/eip155/);
    expect(wallet.calls).toEqual([]);
  });
});
