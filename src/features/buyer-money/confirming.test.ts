import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as React from "react";
import { describe, expect, it } from "vitest";

import type { FullBalance } from "@/features/g30/balance";

import {
  CONFIRMING_TEXT,
  DEPOSIT_CREDIT_TEXT,
  anyConfirming,
  confirmingLine,
  confirmingOnChain,
  confirmingPollMs,
  escrowLedgerRow,
  readyForPaidCalls,
  uncreditedLine,
} from "./confirming";

const ASSET = "eip155:46630/erc20:0x915E";
const m = (amount: string) => ({ amount, asset: ASSET, decimals: 6 });
const row = (over: Partial<FullBalance> = {}): FullBalance => ({
  chainId: "eip155:46630",
  accountId: "eip155:46630:0xabc",
  asset: ASSET,
  decimals: 6,
  available: m("0"),
  held: m("0"),
  pending: m("20000000"),
  pendingDeposits: m("0"),
  chainReadable: true,
  ...over,
});

describe("money still confirming on chain (BUG-A-06)", () => {
  it("adds pending and pendingDeposits; null when nothing is confirming", () => {
    expect(confirmingOnChain(row({ pendingDeposits: m("500000") }))?.amount).toBe("20500000");
    expect(confirmingOnChain(row({ pending: m("0") }))).toBeNull();
    expect(confirmingOnChain(row({ pending: undefined, pendingDeposits: undefined }))).toBeNull();
    expect(confirmingOnChain(null)).toBeNull();
  });

  it("caps what paid calls can use by the ledger while a deposit is confirming", () => {
    // The chain already counts the $20; the ledger credits it at finality.
    expect(readyForPaidCalls(m("20000000"), row())?.amount).toBe("0");
    expect(readyForPaidCalls(m("25000000"), row({ available: m("5000000") }))?.amount).toBe("5000000");
    expect(readyForPaidCalls(null, row({ available: m("5000000") }))?.amount).toBe("5000000");
  });

  it("leaves the chain figure alone when nothing is confirming or there is no ledger row", () => {
    const chain = m("20000000");
    expect(readyForPaidCalls(chain, row({ pending: m("0"), available: m("1") }))).toBe(chain);
    expect(readyForPaidCalls(chain, null)).toBe(chain);
  });

  it("picks the escrow chain's row only when there is exactly one", () => {
    const a = row();
    const other = row({ chainId: "solana:x", accountId: "solana:x:y" });
    expect(escrowLedgerRow([other, a], "eip155:46630")).toBe(a);
    expect(escrowLedgerRow([a, { ...a, accountId: "eip155:46630:0xdef" }], "eip155:46630")).toBeNull();
    expect(escrowLedgerRow([a], null)).toBeNull();
    expect(escrowLedgerRow(undefined, "eip155:46630")).toBeNull();
  });

  it("names the amount and the wait", () => {
    expect(confirmingLine(row())).toBe(`$20.00 ${CONFIRMING_TEXT}`);
    expect(CONFIRMING_TEXT).toBe("still confirming on chain (usually a few seconds)");
    expect(confirmingLine(row({ pending: m("0") }))).toBeNull();
  });

  it("the deposit sheet no longer promises the balance within about a minute", () => {
    const sheet = readFileSync(resolve(__dirname, "../../components/buyer-money/deposit-sheet.tsx"), "utf8");
    expect(sheet).not.toMatch(/within about a minute/);
    expect(sheet).toMatch(/DEPOSIT_CREDIT_TEXT/);
    expect(DEPOSIT_CREDIT_TEXT).toMatch(/usually within a few seconds/);
  });

  it("the Funding page uses the ledger-capped figure and shows the confirming line", () => {
    const view = readFileSync(resolve(__dirname, "../../components/buyer-money/funding-view.tsx"), "utf8");
    expect(view).toMatch(/readyForPaidCalls\(/);
    expect(view).toMatch(/<ConfirmingNote line=\{confirming\} \/>/);
  });
});

describe("ConfirmingNote", () => {
  it("renders the line with when paid calls can use it", async () => {
    const { ConfirmingNote } = await import("@/components/buyer-money/funding-view");
    const html = renderToStaticMarkup(React.createElement(ConfirmingNote, { line: confirmingLine(row())! }));
    expect(html).toContain("$20.00 still confirming on chain (usually a few seconds). Paid calls can use it once the chain confirms it.");
  });
});

describe("anyConfirming (the balances query polls while it is true)", () => {
  it("true while any row has money confirming, false once it is credited", () => {
    expect(anyConfirming([row({ pending: m("5000000") })])).toBe(true);
    expect(anyConfirming([row({ pending: m("0") })])).toBe(false);
    expect(anyConfirming(undefined)).toBe(false);
  });
});

describe("the /balances poll backs off for a deposit stuck confirming", () => {
  it("3 s for the first two minutes, then 30 s", () => {
    expect(confirmingPollMs(0)).toBe(3_000);
    expect(confirmingPollMs(119_999)).toBe(3_000);
    expect(confirmingPollMs(120_000)).toBe(30_000);
    expect(confirmingPollMs(3_600_000)).toBe(30_000);
  });
});

/* Lot 1 A3: money on chain the ledger has not credited is not what agents can spend. */
describe("uncredited on-chain money", () => {
  const settled = (available: string) => row({ available: m(available), pending: m("0") });

  it("caps the headline at the ledger's available, and at chain minus uncredited without a ledger row", () => {
    expect(readyForPaidCalls(m("25000000"), settled("20000000"), m("5000000"))?.amount).toBe("20000000");
    expect(readyForPaidCalls(m("25000000"), null, m("5000000"))?.amount).toBe("20000000");
    expect(readyForPaidCalls(m("3000000"), null, m("5000000"))?.amount).toBe("0");
  });

  it("changes nothing when the field is zero, null or absent (older backend)", () => {
    expect(readyForPaidCalls(m("25000000"), settled("20000000"), m("0"))?.amount).toBe("25000000");
    expect(readyForPaidCalls(m("25000000"), settled("20000000"), null)?.amount).toBe("25000000");
    expect(readyForPaidCalls(m("25000000"), settled("20000000"))?.amount).toBe("25000000");
  });

  it("says how much is on chain and not yet usable", () => {
    expect(uncreditedLine(m("5000000"))).toBe("$5.00 on chain, not yet usable by agents");
    expect(uncreditedLine(m("0"))).toBeNull();
    expect(uncreditedLine(undefined)).toBeNull();
  });
});
