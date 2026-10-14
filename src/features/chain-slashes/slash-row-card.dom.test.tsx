import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { HexString } from "@/libs/chains/evm/stake-slashes/address";
import { ROBINHOOD_TESTNET_STAKE } from "@/libs/chains/evm/stake-slashes/deployments";
import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";
import { slashRecordStatusOf } from "@/libs/chains/evm/stake-slashes/status";

import { notSelectableReason } from "./dispute-selection";
import { SlashRowCard, type DisputeSelectionProps } from "./slash-row-card";

/*
  The R13 id1 row: disputed at 08:58:08, upheld by the arbiter before its
  executableAt (09:37), so the record is Pending again with that executableAt
  and its disputedAt kept. Rendered as text, the way the provider reads it.
*/

const NOW = Date.parse("2026-10-15T08:59:00Z") / 1000;
const EXECUTABLE_AT = Date.parse("2026-10-15T09:37:00Z") / 1000;
const DISPUTED_AT = Date.parse("2026-10-15T08:58:08Z") / 1000;
const UPHELD_AT = Date.parse("2026-10-15T08:58:40Z") / 1000;

function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function upheldRow(overrides: Partial<ChainSlashRow> = {}): ChainSlashRow {
  return {
    requestId: `0x${"0b63d5".padEnd(64, "1")}` as HexString,
    status: slashRecordStatusOf(1, true),
    cancelReason: null,
    penalty: BigInt(10_000),
    reserved: BigInt(10_000),
    applied: null,
    beneficiary: "0x64fecbe18e8998cb2990bce631a042f8e2be1659" as HexString,
    proposedAt: EXECUTABLE_AT - 3_600,
    executableAt: EXECUTABLE_AT,
    disputedAt: DISPUTED_AT,
    disputeExpiresAt: null,
    upheld: true,
    upheldAt: UPHELD_AT,
    upheldTx: `0x${"a".repeat(64)}` as HexString,
    disputeTx: `0x${"d".repeat(64)}` as HexString,
    proposeTx: `0x${"c".repeat(64)}` as HexString,
    closeTx: null,
    stateSource: "record",
    ...overrides,
  };
}

function render(row: ChainSlashRow, nowSeconds = NOW): { text: string; markup: string } {
  const selection: DisputeSelectionProps = {
    notSelectable: notSelectableReason(row, nowSeconds, true),
    selected: false,
    limitReached: false,
    locked: false,
    onToggle: () => {},
  };
  const markup = renderToStaticMarkup(
    <SlashRowCard
      row={row}
      deployment={ROBINHOOD_TESTNET_STAKE}
      asset={{ decimals: 6, symbol: "USDG", fromChain: true }}
      nowSeconds={nowSeconds}
      match={{ kind: "known", proposalId: "p1" }}
      viewingOwnStake
      selection={selection}
    />,
  );
  return { text: textOf(markup), markup };
}

describe("an upheld penalty on the penalties-on-chain page", () => {
  it("is labelled upheld, with when it can be executed and no dispute countdown", () => {
    const { text } = render(upheldRow());
    expect(text).toContain("Upheld by Assay's arbiter");
    expect(text).toContain("can be disputed on chain only once");
    expect(text).toContain("It can be executed from 2026-10-15 09:37 UTC");
    expect(text).not.toContain("left to dispute");
    expect(text).not.toContain("Dispute before");
    expect(text).not.toMatch(/\bPending\b/);
  });

  it("has no checkbox and no dispute option", () => {
    const { text, markup } = render(upheldRow());
    expect(markup).not.toContain('type="checkbox"');
    expect(text).not.toContain("Select to dispute on chain");
    expect(text).not.toContain("To dispute it");
  });

  it("shows when it was upheld and the uphold transaction, not a 'Disputed on chain' field", () => {
    const { text } = render(upheldRow());
    expect(text).toContain("Upheld by the arbiter 2026-10-15 08:58 UTC");
    expect(text).toContain("after your dispute on 2026-10-15 08:58 UTC");
    expect(text).toContain("Uphold tx");
    expect(text).not.toContain("Disputed on chain");
  });

  it("leaves the uphold time out when its block time was not read", () => {
    const { text } = render(upheldRow({ upheldAt: null, upheldTx: null }));
    expect(text).toMatch(/Upheld by Assay's arbiter ?, after your dispute on 2026-10-15 08:58 UTC\./);
    expect(text).not.toContain("Upheld by the arbiter 2026");
    expect(text).not.toContain("Uphold tx");
  });

  it("says it can be executed now once its executableAt has passed", () => {
    const { text } = render(upheldRow(), EXECUTABLE_AT + 60);
    expect(text).toContain("Upheld by Assay's arbiter");
    expect(text).toContain("It can be executed now");
    expect(text).not.toContain("The dispute window has closed");
  });

  it("still offers a never-disputed Pending row for dispute, for contrast", () => {
    const { text, markup } = render(
      upheldRow({ status: slashRecordStatusOf(1, false), disputedAt: null, upheld: false, upheldAt: null, upheldTx: null, disputeTx: null }),
    );
    expect(text).toContain("left to dispute");
    expect(markup).toContain('type="checkbox"');
  });
});
