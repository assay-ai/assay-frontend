import { describe, expect, it } from "vitest";

import {
  authorityRefusal,
  exceedsAuthority,
  isCancelRequested,
  may,
  RECALCULATED_AMOUNT_PATTERN,
} from "./state";

import type { Money } from "@/interfaces/api";

const ASSET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const money = (amount: string): Money => ({ amount, asset: ASSET, decimals: 6 });

/**
 * `GET /operator/me` returns the operator's per-action ceiling, and the
 * backend refuses any decide, second or suspend whose amount is above it with
 * `OPERATOR_AUTHORITY_EXCEEDED`. The console used to ignore the field, so an
 * SRE with a limit of 0 was offered a Suspend form that could never succeed.
 */
describe("exceedsAuthority", () => {
  it("is false when the operator has no limit", () => {
    expect(exceedsAuthority(null, "28470000")).toBe(false);
  });

  it("is true when the amount is above the limit", () => {
    expect(exceedsAuthority(money("0"), "28470000")).toBe(true);
    expect(exceedsAuthority(money("28469999"), "28470000")).toBe(true);
  });

  it("is false at or below the limit — the backend refuses only above it", () => {
    expect(exceedsAuthority(money("28470000"), "28470000")).toBe(false);
    expect(exceedsAuthority(money("0"), "0")).toBe(false);
  });

  it("compares as integers, past 2^53", () => {
    expect(exceedsAuthority(money("9007199254740993"), "9007199254740994")).toBe(true);
    expect(exceedsAuthority(money("9007199254740994"), "9007199254740993")).toBe(false);
  });

  it("does not block on an amount it cannot read; the backend still decides", () => {
    expect(exceedsAuthority(money("0"), "not-a-number")).toBe(false);
  });
});

describe("authorityRefusal", () => {
  it("states both amounts as money, not minor units", () => {
    const sentence = authorityRefusal(money("0"), money("28470000"));
    expect(sentence).toBe("the penalty is $28.47 and this token's authority limit is $0.00");
    expect(sentence).not.toContain("28470000");
  });
});

describe("RECALCULATED_AMOUNT_PATTERN", () => {
  it.each(["1", "28470000"])("accepts %s", (value) => {
    expect(RECALCULATED_AMOUNT_PATTERN.test(value)).toBe(true);
  });

  it.each(["", "0", "-5", "284.7", "abc", "028470000", " 1"])("refuses %j", (value) => {
    expect(RECALCULATED_AMOUNT_PATTERN.test(value)).toBe(false);
  });
});

/**
 * `POST /operator/cases/:id/cancel-intent` is guarded on the ON-CHAIN record's
 * status and on nothing else about the case. The console used to wait for a
 * case status `CANCEL_REQUESTED`, which the backend never reports: an
 * overturned case waiting for the settlement admin still reads `OVERTURNED`.
 */
describe("cancel the judgement on chain", () => {
  it("is legal exactly while the on-chain record is CANCEL_REQUESTED", () => {
    expect(isCancelRequested("CANCEL_REQUESTED")).toBe(true);
  });

  it.each(["NONE", "PROPOSING", "PENDING", "EXECUTED", "CANCELLED", "REFUSED"])(
    "is not legal while the on-chain record is %s",
    (chainStatus) => {
      expect(isCancelRequested(chainStatus)).toBe(false);
    },
  );

  it("is not legal when the brief carries no chain status (an older backend)", () => {
    expect(isCancelRequested(undefined)).toBe(false);
  });

  it("is offered to the two roles the backend guard accepts", () => {
    expect(may(["ADJL"], "cancel")).toBe(true);
    expect(may(["TRE"], "cancel")).toBe(true);
    expect(may(["ADJ"], "cancel")).toBe(false);
    expect(may(["SRE"], "cancel")).toBe(false);
  });
});
