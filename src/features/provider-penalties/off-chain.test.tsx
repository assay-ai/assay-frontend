import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SlashProposalSummary } from "@/interfaces/provider-disputes";

import { isOffChainCase, OFF_CHAIN_LABEL, OffChainProposals, offChainRows } from "./off-chain";

/* Lot 1 B8 (BUG-DEMO-03): a proposal Assay knows that is not on chain yet is listed, never "there are none". */
const usd = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x1", decimals: 6 });
const proposal = (over: Partial<SlashProposalSummary> & { chainStatus?: string } = {}): SlashProposalSummary => {
  const { chainStatus = "PROPOSING", ...rest } = over;
  return {
    id: "0efea807-a21e-4031-9939-d36d82ec27e8",
    status: "PROPOSED",
    providerId: "p1",
    bindingId: "b1",
    bindingLabel: "bnd_71C",
    toolId: "t1",
    toolName: "get_weather",
    windowId: null,
    windowLabel: null,
    penaltyAmount: usd("28470000"),
    appliedAmount: null,
    clocks: { proposedAt: "2026-10-21T16:51:00.000Z", earliestExecutionAt: "2026-10-22T16:51:00.000Z", chainStatus } as never,
    disputeId: null,
    resolutionKind: null,
    resolvedAt: null,
    executedAt: null,
    ...rest,
  };
};

describe("off-chain proposals", () => {
  it("keeps proposed rows with no on-chain record, and drops anything else", () => {
    const rows = offChainRows([
      proposal(),
      proposal({ id: "a", chainStatus: "NONE" }),
      proposal({ id: "b", chainStatus: "PROPOSED" }),
      proposal({ id: "c", status: "EXECUTED" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["0efea807-a21e-4031-9939-d36d82ec27e8", "a"]);
    expect(offChainRows(undefined)).toEqual([]);
  });

  it("matches the Inbox link's case id", () => {
    const rows = offChainRows([proposal()]);
    expect(isOffChainCase(rows, "0efea807-a21e-4031-9939-d36d82ec27e8")).toBe(true);
    expect(isOffChainCase(rows, "other")).toBe(false);
    expect(isOffChainCase(rows, "")).toBe(false);
  });

  it("labels each row and names the tool and the amount", () => {
    const html = renderToStaticMarkup(<OffChainProposals rows={[proposal()]} />);
    expect(html).toContain(OFF_CHAIN_LABEL);
    expect(html).toContain("get_weather");
    expect(html).toContain("$28.47");
    expect(renderToStaticMarkup(<OffChainProposals rows={[]} />)).toBe("");
  });
});
