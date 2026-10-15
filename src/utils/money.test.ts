import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  parseAmountInput,
  splitForDisplay,
  exceedsScale,
  formatDecimal,
  formatMoney,
  toAtomic,
  toDecimal,
} from "./money";

/**
 * `toAtomic` is the last thing that touches a buyer's amount before it becomes
 * a number on a chain, and it has no UI to reveal a mistake: a wrong amount
 * looks exactly like a successful deposit. That is why it is pinned here rather
 * than left to the browser run — a truncation bug is invisible to a human
 * pressing the button, and it is invisible to the screen too, because the
 * summary line and the transmitted amount are computed down separate paths.
 *
 * USDC's 6 is used throughout because it is the only scale the MVP settles in.
 */
const USDC = 6;

const atomic = (value: string, decimals = USDC) => toAtomic(new Decimal(value), decimals);

describe("toAtomic", () => {
  it("scales a plain dollar amount, with or without the cents the field allows", () => {
    // The amount field accepts both spellings and must not distinguish them.
    expect(atomic("5.00")).toBe("5000000");
    expect(atomic("5")).toBe("5000000");
  });

  it("is exact at the asset's last representable digit", () => {
    // 6 dp — the boundary. One more and it is refused; here it must pass
    // through digit for digit.
    expect(atomic("25.123456")).toBe("25123456");
  });

  it("refuses a seventh decimal place instead of truncating it", () => {
    // The case the form's validation exists for. `25123456` would be a silent
    // underpayment and `25123457` a silent overpayment; both are worse than a
    // refusal, so neither is allowed to be the answer.
    expect(() => atomic("25.1234567")).toThrow(RangeError);
    expect(() => atomic("25.1234567")).toThrow(/more than the asset's 6/);
    expect(exceedsScale(new Decimal("25.1234567"), USDC)).toBe(true);
    expect(exceedsScale(new Decimal("25.123456"), USDC)).toBe(false);
  });

  it("keeps the digits a float would already have lost on an ordinary $8.29", () => {
    /*
      Not an exotic amount — $8.29 is a plausible deposit, above the $5.00
      minimum, and `parseFloat("8.29") * 1e6` is 8289999.999999999, which
      truncates to 8289999. The error is in the double before any scaling
      happens, because no binary float holds 8.29. This is the single most
      likely way this function could have been written wrong.
    */
    expect(atomic("8.29")).toBe("8290000");
    expect(String(Math.trunc(parseFloat("8.29") * 1e6))).toBe("8289999");
  });

  it("keeps digits past decimal.js's 20-significant-digit arithmetic ceiling", () => {
    /*
      The other tempting implementation, `value.times(new Decimal(10).pow(6))`,
      is exact for every realistic amount and then silently is not: decimal.js
      rounds arithmetic results to `Decimal.precision` significant digits, 20 by
      default. At 21 digits the last one is gone.

      Proved rather than described — the second expectation is the bug this
      function avoids, asserted so that anyone who "simplifies" `toAtomic` back
      to a multiplication is told which digit they just lost.
    */
    const value = new Decimal("123456789012345.678901");
    expect(Decimal.precision).toBe(20);

    expect(atomic("123456789012345.678901")).toBe("123456789012345678901");
    expect(value.times(new Decimal(10).pow(USDC)).toFixed(0)).toBe("123456789012345678900");
  });

  it("survives an integer no double can hold — 2^53 + 1", () => {
    /*
      9007199254740993 is the first integer a double cannot represent; `Number`
      collapses it onto 9007199254740992. Scaled by 1e6 a float does not even
      produce digits any more, it produces "9.007199254740992e+21", which is not
      a decimal string and would be rejected or misread by the API.

      Far above any real deposit, and that is the point: it fails loudly on the
      one input that can only be got right by never converting to a number.
    */
    expect(atomic("9007199254740993")).toBe("9007199254740993000000");
    expect(String(parseFloat("9007199254740993") * 1e6)).toBe("9.007199254740992e+21");
  });

  it("round-trips through toDecimal, so the figure shown is the figure sent", () => {
    /*
      The pairing that actually matters on the deposit screen: the summary
      renders the parsed `Decimal` and the request carries `toAtomic` of it, and
      the two are only the same number if this holds. Anything that made
      `toAtomic` round would show a buyer one amount and move another.
    */
    for (const value of ["5", "5.00", "8.29", "25.123456", "999999.999999"]) {
      const parsed = new Decimal(value);
      const sent = toAtomic(parsed, USDC);
      expect(
        toDecimal({ amount: sent, asset: "unused", decimals: USDC }).eq(parsed),
      ).toBe(true);
    }
  });

  it("emits a bare integer string, which is the form the deposit API accepts", () => {
    // `POST /deposits` matches `/^[1-9][0-9]*$/`: no point, no leading zero, no
    // exponent, no sign. Every amount the form can reach has to satisfy it.
    for (const value of ["5", "5.00", "8.29", "25.123456", "123456789012345.678901"]) {
      expect(atomic(value)).toMatch(/^[1-9][0-9]*$/);
    }
  });

  it("scales to whatever the asset says, not to a hardcoded 6", () => {
    // The mint's own figure travels with the requirements; a second asset with
    // a different scale must not need this function changed.
    expect(atomic("1.5", 9)).toBe("1500000000");
    expect(atomic("1.5", 2)).toBe("150");
    expect(atomic("1", 0)).toBe("1");
    expect(() => atomic("1.5", 0)).toThrow(RangeError);
  });

  it("carries a negative sign around the leading-zero strip", () => {
    // Unreachable from the deposit field, which forbids "-". Pinned because a
    // naive strip leaves "-0500000", and this is a shared utility that other
    // money paths will reach for.
    expect(atomic("-0.5")).toBe("-500000");
    expect(atomic("-5")).toBe("-5000000");
    expect(atomic("0")).toBe("0");
  });
});

/**
 * One rounding convention, pinned on the exact figures that disagreed.
 *
 * Measured in Chrome, under `mcp_demo_token_funded`, whose ledger holds
 * `{"amount":"9965000","decimals":6}` — 9.965 exactly:
 *
 * ```text
 * /funding            Available                     $9.96
 * /                   Balance                       $9.96
 * /funding/deposit    Balance after this deposit    $34.96   (+ $25.00)
 * ```
 *
 * All truncation, and all three went through DIFFERENT code: `formatMoney`
 * here, and a hand-copied `money()` in each of `funding/deposit/page.tsx` and
 * `funding/auto-top-up/page.tsx`. Three copies of one convention agree until
 * somebody edits one — and `/spend` had already broken step, printing a
 * per-call price through `toFixed(4, Decimal.ROUND_DOWN)` in one helper and a
 * bare `toFixed(4)` (decimal.js's default, which is ROUND_HALF_UP) in the
 * narrative sentence below it. Same screen, same quantity, half a cent apart,
 * and no test could see either because neither line had one.
 *
 * The convention is DOWN: a displayed figure is never larger than the figure
 * behind it, so the screen cannot promise money that is not there.
 */
describe("the rounding convention — truncate, never round", () => {
  it("truncates the half-cent, at both figures that were on screen together", () => {
    // 9.965 → $9.96, not $9.97. This is the assertion that kills a
    // ROUND_HALF_UP implementation, and it is the only one that can.
    expect(formatMoney({ amount: "9965000", asset: "x", decimals: 6 })).toBe("$9.96");
    // 9.965 + 25.00 = 34.965 → $34.96, not $34.97. Same direction, on the
    // screen the buyer reaches next.
    expect(formatDecimal(new Decimal("9.965").plus(25))).toBe("$34.96");
  });

  it("gives the SAME answer through both front doors", () => {
    // `formatMoney` delegates. If the two ever diverge again, the two screens
    // that share a figure diverge with them.
    const money = { amount: "9965000", asset: "x", decimals: 6 };
    expect(formatMoney(money)).toBe(formatDecimal(toDecimal(money)));
  });

  it("truncates at every precision, not only at two places", () => {
    // The `/spend` pair: a per-call price at 4 dp. `toFixed(4)` alone answers
    // $0.0026 here.
    expect(formatDecimal(new Decimal("0.00255"), { decimals: 4 })).toBe("$0.0025");
    expect(formatDecimal(new Decimal("0.00255"), { decimals: 4, symbol: "" })).toBe("0.0025");
  });

  it("groups thousands and keeps the same convention across the separator", () => {
    expect(formatDecimal(new Decimal("1234567.899"))).toBe("$1,234,567.89");
    expect(formatDecimal(new Decimal("1234567.899"), { grouped: false })).toBe("$1234567.89");
  });

  it("never rounds a figure UP to the next unit", () => {
    // The direction that matters: $9.999 must not read as $10.00 on a screen
    // one click from a withdrawal the chain would refuse.
    expect(formatDecimal(new Decimal("9.999"))).toBe("$9.99");
  });
});

describe("the display rule — two decimals, more only when the value has them", () => {
  const usd = (amount: string) => ({ amount, asset: "x", decimals: 6 });

  it("writes an ordinary amount like every other figure", () => {
    expect(formatMoney(usd("350000"))).toBe("$0.35");
    expect(formatMoney(usd("1234567890"))).toBe("$1,234.56");
    expect(formatMoney(usd("10000"))).toBe("$0.01");
  });

  it("never lets a sub-cent amount read as $0.00", () => {
    expect(formatMoney(usd("1"))).toBe("$0.000001");
    expect(formatMoney(usd("5000"))).toBe("$0.005");
    expect(formatMoney(usd("9999"))).toBe("$0.009999");
  });

  it("keeps zero and nothing as plain zero", () => {
    expect(formatMoney(usd("0"))).toBe("$0.00");
    expect(formatMoney(null)).toBe("$0.00");
    expect(formatMoney(null, { decimals: 4 })).toBe("$0.00");
    expect(formatMoney(usd("0"), { decimals: 4 })).toBe("$0.00");
  });

  it("treats `decimals` as the most it may show, dropping trailing zeros past two", () => {
    expect(formatMoney(usd("2500000"), { decimals: 4 })).toBe("$2.50");
    expect(formatMoney(usd("12000"), { decimals: 4 })).toBe("$0.012");
    expect(formatMoney(usd("1600"), { decimals: 4 })).toBe("$0.0016");
    expect(formatMoney(usd("900"), { decimals: 6 })).toBe("$0.0009");
    expect(formatMoney(usd("6000000"), { decimals: 6 })).toBe("$6.00");
  });

  it("writes the exact ledger figure for exports when asked", () => {
    expect(formatMoney(usd("1500"), { exact: true, decimals: 6, symbol: "", grouped: false })).toBe("0.001500");
    expect(formatMoney(usd("0"), { exact: true, decimals: 6, symbol: "" })).toBe("0.000000");
  });

  it("keeps a sub-cent value non-zero even at the default two decimals", () => {
    expect(formatMoney(usd("1600"))).toBe("$0.0016");
    expect(formatMoney(usd("12000"))).toBe("$0.01");
  });
});

describe("parseAmountInput", () => {
  it("accepts a plain amount and converts it", () => {
    expect(parseAmountInput("20.5", { decimals: 6 })).toMatchObject({ atomic: "20500000", error: null });
    expect(parseAmountInput("1,000", { decimals: 6 }).atomic).toBe("1000000000");
  });

  it("refuses in one sentence", () => {
    expect(parseAmountInput("", { decimals: 6 }).error).toBe("Enter an amount.");
    expect(parseAmountInput("", { decimals: 6, required: false }).error).toBeNull();
    expect(parseAmountInput("1.2.3", { decimals: 6 }).error).toBe("Enter an amount like 20 or 20.50.");
    expect(parseAmountInput("0", { decimals: 6 }).error).toBe("Enter an amount above zero.");
    expect(parseAmountInput("0.0000001", { decimals: 6 }).error).toBe("Use at most 6 decimal places.");
    expect(parseAmountInput("4", { decimals: 6, min: "5" }).error).toBe("The minimum is $5.00.");
    expect(parseAmountInput("60", { decimals: 6, max: "50" }).error).toBe("The most you can use here is $50.00.");
  });
});

describe("splitForDisplay", () => {
  const usd = (amount: string) => ({ amount, asset: "eip155:1/erc20:0x1", decimals: 6 });

  it("gives the lost cent to the part that lost the most, so the parts add up", () => {
    // $28.47 at 60 / 30 / 10: 17.082, 8.541, 2.847.
    expect(splitForDisplay([usd("17082000"), usd("8541000"), usd("2847000")]).map((m) => m.amount)).toEqual([
      "17080000",
      "8540000",
      "2850000",
    ]);
    // $3.75: 2.25, 1.125, 0.375 — a tie goes to the first: 2.25 + 1.13 + 0.37.
    expect(splitForDisplay([usd("2250000"), usd("1125000"), usd("375000")]).map((m) => m.amount)).toEqual([
      "2250000",
      "1130000",
      "370000",
    ]);
  });

  it("leaves exact parts alone", () => {
    expect(splitForDisplay([usd("1000000"), usd("2000000")]).map((m) => m.amount)).toEqual(["1000000", "2000000"]);
    expect(splitForDisplay([])).toEqual([]);
  });
});
