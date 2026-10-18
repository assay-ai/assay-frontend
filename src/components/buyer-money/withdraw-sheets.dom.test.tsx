// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
  FIX-PLAN P0-4: a withdrawal request pauses every paid call on the escrow's
  chain, even for a partial amount: a warning right above the button names the
  chain. Wave-1 audit M6/I2: an explicit tick box confirms it too, and the
  sheet never promises the full amount (the claim pays min(requested, balance),
  and paid calls can land before the request is on chain).
*/
const usd = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x1", decimals: 6 });
const money = vi.hoisted(() => ({ openHolds: "0" }));

vi.mock("./use-buyer-money", () => ({
  useBuyerMoney: () => ({
    escrow: {
      exists: true,
      balance: usd("13240000"),
      spendable: usd(String(13_240_000 - Number(money.openHolds))),
      openHolds: usd(money.openHolds),
      withdrawRequested: usd("0"),
      withdrawAvailableAt: null,
    },
    chain: { chainId: "eip155:46630", displayName: "Robinhood Chain testnet" },
    chainId: "eip155:46630",
    chainName: "Robinhood Chain testnet",
    decimals: 6,
    signerState: { status: "ready" },
    ownerShort: "0x7FD9…F8d1",
  }),
  useWalletBlocker: () => null,
  requireSigner: () => ({}),
}));
vi.mock("@/features/account-block/use-account-block", () => ({ useAccountReadOnly: () => false }));
vi.mock("@/features/buyer-debt/use-open-hold-intent-ids", () => ({ useOpenHoldIntentIds: () => ["i1"] }));
vi.mock("@/features/buyer-debt/use-owed-intent-ids", () => ({ useOwedIntentIds: () => new Set<string>() }));
vi.mock("@/features/buyer-debt/settle-debt-sheet", () => ({ useSettleDebt: () => ({ openSettle: () => undefined }) }));

import { WithdrawSheet, withdrawAcknowledgement, withdrawHeldNote, withdrawPauseWarning, withdrawReceiveNote } from "./withdraw-sheets";

afterEach(() => {
  cleanup();
  money.openHolds = "0";
});

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WithdrawSheet open onOpenChange={() => undefined} />
    </QueryClientProvider>,
  );
}

function enter(amount: string) {
  // The last chip is the custom amount; it opens the field.
  fireEvent.click(screen.getAllByRole("radio").at(-1)!);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: amount } });
}

describe("Withdraw: the pause is stated and acknowledged", () => {
  it("warns above the button, naming the chain, for a partial withdrawal of $5 of $13.24", () => {
    open();
    enter("5");
    const warning = screen.getByTestId("withdraw-pause-warning");
    expect(warning.textContent).toBe(
      "While this request is open (about 1 h), every agent's paid calls on Robinhood Chain testnet stop, even for a partial amount. Free calls keep working.",
    );
    const button = screen.getByRole("button", { name: /Request \$5\.00 \(free\)/ });
    // The warning comes before the button in reading order.
    expect(warning.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Wave-1 audit M6: removing the tick box weakened consent; it is back, beside the warning.
  it("asks for an explicit tick before the request can be sent", () => {
    open();
    enter("5");
    const box = screen.getByRole("checkbox");
    expect(box.closest("label")?.textContent).toBe(withdrawAcknowledgement("Robinhood Chain testnet"));
    const button = () => screen.getByRole("button", { name: /Request \$5\.00 \(free\)/ }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);
    fireEvent.click(box);
    expect(button().disabled).toBe(false);
  });

  // Wave-1 audit I2: the claim pays min(requested, balance); calls can land first.
  it("with calls held: the held money is not part of the request, and you receive up to the amount", () => {
    money.openHolds = "400000";
    open();
    enter("5");
    expect(screen.getByTestId("withdraw-held-receive").textContent).toBe(
      "$0.40 is held by calls being checked and is not part of this request. You receive up to $5.00. It can be less if paid calls land before the request is on chain; never more.",
    );
    // Said once: the older held line gives way to it.
    expect(screen.queryByTestId("withdraw-held-note")).toBeNull();
    expect(document.body.textContent).not.toMatch(/you receive the \$|amount you ask for\./);
  });

  it("with nothing held: still up to the amount, never a promise of all of it", () => {
    open();
    enter("5");
    expect(screen.getByTestId("withdraw-receive").textContent).toBe(
      "You receive up to $5.00. It can be less if paid calls land before the request is on chain; never more.",
    );
  });
});

describe("withdraw copy", () => {
  it("falls back to 'this chain' before the chain is known", () => {
    expect(withdrawPauseWarning(null)).toContain("paid calls on this chain stop");
    expect(withdrawAcknowledgement(null)).toContain("paid calls on this chain stop");
  });

  it("never promises the full amount, never subtracts the held amount, and is silent with nothing held", () => {
    expect(withdrawHeldNote(usd("100000"), usd("400000"), 0)).toBe(
      "$0.40 is held by calls being checked and is not part of this request. You receive up to $0.10. It can be less if paid calls land before the request is on chain; never more.",
    );
    expect(withdrawHeldNote(usd("100000"), usd("0"), 0)).toBeNull();
    expect(withdrawHeldNote(null, usd("400000"), 0)).toBeNull();
    // With unpaid calls the held line above already names the amount.
    expect(withdrawHeldNote(usd("5000000"), usd("400000"), 1)).toBe(
      "That money is not part of this request. You receive up to $5.00. It can be less if paid calls land before the request is on chain; never more.",
    );
    expect(withdrawReceiveNote(null)).toBe(
      "You receive up to the amount you ask for. It can be less if paid calls land before the request is on chain; never more.",
    );
  });
});
