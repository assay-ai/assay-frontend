import { beforeEach, describe, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({ unstake: vi.fn(), withdraw: vi.fn() }));

vi.mock("@/services/provider-stake.service", () => ({
  createOpenStakeIntent: vi.fn(),
  createStakeDepositIntent: vi.fn(),
  createUnstakeIntent: services.unstake,
  createStakeWithdrawIntent: services.withdraw,
}));
vi.mock("@/libs/chains/evm/deposit-transaction", () => ({
  broadcast: vi.fn(),
  encodeApprove: vi.fn(),
  fillTransaction: vi.fn(),
  readDepositReadiness: vi.fn(),
  waitForSuccess: vi.fn(async () => undefined),
}));

import type { Signer } from "@/hooks/useSigner";
import type { StakeIntent } from "@/interfaces/provider-stake";
import { encodeCall } from "@/libs/chains/evm/calldata-fixtures";
import { ROBINHOOD_TESTNET_STAKE } from "@/libs/chains/evm/stake-slashes/deployments";

import { unstakeStep, withdrawStep } from "./stake-steps";

const OWNER = "0x2222222222222222222222222222222222222222";

function intent(kind: StakeIntent["kind"], signature: string, amount: string, to: string): StakeIntent {
  return {
    kind,
    account: `${ROBINHOOD_TESTNET_STAKE.chainId}:${OWNER}`,
    amount: { amount, asset: `${ROBINHOOD_TESTNET_STAKE.chainId}/erc20:0x1`, decimals: 6 },
    transaction: {
      namespace: "eip155",
      kind: "transaction",
      chainId: ROBINHOOD_TESTNET_STAKE.chainId,
      from: OWNER,
      to,
      data: encodeCall(signature, [BigInt(amount)]),
      value: "0",
    },
    preflight: null,
    withdrawable: null,
    blockedBy: null,
  } as unknown as StakeIntent;
}

function signer() {
  return { address: OWNER, chainId: ROBINHOOD_TESTNET_STAKE.chainId, kind: "external", signAndSend: vi.fn(async () => "0xhash") };
}

const run = (step: ReturnType<typeof unstakeStep>) => step.run({ report: () => undefined } as never);

/* Frontend review 2026-10-15, F1: the stake sheets sign only the call the provider chose, on the pinned contract. */
describe("stake steps send only the chosen stake call", () => {
  beforeEach(() => {
    services.unstake.mockReset();
    services.withdraw.mockReset();
  });

  it("sends requestUnstake(amount) to the pinned stake contract", async () => {
    services.unstake.mockResolvedValue(intent("UNSTAKE", "requestUnstake(uint64)", "5000000", ROBINHOOD_TESTNET_STAKE.stakeContract));
    const s = signer();
    await run(unstakeStep({ amountAtomic: "5000000", amountLabel: "$5", signer: s as unknown as Signer, chain: null }));
    expect(s.signAndSend).toHaveBeenCalledTimes(1);
  });

  it("refuses another amount, another function or another contract before the wallet is asked", async () => {
    const s = signer();
    const step = (amount: string) => withdrawStep({ amountAtomic: amount, amountLabel: "$5", signer: s as unknown as Signer, chain: null });

    services.withdraw.mockResolvedValue(intent("WITHDRAW", "withdrawStake(uint64)", "9000000", ROBINHOOD_TESTNET_STAKE.stakeContract));
    await expect(run(step("5000000"))).rejects.toThrow(/another amount/);

    services.withdraw.mockResolvedValue(intent("WITHDRAW", "requestUnstake(uint64)", "5000000", ROBINHOOD_TESTNET_STAKE.stakeContract));
    await expect(run(step("5000000"))).rejects.toThrow(/not withdrawStake/);

    services.withdraw.mockResolvedValue(
      intent("WITHDRAW", "withdrawStake(uint64)", "5000000", "0x000000000000000000000000000000000000dEaD"),
    );
    await expect(run(step("5000000"))).rejects.toThrow(/none of this app's contracts/);

    expect(s.signAndSend).not.toHaveBeenCalled();
  });
});
