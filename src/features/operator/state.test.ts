import { describe, expect, it } from "vitest";

import {
  authorityRefusal,
  cancelDeadlineNotice,
  disputedPartsNote,
  exceedsAuthority,
  isCancelRequested,
  may,
  RECALCULATED_AMOUNT_PATTERN,
  suspendedNotice,
  suspendIsTwoPerson,
  TWO_PERSON_ACTIONS,
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
    expect(sentence).toBe("the penalty is $28.47 and your authority limit is $0.00");
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

/**
 * A requested cancel is not a cancel. Until its signer signs it — the arbiter
 * on EVM, the program admin on Solana — the on-chain record stands, and from
 * its executable time anyone can execute the penalty, so the console has to
 * say when that is, and whose signature it waits for.
 */
const EVM_ASSET = "eip155:46630/erc20:0x0aF4D08f97B4FA8Ba3E47Cb025aE8CaD509bc73c";
const SIGNERS = [
  ["EVM", EVM_ASSET, "the arbiter"],
  ["Solana", ASSET, "the program admin"],
  ["an unknown chain", undefined, "the arbiter (EVM) or the program admin (Solana)"],
] as const;

describe("the deadline of a requested on-chain cancel", () => {
  const NOW = new Date("2026-10-14T08:00:00Z");

  it.each(["NONE", "PROPOSING", "PENDING", "EXECUTED", "CANCELLED", "REFUSED", undefined, null])(
    "says nothing while the on-chain record is %s",
    (chainStatus) => {
      expect(cancelDeadlineNotice(chainStatus, "2026-10-17T09:15:00.000Z", NOW, EVM_ASSET)).toBeNull();
    },
  );

  describe.each(SIGNERS)("on %s", (_name, chain, signer) => {
    it("names the deadline while it is still ahead", () => {
      expect(cancelDeadlineNotice("CANCEL_REQUESTED", "2026-10-17T09:15:00.000Z", NOW, chain)).toEqual({
        overdue: false,
        text:
          `The cancel must be signed by ${signer} before 2026-10-17 09:15 UTC. `
          + "After that anyone can execute the penalty.",
      });
    });

    it("says anyone can execute now once the deadline has passed", () => {
      expect(cancelDeadlineNotice("CANCEL_REQUESTED", "2026-10-14T07:59:00.000Z", NOW, chain)).toEqual({
        overdue: true,
        text:
          "The on-chain record became executable at 2026-10-14 07:59 UTC and the cancel has not "
          + `landed: anyone can execute the penalty now. Get ${signer}'s signature `
          + "immediately.",
      });
    });

    it.each([null, undefined, "not a date"])(
      "still warns, without a time, when the brief carries %s (an older backend)",
      (chainExecutableAt) => {
        expect(cancelDeadlineNotice("CANCEL_REQUESTED", chainExecutableAt, NOW, chain)).toEqual({
          overdue: false,
          text:
            `The cancel must be signed by ${signer} before the on-chain record becomes `
            + "executable. After that anyone can execute the penalty.",
        });
      },
    );
  });

  it("treats the deadline itself as passed", () => {
    expect(cancelDeadlineNotice("CANCEL_REQUESTED", NOW.toISOString(), NOW, EVM_ASSET)?.overdue).toBe(true);
  });

  it("never names the settlement admin on EVM", () => {
    const notice = cancelDeadlineNotice("CANCEL_REQUESTED", "2026-10-17T09:15:00.000Z", NOW, "eip155:46630");
    expect(notice?.text).not.toMatch(/admin/);
  });
});

describe("what a suspension tells the operator about the chain", () => {
  describe.each(SIGNERS)("on %s", (_name, chain, signer) => {
    it.each(["PENDING", "CANCEL_REQUESTED"])(
      "says the cancel is requested and still needs a signature when the record is %s",
      (chainStatus) => {
        expect(suspendedNotice(chainStatus, chain)).toBe(
          `Proposal suspended. The on-chain cancel has been requested and still needs ${signer}'s signature.`,
        );
      },
    );

    it("says the cancel follows when a proposal was being written on chain", () => {
      expect(suspendedNotice("PROPOSING", chain)).toBe(
        "Proposal suspended. A proposal was being written on chain; its cancel is requested when "
        + `it lands and will need ${signer}'s signature.`,
      );
    });

    it("does not claim either way when the brief carries no chain status", () => {
      expect(suspendedNotice(undefined, chain)).toBe(
        "Proposal suspended. If a record stands on chain, its cancel has been requested and "
        + `still needs ${signer}'s signature.`,
      );
    });
  });

  it.each(["NONE", "REFUSED", "CANCELLED"])(
    "says there is nothing to cancel when the record is %s",
    (chainStatus) => {
      expect(suspendedNotice(chainStatus, EVM_ASSET)).toBe(
        "Proposal suspended. Nothing stands on chain for it, so there is nothing to cancel.",
      );
    },
  );
});

describe("the two-person case actions", () => {
  it("are the sweep, the record half of compensate, and the B18 record and re-propose", () => {
    expect(TWO_PERSON_ACTIONS).toEqual(["sweep", "compensate", "recordExecution", "repropose"]);
  });

  it("B18: the stuck-cancel actions are the cancel's pair, ADJL and TRE", () => {
    for (const action of ["closeCancel", "recordExecution", "repropose"] as const) {
      expect(may(["ADJL"], action)).toBe(true);
      expect(may(["TRE"], action)).toBe(true);
      expect(may(["ADJ", "SRE", "SUP"], action)).toBe(false);
    }
  });
});

/** A suspension of a confirmed case is two-person on the backend (`S-1` raised from UPHELD). */
describe("who may suspend alone", () => {
  it("alone from PROPOSED", () => {
    expect(suspendIsTwoPerson("PROPOSED")).toBe(false);
  });

  it("goes to the approvals inbox from UPHELD", () => {
    expect(suspendIsTwoPerson("UPHELD")).toBe(true);
  });
});

describe("disputedPartsNote", () => {
  it("says nothing when no part is disputed, or the backend does not report it", () => {
    expect(disputedPartsNote("PENDING", 0)).toBeNull();
    expect(disputedPartsNote("DISPUTED", undefined)).toBeNull();
  });

  it("calls a pending case with disputed parts partly disputed", () => {
    expect(disputedPartsNote("PENDING", 2)).toBe(
      "partly disputed: 2 parts disputed on chain, the other parts keep executing",
    );
    expect(disputedPartsNote("PENDING", 1)).toMatch(/^partly disputed: 1 part disputed/);
  });

  it("counts the parts of a wholly disputed case", () => {
    expect(disputedPartsNote("DISPUTED", 3)).toBe("3 parts disputed on chain");
  });
});
