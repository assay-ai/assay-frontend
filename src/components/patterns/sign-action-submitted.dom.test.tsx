// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { describeSubmittedDepositError } from "@/features/buyer-money/money-errors";
import { ApiError } from "@/libs/ApiClient";

import { SignAction, type WalletStep } from "./sign-action";

afterEach(cleanup);

function failAfterSubmit(error: unknown): WalletStep[] {
  return [
    {
      id: "deposit",
      label: "Deposit $5.00",
      cost: "gas",
      run: async ({ report }) => {
        report({ stage: "submitted", data: { kind: "signed" } });
        throw error;
      },
    },
  ];
}

describe("SignAction after a submitted step failed", () => {
  it("says the known outcome: the backend saw no transfer (BUG-PROD-BUY-MONEY-02)", async () => {
    const error = new ApiError("PAYMENT_DEPOSIT_TRANSFER_NOT_OBSERVED", "no transfer was observed", 422);
    render(
      <SignAction
        steps={failAfterSubmit(error)}
        label="Deposit $5.00"
        describeSubmittedError={describeSubmittedDepositError}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Deposit $5.00" }));
    expect(await screen.findByText(/We could not see your transfer on the chain yet/)).toBeTruthy();
    expect(screen.queryByText(/Your transaction was sent, but we could not confirm it yet/)).toBeNull();
  });

  it("keeps the generic sent-but-unconfirmed line for anything else", async () => {
    render(
      <SignAction
        steps={failAfterSubmit(new Error("receipt timeout"))}
        label="Deposit $5.00"
        describeSubmittedError={describeSubmittedDepositError}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Deposit $5.00" }));
    expect(await screen.findByText(/Your transaction was sent, but we could not confirm it yet/)).toBeTruthy();
  });
});
