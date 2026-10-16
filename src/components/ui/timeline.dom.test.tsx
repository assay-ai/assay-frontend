import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Timeline } from "./timeline";

/*
  verify-r13 P3: in the receipt's 400px card a row with a dated stamp
  ("Sep 15, 08:40:00"), a fixed 180px label column and the meta ran 3px past
  the card, clipping "$2.50". The row now wraps instead: no fixed column, the
  meta never shrinks below its text and moves to its own line when it must.
*/
describe("Timeline", () => {
  const html = renderToStaticMarkup(
    <Timeline
      events={[
        { time: "Sep 15, 08:40:00", label: "Money held", meta: "$2.50", tone: "primary" },
        { time: "Sep 15, 08:41:00", label: "Result checked" },
      ]}
    />,
  );

  it("wraps a row rather than letting it overflow its card", () => {
    const rows = html.split("<li").slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const rowClass = /class="([^"]*)"/.exec(row)![1]!;
      expect(rowClass.split(" ")).toContain("flex-wrap");
      expect(rowClass).not.toContain("flex-nowrap");
    }
    expect(html).not.toMatch(/w-\[180px\]/);
  });

  it("keeps the amount whole, at the end of the row", () => {
    const meta = /<span[^>]*data-slot="timeline-meta"[^>]*class="([^"]*)"[^>]*>\$2\.50<\/span>/.exec(html)
      ?? /<span[^>]*class="([^"]*)"[^>]*data-slot="timeline-meta"[^>]*>\$2\.50<\/span>/.exec(html);
    expect(meta).not.toBeNull();
    const classes = meta![1]!.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["shrink-0", "ml-auto", "max-w-full"]));
  });

  it("reads each event in one line for a screen reader", () => {
    expect(html).toContain("Sep 15, 08:40:00 — Money held: $2.50");
    expect(html).toContain("Sep 15, 08:41:00 — Result checked");
  });
});
