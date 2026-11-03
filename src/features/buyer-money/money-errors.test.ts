import { describe, expect, it } from "vitest";

import { ApiError } from "@/libs/ApiClient";

import {
  DEPOSIT_ESCROW_SHORTFALL_TEXT,
  DEPOSIT_NOT_OBSERVED_TEXT,
  describeMoneyError,
  describeSubmittedDepositError,
} from "./money-errors";

describe("describeMoneyError on the deposit flow", () => {
  it("422 PAYMENT_DEPOSIT_TRANSFER_NOT_OBSERVED says the transfer was not seen and nothing is charged twice", () => {
    const error = new ApiError("PAYMENT_DEPOSIT_TRANSFER_NOT_OBSERVED", "settlement reported success but no transfer", 422);
    expect(describeMoneyError(error)).toBe(DEPOSIT_NOT_OBSERVED_TEXT);
    expect(DEPOSIT_NOT_OBSERVED_TEXT).toMatch(/check Funding/);
    expect(DEPOSIT_NOT_OBSERVED_TEXT).toMatch(/never charged twice/);
  });

  it("409 PAYMENT_DEPOSIT_ESCROW_SHORTFALL tells the buyer not to send funds and to contact support", () => {
    const error = new ApiError("PAYMENT_DEPOSIT_ESCROW_SHORTFALL", "escrow shortfall", 409);
    expect(describeMoneyError(error)).toBe(DEPOSIT_ESCROW_SHORTFALL_TEXT);
    expect(describeSubmittedDepositError(error)).toEqual({ text: DEPOSIT_ESCROW_SHORTFALL_TEXT, tone: "danger" });
    expect(DEPOSIT_ESCROW_SHORTFALL_TEXT).toMatch(/Do not send funds/);
  });
});
