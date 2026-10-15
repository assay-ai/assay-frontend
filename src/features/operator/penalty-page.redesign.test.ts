import { describe, expect, it } from "vitest";

import type { OperatorRole } from "@/interfaces/operator";

import { shortWhyNot } from "./case-flow";
import { breachVerdict } from "./operator-measurement";
import { moneyHeading, stakeReduction } from "./penalty-money";

const USD = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x1", decimals: 6 });

describe("the penalty page's money card", () => {
  it("is 'If upheld' until money moves, then 'Moved'", () => {
    expect(moneyHeading("disputed", "$28.47")).toMatchObject({ title: "If upheld", split: true });
    expect(moneyHeading("window-open", "$28.47").meta).toBe("Reserved in the provider's stake. Nothing has moved yet.");
    expect(moneyHeading("executed", "$3.75")).toMatchObject({ title: "Moved", split: true });
  });

  it("draws no split once nothing will be taken", () => {
    expect(moneyHeading("cancelled", "$7.20")).toMatchObject({ title: "Nothing taken", split: false });
    expect(moneyHeading("compensated", "$4.10")).toMatchObject({ title: "Paid back", split: false });
    expect(moneyHeading("cancel-requested", "$9.10").meta).toMatch(/the reserved \$9\.10 goes back to the provider once the arbiter signs/);
  });

  it("takes agents plus platform from the stake, never the provider's own share", () => {
    expect(stakeReduction(USD("28470000"), 6000)).toEqual(USD("25623000"));
    expect(stakeReduction(USD("28470000"), null)).toBeNull();
  });
});

describe("the measurement's verdict", () => {
  it("leads with the breach in one line", () => {
    expect(
      breachVerdict([
        { key: "observed_rate", value: "12.62%" },
        { key: "effective_threshold", value: "6.81%" },
      ]),
    ).toBe("Breach: 12.62% failed vs 6.81% allowed");
  });

  it("says nothing without both figures", () => {
    expect(breachVerdict([{ key: "observed_rate", value: "12.62%" }])).toBeNull();
  });
});

describe("a refused action in one line", () => {
  const support = { roles: ["SRE", "SUP"] as OperatorRole[], authorityLimit: USD("0") };
  const adjudicator = { roles: ["ADJ"] as OperatorRole[], authorityLimit: USD("100000000") };

  it("names the $0 limit and who to ask", () => {
    expect(shortWhyNot(support, "suspend", USD("28470000"), ["Jordan Blake"])).toBe("Your limit is $0 · Ask Jordan Blake");
  });

  it("names a limit below the penalty", () => {
    expect(shortWhyNot(adjudicator, "suspend", USD("412000000"), null)).toBe("Above your $100.00 limit");
  });

  it("names the role a ruling needs", () => {
    expect(shortWhyNot(support, "rule", null, null)).toMatch(/^Needs /);
  });

  it("is nothing when allowed", () => {
    expect(shortWhyNot(adjudicator, "suspend", USD("28470000"), [])).toBeNull();
  });
});
