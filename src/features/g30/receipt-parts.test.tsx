import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NotChargedHeadline } from "./receipt-parts";

/* fe-followup M2 (lot 1 E18): a call that never held money shows no "Not charged" amount. */
describe("NotChargedHeadline", () => {
  const base = { headline: "Not charged. This call did not run.", listed: "$0.01", paid: "$0.00", failedChecks: false };

  it("leaves the Not charged box out when there is nothing to not charge", () => {
    const html = renderToStaticMarkup(<NotChargedHeadline {...base} notCharged={null} />);
    expect(html).toContain("Listed price");
    expect(html).not.toContain(">Not charged<");
  });

  it("keeps it for a released hold", () => {
    const html = renderToStaticMarkup(<NotChargedHeadline {...base} notCharged="$0.01" />);
    expect(html).toContain(">Not charged<");
  });
});
