import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WhatHappensIfYouDoNothing, WhatHappensNext, WhatIsNotHappening } from "./assurances";
import { caseChainStageOf } from "./chain-stage";
import { DISPUTED_CLOCKS, UPHELD_CLOCKS, caseOf, textOf } from "./fixtures/r13-case";
import { StatusHeader } from "./status-header";

/*
  The provider case screen's text in each on-chain state of the R13 test:
  rendered markup, read as text, because the defects were sentences.
*/

const render = (node: React.ReactElement) => textOf(renderToStaticMarkup(node));

describe("a fresh case, record pending on chain", () => {
  const data = caseOf("PROPOSED");

  it("dates execution at the chain's executableAt, not Assay's earlier promise", () => {
    const header = render(<StatusHeader data={data} />);
    expect(header).toContain("Executes 2026-10-15 09:37 UTC");
    expect(header).not.toContain("08:36 UTC never");
    expect(render(<WhatHappensIfYouDoNothing data={data} />)).toContain(
      "On 2026-10-15 09:37 UTC the penalty is taken from stake",
    );
    expect(render(<WhatIsNotHappening data={data} />)).toContain(
      "The earliest anything can execute is 2026-10-15 09:37 UTC",
    );
  });

  it("counts down to the record's executableAt, the one deadline to dispute on chain", () => {
    const header = render(<StatusHeader data={data} />);
    expect(header).toContain("Dispute on chain by 2026-10-15 09:37 UTC");
    expect(header).toContain("1h 0m remaining");
    expect(header).toContain("disputing freezes the penalty on chain until the arbiter decides");
    expect(header).not.toContain("Respond by");
    expect(header).toContain("On chain: Pending on chain");
  });

  it("keeps the in-app response window on a Solana case", () => {
    const header = render(<StatusHeader data={caseOf("PROPOSED", { disputeOnChain: false })} />);
    expect(header).toContain("Respond by 2026-10-17 08:36 UTC");
    expect(header).toContain("1h 0m remaining");
  });
});

// BUG-R16-V4-01: "still above your $0.00 minimum" when no requirement was computed.
describe("what happens if you do nothing, with no known minimum", () => {
  it("names the minimum when there is one", () => {
    expect(render(<WhatHappensIfYouDoNothing data={caseOf("PROPOSED")} />)).toContain(
      "still above your $0.50 minimum",
    );
  });

  it("does not claim a $0.00 minimum", () => {
    const data = caseOf("PROPOSED");
    const zero = {
      ...data,
      inaction: { ...data.inaction, minimumRequired: { ...data.inaction.minimumRequired, amount: "0" } },
    };
    const text = render(<WhatHappensIfYouDoNothing data={zero} />);
    expect(text).not.toMatch(/minimum/);
    expect(text).toContain("and no grace period opens because of it.");
  });
});

describe("a partly disputed case (review N-4)", () => {
  it("still offers the dispute of the parts nobody disputed, whatever the case status", () => {
    const data = caseOf("UPHELD", {
      chainStatus: "PENDING",
      chainDisputedAt: "2026-10-15T08:58:08.000Z",
      chainDisputedParts: 1,
      chainState: "DISPUTED",
      disputeBy: "2026-10-15T09:37:00.000Z",
      runningClock: "PROVIDER",
      secondsRemaining: 3600,
    });
    const header = render(<StatusHeader data={data} />);
    expect(header).toContain("Dispute on chain by 2026-10-15 09:37 UTC");
    expect(header).not.toContain("past the point of a dispute");
  });

  it("says the dispute is over once no record can be disputed", () => {
    const data = caseOf("UPHELD", { chainState: "PENDING", disputeBy: null, runningClock: "NONE" });
    expect(render(<StatusHeader data={data} />)).toContain("past the point of a dispute");
  });
});

describe("a case disputed on chain (R13 id3)", () => {
  const data = caseOf("DISPUTED", DISPUTED_CLOCKS, { disputeId: "d1" });
  const stage = caseChainStageOf(data.proposal.clocks);

  it("replaces Respond by and Executes with the arbiter's wait", () => {
    const header = render(<StatusHeader data={data} />);
    expect(header).not.toContain("Respond by");
    expect(header).not.toContain("remaining");
    expect(header).toContain("Awaiting Assay's arbiter 2026-11-14 08:58 UTC");
    expect(header).toContain("disputed on chain 2026-10-15 08:58 UTC");
    expect(header).toContain("Not while disputed");
    expect(header).not.toContain("even if you do nothing");
    expect(header).toContain("On chain: Disputed on chain — awaiting arbiter");
  });

  it("states what happens next and every outcome, with no do-nothing text", () => {
    expect(stage.kind).toBe("disputed");
    if (stage.kind === "open") return;
    const next = render(<WhatHappensNext data={data} stage={stage} />);
    expect(next).toContain("What happens next");
    expect(next).toContain("You disputed this penalty on chain on 2026-10-15 08:58 UTC");
    expect(next).toContain("If the arbiter upholds it");
    expect(next).toContain("If the arbiter cancels it");
    expect(next).toContain("From 2026-11-14 08:58 UTC, 30 days after the dispute, anyone can expire it");
    expect(next).not.toMatch(/do nothing/i);
  });

  it("promises nothing executes while the dispute stands, not a past date", () => {
    const claims = render(<WhatIsNotHappening data={data} />);
    expect(claims).toContain("Nothing executes while your on-chain dispute stands");
    expect(claims).not.toContain("08:36");
  });
});

describe("a case upheld after the on-chain dispute (R13 id1)", () => {
  const data = caseOf("DISPUTED", UPHELD_CLOCKS, { disputeId: "d1" });
  const stage = caseChainStageOf(data.proposal.clocks);

  it("says the dispute was upheld and when the record can be executed", () => {
    const header = render(<StatusHeader data={data} />);
    expect(header).toContain("Dispute Upheld");
    expect(header).toContain("a penalty can be disputed on chain only once");
    expect(header).toContain("Can be executed from 2026-10-15 09:37 UTC");
    expect(header).not.toContain("Respond by");
    expect(header).toContain("On chain: Upheld by Assay's arbiter");
  });

  it("states the next step instead of the do-nothing text", () => {
    expect(stage.kind).toBe("upheld");
    if (stage.kind === "open") return;
    const next = render(<WhatHappensNext data={data} stage={stage} />);
    expect(next).toContain("your dispute was upheld by Assay's arbiter");
    expect(next).toContain("it cannot be disputed again");
    expect(next).toContain("From 2026-10-15 09:37 UTC anyone can execute it");
    expect(next).not.toMatch(/do nothing/i);
  });
});
