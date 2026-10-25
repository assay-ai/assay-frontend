import type { ChainParams } from "@/interfaces/chain";

/** The demo chain's on-chain params (DEMO ONLY): the live testnet deployment's, as a picture. No imports, so demo fixtures can read it without a cycle. */
export const DEMO_CHAIN_PARAMS: ChainParams = {
  source: "chain",
  readAt: null,
  minimumStake: "50000000",
  penaltyAmount: "1000000",
  takeRateBps: 1000,
  slashAgentBps: 6000,
  slashPlatformBps: 3000,
  slashCapBps: 1000,
  unbondingPeriodSeconds: 950_400,
  slashDelaySeconds: 259_200,
  effectiveSlashDelaySeconds: 259_200,
  collectHoldSeconds: 3_600,
  withdrawDelaySeconds: 10_800,
  tightenDelaySeconds: 10_800,
  redeemGraceSeconds: 7_200,
  heldTimeoutSeconds: 604_800,
  disputeTimeoutSeconds: 2_592_000,
  paused: false,
  arbiter: null,
};
