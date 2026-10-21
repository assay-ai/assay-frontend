import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SpendPolicy } from "@/services/limits.service";

import { PauseAllButton, PauseAllCard, PausedBanner } from "./pause-all";

/*
  verify-r13 P3: on a chain that serves free calls only, Pause all showed a red
  "Paused" state. The backend checks the pause on the paid path alone
  (`SpendPolicyEnforcementService.assertPolicyAdmits`; a free call is relayed
  before it), so there the switch would stop nothing: it is not offered.
*/
const policy = (paused: boolean): SpendPolicy =>
  ({
    id: "pol_1",
    scope: "AGENT",
    agentId: "agt_1",
    policyVersion: 1,
    asset: "eip155:46630/erc20:0x0",
    decimals: 6,
    perCallMax: null,
    dailyCap: null,
    monthlyCap: null,
    maxCallsPerHour: null,
    maxCallsPerMinute: null,
    maxSpendPerHour: null,
    requireApprovalAbove: null,
    paused,
    changedBy: null,
    changeReason: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  }) as SpendPolicy;

const EVM_ACCOUNT = "eip155:46630:0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1";
const SOLANA_ACCOUNT = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

function render(node: React.ReactNode, { paused, account }: { paused: boolean; account: string }): string {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(["spend-policy"], policy(paused));
  client.setQueryData(["escrow", null], { account });
  client.setQueryData(["chains"], { chains: [] });
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe("Pause all", () => {
  it("is offered on a chain with paid calls, and shows its paused state there", () => {
    expect(render(<PauseAllCard />, { paused: false, account: EVM_ACCOUNT })).toContain("Pause all paid calls");
    expect(render(<PauseAllButton />, { paused: true, account: EVM_ACCOUNT })).toContain("Paused · Resume");
    expect(render(<PausedBanner />, { paused: true, account: EVM_ACCOUNT })).toContain("You paused all paid calls.");
  });

  it("is not offered, paused or not, on a chain that serves free calls only", () => {
    for (const paused of [false, true]) {
      expect(render(<PauseAllCard />, { paused, account: SOLANA_ACCOUNT })).toBe("");
      expect(render(<PauseAllButton />, { paused, account: SOLANA_ACCOUNT })).toBe("");
      expect(render(<PausedBanner />, { paused, account: SOLANA_ACCOUNT })).toBe("");
    }
  });
});
