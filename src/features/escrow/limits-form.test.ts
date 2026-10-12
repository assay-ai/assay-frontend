import { describe, expect, it, vi } from "vitest";

import {
  LIMITS_LANDING_POLL_MS,
  LIMITS_LANDING_TIMEOUT_MS,
  isEscrowDisarmed,
  limitsLanded,
  limitsLandingInterval,
  parseLimitsForm,
  submitLimitsForm,
  type LimitsFormInput,
} from "./limits-form";

const DECIMALS = 6;

function input(overrides: Partial<LimitsFormInput> = {}): LimitsFormInput {
  return {
    maxVoucherAmount: "5",
    maxPerWindow: "50",
    confirmZero: false,
    ...overrides,
  };
}

describe("parseLimitsForm", () => {
  it("converts valid amounts to atomic decimal strings at the given scale", () => {
    const result = parseLimitsForm(input({ maxVoucherAmount: "5", maxPerWindow: "50.5" }), DECIMALS);
    expect(result).toEqual({
      ok: true,
      body: { maxVoucherAmount: "5000000", maxPerWindow: "50500000" },
      zeroFields: [],
    });
  });

  it("rejects a blank maxVoucherAmount rather than defaulting it to zero", () => {
    const result = parseLimitsForm(input({ maxVoucherAmount: "" }), DECIMALS);
    expect(result).toEqual({ ok: false, errors: { maxVoucherAmount: "Enter a limit." } });
  });

  it("rejects a blank maxPerWindow rather than defaulting it to zero", () => {
    const result = parseLimitsForm(input({ maxPerWindow: "   " }), DECIMALS);
    expect(result).toEqual({ ok: false, errors: { maxPerWindow: "Enter a limit." } });
  });

  it("rejects both fields blank with both errors reported", () => {
    const result = parseLimitsForm(input({ maxVoucherAmount: "", maxPerWindow: "" }), DECIMALS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.maxVoucherAmount).toBe("Enter a limit.");
      expect(result.errors.maxPerWindow).toBe("Enter a limit.");
    }
  });

  it("rejects a non-numeric value", () => {
    const result = parseLimitsForm(input({ maxVoucherAmount: "abc" }), DECIMALS);
    expect(result).toEqual({ ok: false, errors: { maxVoucherAmount: "Enter a plain number." } });
  });

  it("rejects a negative value", () => {
    const result = parseLimitsForm(input({ maxVoucherAmount: "-5" }), DECIMALS);
    expect(result).toEqual({ ok: false, errors: { maxVoucherAmount: "Cannot be negative." } });
  });

  it("refuses rather than rounds an amount with too many decimal places", () => {
    const result = parseLimitsForm(input({ maxVoucherAmount: "5.1234567" }), DECIMALS);
    expect(result).toEqual({
      ok: false,
      errors: { maxVoucherAmount: "Goes to 6 decimal places at most." },
    });
  });

  it("blocks a zero limit until confirmZero is ticked", () => {
    const result = parseLimitsForm(input({ maxVoucherAmount: "0", confirmZero: false }), DECIMALS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.confirmZero).toMatch(/refuses every paid call/);
    }
  });

  it("accepts a zero limit once confirmZero is ticked, and reports which field was zero", () => {
    const result = parseLimitsForm(input({ maxVoucherAmount: "0", confirmZero: true }), DECIMALS);
    expect(result).toEqual({
      ok: true,
      body: { maxVoucherAmount: "0", maxPerWindow: "50000000" },
      zeroFields: ["maxVoucherAmount"],
    });
  });

  it("does not require confirmZero when neither field is zero", () => {
    const result = parseLimitsForm(input({ confirmZero: false }), DECIMALS);
    expect(result.ok).toBe(true);
  });
});

describe("submitLimitsForm", () => {
  it("does NOT call createEscrowLimitsIntent when a field is blank", async () => {
    const createIntent = vi.fn(async () => ({}));
    const result = await submitLimitsForm(input({ maxVoucherAmount: "" }), createIntent, DECIMALS);

    expect(createIntent).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it("does NOT call createEscrowLimitsIntent for an unconfirmed zero", async () => {
    const createIntent = vi.fn(async () => ({}));
    const result = await submitLimitsForm(
      input({ maxPerWindow: "0", confirmZero: false }),
      createIntent,
      DECIMALS,
    );

    expect(createIntent).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it("calls createEscrowLimitsIntent with the atomic body once the form is valid", async () => {
    const createIntent = vi.fn(async () => ({ kind: "SET_LIMITS" }));
    const result = await submitLimitsForm(input(), createIntent, DECIMALS);

    expect(createIntent).toHaveBeenCalledTimes(1);
    expect(createIntent).toHaveBeenCalledWith({ maxVoucherAmount: "5000000", maxPerWindow: "50000000" });
    expect(result.ok).toBe(true);
  });
});

describe("isEscrowDisarmed", () => {
  const limit = (amount: string) => ({ amount });

  it("is true for the state open_escrow leaves behind — both limits zero", () => {
    // Every escrow this platform opens starts here: `open_escrow` refuses a
    // non-zero limit from anyone but the buyer, so the rent payer can only
    // ever create a disarmed one.
    expect(
      isEscrowDisarmed({
        exists: true,
        maxVoucherAmount: limit("0"),
        maxPerWindow: limit("0"),
      }),
    ).toBe(true);
  });

  it("is true when only one limit is zero, because redeem_voucher checks both", () => {
    expect(
      isEscrowDisarmed({
        exists: true,
        maxVoucherAmount: limit("5000000"),
        maxPerWindow: limit("0"),
      }),
    ).toBe(true);
  });

  it("is false once both limits are armed", () => {
    expect(
      isEscrowDisarmed({
        exists: true,
        maxVoucherAmount: limit("5000000"),
        maxPerWindow: limit("50000000"),
      }),
    ).toBe(false);
  });

  it("is false when there is no escrow — a different errand, not a disarmed one", () => {
    expect(isEscrowDisarmed(null)).toBe(false);
    expect(
      isEscrowDisarmed({ exists: false, maxVoucherAmount: null, maxPerWindow: null }),
    ).toBe(false);
  });

  it("treats an unreadable limit as unknown rather than as zero", () => {
    // Absent is not zero. Sending a buyer to sign a transaction they may not
    // need is the cost of guessing here.
    expect(
      isEscrowDisarmed({ exists: true, maxVoucherAmount: null, maxPerWindow: limit("0") }),
    ).toBe(false);
  });
});

describe("limitsLanded / limitsLandingInterval — the screen catches up with the chain", () => {
  // Measured on eip155:46630: the relayed SetLimits landed (1.00 / 10.00), the
  // one refetch fired right after it still read 0 / 0, and "Currently set"
  // stayed at $0.00 under "Done — your new limits are on chain" until reload.
  const asset = "eip155:46630/erc20:0xDbbC";
  const money = (amount: string) => ({ amount, asset, decimals: 6 });
  const signed = { maxVoucherAmount: "1000000", maxPerWindow: "10000000" };
  const before = { maxVoucherAmount: money("0"), maxPerWindow: money("0") };
  const after = { maxVoucherAmount: money("1000000"), maxPerWindow: money("10000000") };

  it("is true only when both on-chain limits equal the signed ones", () => {
    expect(limitsLanded(after, signed)).toBe(true);
    expect(limitsLanded(before, signed)).toBe(false);
    expect(limitsLanded({ ...after, maxPerWindow: money("0") }, signed)).toBe(false);
    expect(limitsLanded(undefined, signed)).toBe(false);
    expect(limitsLanded({ maxVoucherAmount: null, maxPerWindow: null }, signed)).toBe(false);
  });

  it("polls while the read still shows the pre-write limits, and stops once they land", () => {
    const awaiting = { body: signed, since: 1_000 };
    expect(limitsLandingInterval(before, awaiting, 2_000)).toBe(LIMITS_LANDING_POLL_MS);
    expect(limitsLandingInterval(after, awaiting, 2_000)).toBe(false);
  });

  it("does not poll when nothing was submitted, and gives up after the timeout", () => {
    expect(limitsLandingInterval(before, null, 2_000)).toBe(false);
    const awaiting = { body: signed, since: 1_000 };
    expect(limitsLandingInterval(before, awaiting, 1_000 + LIMITS_LANDING_TIMEOUT_MS + 1)).toBe(false);
  });
});

describe("parseLimitsForm — per call against the window (BUG-R2-REAL-01)", () => {
  it("refuses a per-call limit above the window limit", () => {
    const result = parseLimitsForm(input({ maxVoucherAmount: "20", maxPerWindow: "10" }), DECIMALS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.maxVoucherAmount).toMatch(/per-window/);
  });

  it("accepts equal limits", () => {
    expect(parseLimitsForm(input({ maxVoucherAmount: "10", maxPerWindow: "10" }), DECIMALS).ok).toBe(
      true,
    );
  });
});
