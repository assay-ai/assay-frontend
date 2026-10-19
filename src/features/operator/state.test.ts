import { describe, expect, it } from "vitest";

import {
  cancelDeadlineNotice,
  disputedPartsNote,
  isCancelRequested,
  may,
  TWO_PERSON_ACTIONS,
} from "./state";

const ASSET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

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
const EVM_ASSET = "eip155:46630/erc20:0x7242F853db478A28Ae76Ace808212d4B68aa73e7";
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

describe("the two-person case actions", () => {
  it("are the record half of compensate, and the B18 record and re-propose", () => {
    expect(TWO_PERSON_ACTIONS).toEqual(["compensate", "recordExecution", "repropose"]);
  });

  it("B18: the stuck-cancel actions are the cancel's pair, ADJL and TRE", () => {
    for (const action of ["closeCancel", "recordExecution", "repropose"] as const) {
      expect(may(["ADJL"], action)).toBe(true);
      expect(may(["TRE"], action)).toBe(true);
      expect(may(["ADJ", "SRE", "SUP"], action)).toBe(false);
    }
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
