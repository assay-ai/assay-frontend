import { describe, expect, it } from "vitest";

import { withdrawalFigures } from "./withdrawal-figures";

import type { BuyerEscrow, Money } from "@/interfaces";

const ASSET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMMC9";

function usdc(amount: string): Money {
  return { amount, asset: ASSET, decimals: 6 };
}

/** An existing escrow with a standing request, overridable field by field. */
function escrow(overrides: Partial<BuyerEscrow> = {}): BuyerEscrow {
  return {
    exists: true,
    /* The chain answered. Stated, never defaulted — see `BuyerEscrow.chainReadable`. */
    chainReadable: true,
    account: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:9xQe",
    escrowPda: "Esc11111111111111111111111111111111111111111",
    escrowTokenAccount: "Ata11111111111111111111111111111111111111111",
    balance: usdc("50000000"),
    openHolds: usdc("0"),
    spendable: usdc("50000000"),
    withdrawRequested: usdc("50000000"),
    withdrawAvailableAt: "2026-09-01T12:00:00.000Z",
    serverTime: "2026-09-01T09:00:00.000Z",
    maxVoucherAmount: usdc("1000000"),
    maxPerWindow: usdc("20000000"),
    spentInWindow: usdc("0"),
    windowStartedAt: null,
    windowSeconds: 86_400,
    observedAt: "2026-09-01T09:00:00.000Z",
    ...overrides,
  };
}

describe("withdrawalFigures", () => {
  it("marks the payout 'at most' and drops it to the balance when a redemption landed after the request", () => {
    // The case the whole module exists for: $50 requested, then $18.80 of
    // calls redeemed while the clock ran, so `withdraw()` will pay $31.20 —
    // and can still pay less, because the wait has not finished.
    const figures = withdrawalFigures(
      escrow({ balance: usdc("31200000"), spendable: usdc("31200000") }),
      { matured: false },
    );

    expect(figures).not.toBeNull();
    expect(figures!.requested.amount).toBe("50000000");
    expect(figures!.balance.amount).toBe("31200000");
    expect(figures!.payout.amount).toBe("31200000");
    expect(figures!.qualifier).toBe("at most");
    expect(figures!.cappedByBalance).toBe(true);
    expect(figures!.pending).toBe(true);
  });

  it("keeps the payout at the balance once the wait has passed, and drops only the qualifier", () => {
    const figures = withdrawalFigures(
      escrow({ balance: usdc("31200000"), spendable: usdc("31200000") }),
      { matured: true },
    );

    expect(figures!.payout.amount).toBe("31200000");
    expect(figures!.qualifier).toBeNull();
    expect(figures!.cappedByBalance).toBe(true);
  });

  it("pays the request, not the balance, when the escrow still holds more than was asked for", () => {
    const figures = withdrawalFigures(
      escrow({ withdrawRequested: usdc("12000000"), balance: usdc("50000000") }),
      { matured: true },
    );

    expect(figures!.payout.amount).toBe("12000000");
    expect(figures!.cappedByBalance).toBe(false);
  });

  it("ignores open holds — `withdraw` reads the token account, not this platform's ledger", () => {
    // `spendable` is $10 while `balance` is $50. A screen that used `spendable`
    // would under-report the payout by the holds.
    const figures = withdrawalFigures(
      escrow({ openHolds: usdc("40000000"), spendable: usdc("10000000") }),
      { matured: true },
    );

    expect(figures!.payout.amount).toBe("50000000");
  });

  it("returns the input Money objects rather than recomputed amounts", () => {
    const balance = usdc("31200000");
    const requested = usdc("50000000");
    const figures = withdrawalFigures(escrow({ balance, withdrawRequested: requested }), {
      matured: false,
    });

    // Identity, not equality: nothing is scaled, rounded or re-serialised on
    // the way through, so no atomic amount can drift from what the chain has.
    expect(figures!.payout).toBe(balance);
    expect(figures!.requested).toBe(requested);
  });

  it("holds exact atomic amounts a JS number could not", () => {
    // 2^64 − 1 and 2^64 − 2. As doubles both round to 18446744073709552000.
    const figures = withdrawalFigures(
      escrow({
        withdrawRequested: usdc("18446744073709551615"),
        balance: usdc("18446744073709551614"),
      }),
      { matured: true },
    );

    expect(figures!.payout.amount).toBe("18446744073709551614");
    expect(figures!.cappedByBalance).toBe(true);
  });

  it("reports no pending request when the ceiling is zero, and still shows the balance", () => {
    const figures = withdrawalFigures(escrow({ withdrawRequested: usdc("0") }), { matured: false });

    expect(figures!.pending).toBe(false);
    expect(figures!.payout.amount).toBe("0");
    expect(figures!.balance.amount).toBe("50000000");
  });

  it("treats a null requested ceiling as zero in the balance's own asset", () => {
    const figures = withdrawalFigures(escrow({ withdrawRequested: null }), { matured: true });

    expect(figures!.pending).toBe(false);
    expect(figures!.requested).toEqual({ amount: "0", asset: ASSET, decimals: 6 });
  });

  it("has no figures for an escrow that does not exist — that is 'open one', not 'zero'", () => {
    expect(
      withdrawalFigures(
        escrow({
          exists: false,
          escrowPda: null,
          escrowTokenAccount: null,
          balance: null,
          withdrawRequested: null,
          withdrawAvailableAt: null,
        }),
        { matured: false },
      ),
    ).toBeNull();
  });

  it("has no figures when the response carried no balance", () => {
    expect(withdrawalFigures(escrow({ balance: null }), { matured: true })).toBeNull();
  });
});
