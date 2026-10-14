import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SlashProposalClocks } from "@/interfaces/provider-disputes";

import { CaseClosed, WhatIsNotHappening } from "./assurances";
import {
  caseStageOf,
  mayAcknowledge,
  respondByApplies,
  type ClosedOutcome,
} from "./chain-stage";
import {
  DISPUTED_CLOCKS,
  UPHELD_CLOCKS,
  caseOf,
  textOf,
} from "./fixtures/r13-case";
import { StatusHeader, statusChipOf } from "./status-header";

/*
  BUG-R13-D-02: a case closed on chain (id2, cancelled by the arbiter) still
  showed "Respond by", "Executes … even if you do nothing" and Acknowledge.
  Every terminal state must read as closed: no deadline, no execution date,
  no action.
*/

const render = (node: React.ReactElement) => textOf(renderToStaticMarkup(node));
const EXECUTED_AT = "2026-10-15T09:40:00.000Z";

interface Terminal {
  name: string;
  status: string;
  clocks: Partial<SlashProposalClocks>;
  executedAt?: string;
  outcome: ClosedOutcome;
  chip: string;
  says: string;
}

const TERMINAL: readonly Terminal[] = [
  {
    name: "cancelled on chain by the arbiter (R13 id2)",
    status: "CANCELLED",
    clocks: {
      ...DISPUTED_CLOCKS,
      chainStatus: "CANCELLED",
      chainDisputedParts: 0,
    },
    outcome: "released",
    chip: "CANCELLED",
    says: "the reserved stake is released, and nothing is taken",
  },
  {
    name: "expired on chain while the case status has not caught up",
    status: "DISPUTED",
    clocks: {
      ...DISPUTED_CLOCKS,
      chainStatus: "CANCELLED",
      chainDisputedParts: 0,
    },
    outcome: "released",
    chip: "CANCELLED",
    says: "cancelled or expired",
  },
  {
    name: "executed",
    status: "EXECUTED",
    clocks: { chainStatus: "EXECUTED" },
    executedAt: EXECUTED_AT,
    outcome: "executed",
    chip: "EXECUTED",
    says: "executed on chain on 2026-10-15 09:40 UTC and taken from your stake",
  },
  {
    name: "executed on chain before the case status caught up",
    status: "UPHELD",
    clocks: { chainStatus: "EXECUTED" },
    outcome: "executed",
    chip: "EXECUTED",
    says: "The penalty was executed on chain",
  },
  {
    name: "overturned",
    status: "OVERTURNED",
    clocks: { chainStatus: "CANCELLED" },
    outcome: "overturned",
    chip: "OVERTURNED",
    says: "overturned the penalty in your favour",
  },
  {
    name: "compensated",
    status: "REVERSED",
    clocks: { chainStatus: "EXECUTED" },
    executedAt: EXECUTED_AT,
    outcome: "compensated",
    chip: "COMPENSATED",
    says: "deposited it back into your stake",
  },
  {
    name: "waived",
    status: "WAIVED",
    clocks: { chainStatus: "NONE", chainExecutableAt: null },
    outcome: "waived",
    chip: "WAIVED",
    says: "waived and nothing is taken",
  },
];

describe.each(TERMINAL)("a closed case: $name", (t) => {
  const data = caseOf(t.status, t.clocks, { executedAt: t.executedAt ?? null });
  const stage = caseStageOf(data.proposal);

  it("is closed with its outcome, and offers no deadline or action", () => {
    expect(stage).toMatchObject({ kind: "closed", outcome: t.outcome });
    expect(respondByApplies(data.proposal, stage)).toBe(false);
    expect(mayAcknowledge(data.proposal, stage)).toBe(false);
  });

  it("shows no respond-by deadline and no future execution date in the header", () => {
    const header = render(<StatusHeader data={data} />);
    expect(header).not.toContain("Respond by");
    expect(header).not.toContain("remaining");
    expect(header).not.toContain("even if you do nothing");
    expect(header).not.toContain("Executes");
    expect(header).toContain("Case Closed");
    expect(header).toContain(t.chip);
  });

  it("says what happened and that there is nothing to do", () => {
    if (stage.kind !== "closed") throw new Error("not closed");
    const panel = render(<CaseClosed stage={stage} />);
    expect(panel).toContain("Case closed");
    expect(panel).toContain(t.says);
    expect(panel).toContain("There is no deadline and nothing for you to do.");
    expect(panel).not.toMatch(/do nothing/i);
  });

  it("makes no promise about an execution that will not happen", () => {
    const claims = render(<WhatIsNotHappening data={data} />);
    expect(claims).not.toContain("Nothing executes before");
  });
});

describe("a closed case whose on-chain record still stands", () => {
  it("is closed, and says the record stands until its cancel lands", () => {
    const data = caseOf("OVERTURNED", { chainStatus: "CANCEL_REQUESTED" });
    const stage = caseStageOf(data.proposal);
    expect(stage).toMatchObject({
      kind: "closed",
      outcome: "overturned",
      recordStanding: true,
    });
    if (stage.kind !== "closed") return;
    expect(render(<CaseClosed stage={stage} />)).toContain(
      "still stands until its cancellation lands",
    );
  });
});

describe("the executed figure of an executed case", () => {
  it("shows when it was executed, not when it could be", () => {
    const header = render(
      <StatusHeader
        data={caseOf(
          "EXECUTED",
          { chainStatus: "EXECUTED" },
          { executedAt: EXECUTED_AT },
        )}
      />,
    );
    expect(header).toContain("Executed 2026-10-15 09:40 UTC");
    expect(header).not.toContain("09:37");
  });

  it("says no execution for a case that took nothing", () => {
    const header = render(
      <StatusHeader
        data={caseOf("OVERTURNED", { chainStatus: "CANCELLED" })}
      />,
    );
    expect(header).toContain("Execution None");
  });
});

describe("the status chip follows the chain state", () => {
  it("reads UPHELD for an upheld record although the case still says DISPUTED (R13 id1)", () => {
    const data = caseOf("DISPUTED", UPHELD_CLOCKS, { disputeId: "d1" });
    expect(statusChipOf("DISPUTED", caseStageOf(data.proposal)).label).toBe(
      "UPHELD",
    );
    const header = render(<StatusHeader data={data} />);
    expect(header).toContain("UPHELD");
    expect(header).not.toContain("DISPUTED ");
  });

  it("keeps the case's own status while the chain has nothing further to say", () => {
    expect(
      statusChipOf(
        "DISPUTED",
        caseStageOf(caseOf("DISPUTED", DISPUTED_CLOCKS).proposal),
      ).label,
    ).toBe("DISPUTED");
    expect(
      statusChipOf("PROPOSED", caseStageOf(caseOf("PROPOSED").proposal)).label,
    ).toBe("BREACH PROPOSED");
  });
});

describe("cases that are not closed stay open", () => {
  it.each([
    "PROPOSED",
    "DISPUTED",
    "UNDER_REVIEW",
    "AWAITING_SECOND",
    "UPHELD",
    "EXECUTING",
  ])("%s with a pending record", (status) => {
    expect(caseStageOf(caseOf(status).proposal).kind).toBe("open");
  });
});
