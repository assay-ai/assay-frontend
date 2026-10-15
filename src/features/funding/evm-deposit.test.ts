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
  broadcast: vi.fn(async () => `0x${"bb".repeat(32)}`),
  waitForSuccess: vi.fn(async () => undefined),
  encodeApprove: vi.fn(() => "0xapprove"),
  encodeDepositFor: vi.fn(() => "0xdepositFor"),
}));

import * as tx from "@/libs/chains/evm/deposit-transaction";

import { approveEvmDeposit, checkEvmDeposit, sendEvmDepositFor, signEvmDeposit } from "./evm-deposit";

const BUYER = "0x4924000000000000000000000000000000000d89";
const REQUIREMENTS = {
  namespace: "eip155",
  chainId: "eip155:46630",
  contract: "0x60aBdb81796322b1bA6674068a3861309a9f8D37",
  method: "depositFor(address,uint64)",
  spender: "0x60aBdb81796322b1bA6674068a3861309a9f8D37",
  buyer: BUYER,
  asset: "0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec",
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

describe("the two deposit steps, as the Add funds drawer runs them", () => {
  it("reports each broadcast hash before waiting for it", async () => {
    const { signer: s } = signer("external");
    const submitted: string[] = [];
    const check = await checkEvmDeposit({ signer: s, requirements: REQUIREMENTS, amountAtomic: 5_000_000n });
    expect(check.needsApprove).toBe(true);
    await approveEvmDeposit({
      signer: s,
      requirements: REQUIREMENTS,
      amountAtomic: 5_000_000n,
      nativeWei: check.nativeWei,
      onSubmitted: (hash) => submitted.push(hash),
    });
    const result = await sendEvmDepositFor({
      signer: s,
      requirements: REQUIREMENTS,
      amountAtomic: 5_000_000n,
      onSubmitted: (hash) => submitted.push(hash),
    });
    expect(submitted).toEqual([`0x${"aa".repeat(32)}`, `0x${"dd".repeat(32)}`]);
    expect(result).toEqual({ kind: "broadcast", transactionHash: `0x${"dd".repeat(32)}` });
  });

  it("broadcasts an embedded wallet's approve itself and reports its hash", async () => {
    const { signer: s } = signer("embedded");
    const submitted: string[] = [];
    await approveEvmDeposit({
      signer: s,
      requirements: REQUIREMENTS,
      amountAtomic: 5_000_000n,
      nativeWei: 10n ** 15n,
      onSubmitted: (hash) => submitted.push(hash),
    });
    expect(submitted).toEqual([`0x${"bb".repeat(32)}`]);
  });

  it("refuses a wallet that is not the buyer before any prompt", async () => {
    const { signer: s, raw } = signer("external");
    await expect(
      checkEvmDeposit({ signer: { ...s, address: "0x1111111111111111111111111111111111111111" } as Signer, requirements: REQUIREMENTS, amountAtomic: 5_000_000n }),
    ).rejects.toThrow(/connected wallet/);
    expect(raw.signAndSend).not.toHaveBeenCalled();
  });
});
