import { describe, expect, it } from "vitest";

import type { HexString } from "@/libs/chains/evm/stake-slashes/address";
import {
  ROBINHOOD_TESTNET_STAKE,
  explorerTxLink,
  stakeDeploymentFor,
} from "@/libs/chains/evm/stake-slashes/deployments";
import type { ChainSlashRow } from "@/libs/chains/evm/stake-slashes/rows";
import { slashStatusOf } from "@/libs/chains/evm/stake-slashes/status";

import { assayMatchFor, lookupAssayCases, type AssayCaseIndex } from "./assay-match";
import { SLASH_EXECUTION_GRACE_SECONDS, formatAtomic, pendingPhase, shortRequestId } from "./format";

const ID = "0x3bec0bc80b8fe8e4e35f9832edae46d543bd59ce0560f576ebf91ab811e5e3cb";

function row(status: number, executableAt = 1_000): ChainSlashRow {
  return {
    requestId: ID as HexString,
    status: slashStatusOf(status),
    cancelReason: null,
    penalty: BigInt(1),
    reserved: BigInt(1),
    applied: null,
    beneficiary: "0x64fecbe18e8998cb2990bce631a042f8e2be1659" as HexString,
    proposedAt: 0,
    executableAt,
    proposeTx: null,
    closeTx: null,
    stateSource: "record",
  };
}

describe("shortRequestId", () => {
  it("keeps six hex characters at each end", () => {
    expect(shortRequestId(ID)).toBe("0x3bec0b…e5e3cb");
    expect(shortRequestId("0xabc")).toBe("0xabc");
  });
});

describe("formatAtomic", () => {
  it("formats atomic units at the asset's scale, truncating", () => {
    expect(formatAtomic(BigInt(1_000_000), 6, "USDG")).toBe("1.00 USDG");
    expect(formatAtomic(BigInt(150_000), 6, "USDG")).toBe("0.15 USDG");
    expect(formatAtomic(BigInt(1_234_567_899), 6, "USDG")).toBe("1,234.56 USDG");
  });

  it("never shows a non-zero penalty as zero", () => {
    expect(formatAtomic(BigInt(1), 6, "USDG")).toBe("0.000001 USDG");
    expect(formatAtomic(BigInt(0), 6, "USDG")).toBe("0.00 USDG");
  });
});

describe("pendingPhase", () => {
  it("counts down the dispute window while it is open", () => {
    expect(pendingPhase(row(1, 1_000), 400)).toEqual({ phase: "disputable", secondsLeft: 600 });
  });

  it("is executable from executableAt until the grace ends, then only expirable", () => {
    expect(pendingPhase(row(1, 1_000), 1_000)).toEqual({
      phase: "executable",
      secondsLeft: SLASH_EXECUTION_GRACE_SECONDS,
    });
    expect(pendingPhase(row(1, 1_000), 1_000 + SLASH_EXECUTION_GRACE_SECONDS)).toEqual({ phase: "expirable" });
  });

  it("has no clock for any other status", () => {
    expect(pendingPhase(row(2), 0)).toBeNull();
    expect(pendingPhase(row(4), 0)).toBeNull();
  });
});

describe("assayMatchFor", () => {
  const checked: AssayCaseIndex = {
    status: "checked",
    known: new Map([[ID, { proposalId: "case-1" }]]),
  };

  it("links a row Assay knows to its case", () => {
    expect(assayMatchFor(row(1), checked)).toEqual({ kind: "known", proposalId: "case-1" });
  });

  it("marks an open penalty Assay does not know", () => {
    const empty: AssayCaseIndex = { status: "checked", known: new Map() };
    expect(assayMatchFor(row(1), empty)).toEqual({ kind: "not-known" });
    expect(assayMatchFor(row(4), empty)).toEqual({ kind: "not-known" });
    expect(assayMatchFor(row(2), empty)).toEqual({ kind: "unchecked" });
  });

  it("never claims not-known when the lookup could not run", async () => {
    const index = await lookupAssayCases([ID as HexString]);
    expect(index.status).toBe("unavailable");
    expect(assayMatchFor(row(1), index)).toEqual({ kind: "unchecked" });
    expect(assayMatchFor(row(1), null)).toEqual({ kind: "unchecked" });
  });
});

describe("config", () => {
  it("finds the pinned deployment by chain and builds explorer links", () => {
    expect(stakeDeploymentFor("eip155:46630")).toBe(ROBINHOOD_TESTNET_STAKE);
    expect(stakeDeploymentFor("eip155:1")).toBeNull();
    expect(explorerTxLink(ROBINHOOD_TESTNET_STAKE, "0xabc")).toBe(
      "https://explorer.testnet.chain.robinhood.com/tx/0xabc",
    );
  });
});
