import { describe, expect, it, vi } from "vitest";

import {
  isEscrowDisarmed,
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
