import { describe, expect, it, vi } from "vitest";

import type { Signer } from "@/hooks/useSigner";
import type { DelegateIntent } from "@/interfaces";

const calls: string[] = [];
const PAYER = "0x18103e1D79257c695B2FBbd4b346CD2Ba7927296";
const DELEGATE = "0x76B98fD03eE16e2673532769891f1400b447d10C";
const ESCROW = "0x343606d8Db3872EEC5Ea56cb43b9F4606Bfdf71f";

const REVOKE_INTENT: DelegateIntent = {
  kind: "REVOKE_DELEGATE",
  account: `eip155:46630:${PAYER}`,
  transaction: {
    namespace: "eip155",
    chainId: "eip155:46630",
    kind: "typed-data",
    domain: { name: "Assay Settlement", version: "2", chainId: "46630", verifyingContract: ESCROW },
    types: {
      RevokeDelegate: [
        { name: "payer", type: "address" },
        { name: "delegate", type: "address" },
        { name: "nonce", type: "uint64" },
        { name: "deadline", type: "uint64" },
      ],
    },
    primaryType: "RevokeDelegate",
    message: { payer: PAYER, delegate: DELEGATE, nonce: "4", deadline: "1800000300" },
    relayed: true,
  },
} as unknown as DelegateIntent;

vi.mock("@/services/delegation.service", () => ({
  listDelegates: vi.fn(),
  createDelegateIntent: vi.fn(),
  submitDelegate: vi.fn(),
  createRevokeDelegateIntent: vi.fn(async (delegate: string) => {
    calls.push(`revoke-intent ${delegate}`);
    return REVOKE_INTENT;
  }),
  submitRevokeDelegate: vi.fn(async (body: Record<string, unknown>) => {
    calls.push(`revoke ${String(body.signature)}`);
    return { kind: "REVOKE_DELEGATE", delegates: [] };
  }),
}));
vi.mock("@/hooks/useSigner", () => ({
  useSigner: () => ({ status: "hydrating" }),
  isUserRejection: (error: unknown) => error instanceof Error && error.message === "rejected",
}));

import { stopPaymentKeyOnChain } from "./agent-payment-delegation";

function signer(fail?: Error): Signer {
  return {
    address: PAYER,
    chainId: "eip155:46630",
    signTypedData: vi.fn(async (_tx: unknown, options: unknown) => {
      calls.push(`wallet ${JSON.stringify(options)}`);
      if (fail) throw fail;
      return `0x${"ab".repeat(65)}`;
    }),
  } as unknown as Signer;
}

describe("Stop it: one signature that stops the payment key on chain", () => {
  it("runs revoke-intent, then the wallet with Privy's confirmation shown, then revoke", async () => {
    calls.length = 0;
    await stopPaymentKeyOnChain(`eip155:46630:${DELEGATE}`, signer(), { chainId: "46630", verifyingContract: ESCROW });
    expect(calls).toEqual([`revoke-intent ${DELEGATE}`, 'wallet {"showWalletUIs":true}', `revoke 0x${"ab".repeat(65)}`]);
  });

  it("relays nothing when the wallet declines", async () => {
    calls.length = 0;
    await expect(
      stopPaymentKeyOnChain(`eip155:46630:${DELEGATE}`, signer(new Error("rejected")), { chainId: "46630", verifyingContract: ESCROW }),
    ).rejects.toThrow("rejected");
    expect(calls).toEqual([`revoke-intent ${DELEGATE}`, 'wallet {"showWalletUIs":true}']);
  });
});
