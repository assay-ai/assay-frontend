import * as React from "react";

import { ChainListContext } from "@/hooks/useChainTerms";
import type { Chain, ChainParams } from "@/interfaces/chain";

/** The on-chain params of the live testnet deployment (prod), as `GET /chains` serves them. */
export const TEST_PARAMS: ChainParams = {
  source: "chain",
  readAt: "2026-10-25T00:00:00.000Z",
  minimumStake: "50000000",
  penaltyAmount: "1000000",
  takeRateBps: 1000,
  slashAgentBps: 6000,
  slashPlatformBps: 3000,
  slashCapBps: 1000,
  unbondingPeriodSeconds: 950_400,
  slashDelaySeconds: 259_200,
  effectiveSlashDelaySeconds: 259_200,
  collectHoldSeconds: 3600,
  withdrawDelaySeconds: 10_800,
  tightenDelaySeconds: 10_800,
  redeemGraceSeconds: 7_200,
  heldTimeoutSeconds: 604_800,
  disputeTimeoutSeconds: 2_592_000,
  paused: false,
  arbiter: null,
};

export const TEST_CHAIN: Chain = {
  chainId: "eip155:46630",
  namespace: "eip155",
  displayName: "Robinhood Chain testnet",
  explorerBaseUrl: "https://explorer.testnet.chain.robinhood.com",
  settlementAsset: "eip155:46630/erc20:0xDbbC0000000000000000000000000000000000aA",
  settlementAssetSymbol: "USDG",
  decimals: 6,
  params: TEST_PARAMS,
};

/** Renders `children` as the app does once `GET /chains` answered with `chains`. */
export function WithChains({
  chains = [TEST_CHAIN],
  children,
}: {
  chains?: readonly Chain[];
  children: React.ReactNode;
}) {
  return <ChainListContext.Provider value={chains}>{children}</ChainListContext.Provider>;
}
