import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Signer } from "@/hooks/useSigner";
import type { EvmDepositRequirements } from "@/services/funding.service";

vi.mock("@/libs/chains/evm/deposit-transaction", () => ({
  readDepositReadiness: vi.fn(),
  fillTransaction: vi.fn(async (tx: object) => ({
    ...tx,
    namespace: "eip155",
    kind: "transaction",
    value: "0",
    nonce: "1",
    gasLimit: "100000",
    maxFeePerGas: "1",
    maxPriorityFeePerGas: "1",
  })),
  maxGasCostWei: vi.fn(() => 1n),
  broadcastAndWait: vi.fn(),
  waitForSuccess: vi.fn(async () => undefined),
  encodeApprove: vi.fn(() => "0xapprove"),
  encodeDepositFor: vi.fn(() => "0xdepositFor"),
}));

import * as tx from "@/libs/chains/evm/deposit-transaction";

import { signEvmDeposit } from "./evm-deposit";

const BUYER = "0x4924000000000000000000000000000000000d89";
const REQUIREMENTS = {
  namespace: "eip155",
  chainId: "eip155:46630",
  contract: "0x1D2625efD87c2fc10b8563f3F0890072845Fcf41",
  method: "depositFor(address,uint64)",
  spender: "0x1D2625efD87c2fc10b8563f3F0890072845Fcf41",
  buyer: BUYER,
  asset: "0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3",
  amount: "5000000",
  decimals: 6,
  plainTransferCreditsNobody: true,
} as EvmDepositRequirements;

function signer(kind: "embedded" | "external") {
  const sent: string[] = [];
  const s = {
    address: BUYER,
    kind,
    chainId: "eip155:46630",
    signMessage: vi.fn(),
    signTypedData: vi.fn(),
    signTransaction: vi.fn(async () => ({
      namespace: "eip155",
      chainId: "eip155:46630",
      rawTransaction: "0xsigned",
    })),
    signAndSend: vi.fn(async (t: { data: string }) => {
      sent.push(t.data);
      return t.data === "0xapprove" ? `0x${"aa".repeat(32)}` : `0x${"dd".repeat(32)}`;
    }),
  };
  return { signer: s as unknown as Signer, sent, raw: s };
}

beforeEach(() => {
  vi.mocked(tx.readDepositReadiness).mockResolvedValue({
    tokenAtomic: 10_000_000n,
    nativeWei: 10n ** 15n,
    allowanceAtomic: 0n,
  } as never);
});

describe("signEvmDeposit with an injected (external) wallet", () => {
  it("lets the wallet SEND approve then depositFor, and returns the depositFor hash", async () => {
    const { signer: s, sent, raw } = signer("external");

    const result = await signEvmDeposit({
      signer: s,
      requirements: REQUIREMENTS,
      amountAtomic: 5_000_000n,
    });

    expect(sent).toEqual(["0xapprove", "0xdepositFor"]);
    expect(raw.signTransaction).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "broadcast", transactionHash: `0x${"dd".repeat(32)}` });
  });

  it("waits for the approve to land before asking for depositFor, and for depositFor too", async () => {
    const { signer: s } = signer("external");

    await signEvmDeposit({ signer: s, requirements: REQUIREMENTS, amountAtomic: 5_000_000n });

    expect(tx.waitForSuccess).toHaveBeenNthCalledWith(1, "eip155:46630", `0x${"aa".repeat(32)}`);
    expect(tx.waitForSuccess).toHaveBeenNthCalledWith(2, "eip155:46630", `0x${"dd".repeat(32)}`);
  });

  it("skips the approve when the allowance already covers the amount", async () => {
    vi.mocked(tx.readDepositReadiness).mockResolvedValue({
      tokenAtomic: 10_000_000n,
      nativeWei: 10n ** 15n,
      allowanceAtomic: 5_000_000n,
    } as never);
    const { signer: s, sent } = signer("external");

    await signEvmDeposit({ signer: s, requirements: REQUIREMENTS, amountAtomic: 5_000_000n });

    expect(sent).toEqual(["0xdepositFor"]);
  });
});

describe("signEvmDeposit with the embedded wallet — unchanged", () => {
  it("still signs depositFor UNSENT for the facilitator", async () => {
    const { signer: s, raw } = signer("embedded");
    vi.mocked(tx.readDepositReadiness).mockResolvedValue({
      tokenAtomic: 10_000_000n,
      nativeWei: 10n ** 15n,
      allowanceAtomic: 5_000_000n,
    } as never);

    const result = await signEvmDeposit({
      signer: s,
      requirements: REQUIREMENTS,
      amountAtomic: 5_000_000n,
    });

    expect(result).toEqual({ kind: "signed", rawTransaction: "0xsigned" });
    expect(raw.signAndSend).not.toHaveBeenCalled();
  });
});

/* Frontend review 2026-10-15, F1: the token, spender and escrow are the API's, so they are pinned. */
describe("signEvmDeposit refuses a deposit aimed anywhere but the pinned token and escrow", () => {
  const ATTACKER = "0x000000000000000000000000000000000000dEaD";

  it.each([
    ["spender", { spender: ATTACKER }],
    ["contract", { contract: ATTACKER }],
    ["asset", { asset: ATTACKER }],
  ])("refuses another %s, before anything is read or signed", async (_field, change) => {
    const { signer: s, raw } = signer("external");
    vi.mocked(tx.readDepositReadiness).mockClear();

    await expect(
      signEvmDeposit({ signer: s, requirements: { ...REQUIREMENTS, ...change }, amountAtomic: 5_000_000n }),
    ).rejects.toThrow(/another token or escrow/);
    expect(tx.readDepositReadiness).not.toHaveBeenCalled();
    expect(raw.signAndSend).not.toHaveBeenCalled();
  });

  it("refuses a chain with no pinned contracts", async () => {
    const { signer: s, raw } = signer("external");
    await expect(
      signEvmDeposit({ signer: s, requirements: { ...REQUIREMENTS, chainId: "eip155:1" }, amountAtomic: 5_000_000n }),
    ).rejects.toThrow(/no pinned contracts/);
    expect(raw.signAndSend).not.toHaveBeenCalled();
  });
});
