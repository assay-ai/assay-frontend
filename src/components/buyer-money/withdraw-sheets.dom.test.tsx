// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
  FIX-PLAN P0-4: a withdrawal request pauses every paid call on the escrow's
  chain, even for a partial amount. That was a tick box; it is now a warning
  right above the button, naming the chain, with the button the one confirm.
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

import { WithdrawSheet, withdrawHeldNote, withdrawPauseWarning } from "./withdraw-sheets";

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

describe("Withdraw: the pause is stated, not ticked", () => {
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

  it("has no checkbox, and the button is the one confirm", () => {
    open();
    enter("5");
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/Tick the box/)).toBeNull();
    expect((screen.getByRole("button", { name: /Request \$5\.00 \(free\)/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  // B2 review I3: the request is capped at balance − held, so it is paid in full.
  it("says the held money stays in escrow and the full amount is paid out", () => {
    money.openHolds = "400000";
    open();
    enter("5");
    expect(screen.getByTestId("withdraw-held-receive").textContent).toBe(
      "$0.40 is held by calls being checked. It stays in your escrow and is not part of this request: you receive the $5.00 you ask for.",
    );
    // Said once: the older held line gives way to it.
    expect(screen.queryByTestId("withdraw-held-note")).toBeNull();
    expect(document.body.textContent).not.toMatch(/at least|less than you ask/);
  });

  it("with nothing held, says you receive what you ask for", () => {
    open();
    enter("5");
    expect(document.body.textContent).toContain("You receive the amount you ask for.");
  });
});

describe("withdraw copy", () => {
  it("falls back to 'this chain' before the chain is known", () => {
    expect(withdrawPauseWarning(null)).toContain("paid calls on this chain stop");
  });

  it("never subtracts the held amount, and is silent with nothing held", () => {
    expect(withdrawHeldNote(usd("100000"), usd("400000"), 0)).toBe(
      "$0.40 is held by calls being checked. It stays in your escrow and is not part of this request: you receive the $0.10 you ask for.",
    );
    expect(withdrawHeldNote(usd("100000"), usd("0"), 0)).toBeNull();
    expect(withdrawHeldNote(null, usd("400000"), 0)).toBeNull();
    // With unpaid calls the held line above already names the amount.
    expect(withdrawHeldNote(usd("5000000"), usd("400000"), 1)).toBe(
      "That money stays in your escrow and is not part of this request: you receive the $5.00 you ask for.",
    );
  });
});
