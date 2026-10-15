import { describe, expect, it } from "vitest";

import type { Money } from "@/interfaces";

import {
  ABSENT_TEXT,
  UNREADABLE_TEXT,
  chainFigure,
  type ChainFigure,
} from "./chain-read";

const ASSET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:614d";
const money = (amount: string): Money => ({ amount, asset: ASSET, decimals: 6 });

const ZERO = money("0");
const NINE = money("9965000");

describe("chainFigure — the three states never collapse", () => {
  it("names a chain that answered with an amount", () => {
    expect(chainFigure(true, NINE)).toEqual<ChainFigure>({ state: "read", text: "$9.96" });
  });

  it("names a chain that answered ZERO as a read, not as an unknown", () => {
    // The strongest claim on this surface: we asked, and the answer was none.
    expect(chainFigure(true, ZERO)).toEqual<ChainFigure>({ state: "read", text: "$0.00" });
  });

  it("names a chain that answered 'nothing there' as absent", () => {
    expect(chainFigure(true, null)).toEqual<ChainFigure>({ state: "absent", text: ABSENT_TEXT });
  });

  it("names an unreadable chain as unreadable", () => {
    expect(chainFigure(false, null)).toEqual<ChainFigure>({
      state: "unreadable",
      text: UNREADABLE_TEXT,
    });
  });

  /*
    The three assertions below are the ones that kill the degenerate implementations. Each states a PAIR that must differ — a test that only checks each
    state in isolation passes against an implementation that returns the same
    string for all of them.
  */

  it("KILLS 'unreadable renders like zero': the two texts differ", () => {
    const unreadable = chainFigure(false, null);
    const zero = chainFigure(true, ZERO);
    expect(unreadable.text).not.toBe(zero.text);
    expect(unreadable.state).not.toBe(zero.state);
    // And specifically: the unreadable one must not be a currency figure at all.
    expect(unreadable.text).not.toContain("$");
  });

  it("KILLS 'null is false': absent and unreadable are different answers", () => {
    // `!null === true` in JavaScript, which is how `/funding/escrow` told a
    // buyer with a real balance they had no escrow. Reading `chainReadable`
    // has to change the answer even when the value beside it is null both times.
    expect(chainFigure(true, null).state).not.toBe(chainFigure(false, null).state);
    expect(chainFigure(true, null).text).not.toBe(chainFigure(false, null).text);
  });

  it("KILLS 'fall through to a fallback figure': unreadable prints no amount", () => {
    // The `/funding` defect exactly: `withdrawable ?? available` printed the
    // ledger's $9.96 under "Withdrawable" while the chain was down. No input
    // to this function can make an unreadable chain print an amount, because
    // the amount is not one of its inputs.
    expect(chainFigure(false, NINE).text).toBe(UNREADABLE_TEXT);
    expect(chainFigure(false, NINE).text).not.toContain("9.96");
  });

  it("treats a MISSING flag as unreadable, never as readable", () => {
    // A field that stops being sent arrives as `undefined`. The safe direction
    // is to say we do not know — see the function's own ruling.
    expect(chainFigure(undefined, NINE).state).toBe("unreadable");
    expect(chainFigure(null, NINE).state).toBe("unreadable");
  });

  it("lets a caller reword ABSENT without touching the other two", () => {
    const figure = chainFigure(true, null, { absentText: "None yet" });
    expect(figure).toEqual<ChainFigure>({ state: "absent", text: "None yet" });
    // The override must not leak into the unreadable state — that would put a
    // screen's own optimistic wording on an outage.
    expect(chainFigure(false, null, { absentText: "None yet" }).text).toBe(UNREADABLE_TEXT);
  });

  it("honours `decimals` for a read figure", () => {
    expect(chainFigure(true, money("1000"), { decimals: 4 }).text).toBe("$0.001");
  });
});
