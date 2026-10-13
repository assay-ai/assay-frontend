import { describe, expect, it } from "vitest";

import { ROBINHOOD_TESTNET_STAKE } from "./deployments";
import { disputeCallMismatch, encodeDisputeSlashBatch } from "./dispute-call";
import { PROVIDER, requestId } from "./fixtures";

const IDS = [requestId(1), requestId(2)];

const good = () => ({
  chainId: ROBINHOOD_TESTNET_STAKE.chainId,
  to: ROBINHOOD_TESTNET_STAKE.stakeContract.toLowerCase(),
  data: encodeDisputeSlashBatch(IDS),
  value: "0",
  signer: PROVIDER.toLowerCase(),
  signerRole: "PROVIDER",
  requestIds: [...IDS],
});

describe("disputeCallMismatch", () => {
  it("accepts exactly disputeSlashBatch(selected) to the pinned contract from the provider", () => {
    expect(disputeCallMismatch(good(), ROBINHOOD_TESTNET_STAKE, PROVIDER, [IDS[1], IDS[0]])).toBeNull();
  });

  it("refuses another contract, chain, sender, value, set of ids, or calldata", () => {
    const check = (patch: object) =>
      disputeCallMismatch({ ...good(), ...patch }, ROBINHOOD_TESTNET_STAKE, PROVIDER, IDS);
    expect(check({ to: "0x1111111111111111111111111111111111111111" })).toMatch(/stake contract/);
    expect(check({ chainId: "eip155:1" })).toMatch(/not eip155:46630/);
    expect(check({ signer: "0x1111111111111111111111111111111111111111" })).toMatch(/sender/);
    expect(check({ signerRole: "ARBITER" })).toMatch(/sender/);
    expect(check({ value: "5" })).toMatch(/value/);
    expect(check({ requestIds: [IDS[0]] })).toMatch(/other penalties/);
    expect(check({ data: encodeDisputeSlashBatch([IDS[0]]) })).toMatch(/calldata/);
  });
});
