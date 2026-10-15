import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let query = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => query }));

import { RecordGate } from "./record-gate";

function render(): string {
  return renderToStaticMarkup(
    <RecordGate param="id" record="receipt" backHref="/spend" backLabel="Back to spend">
      <p>the receipt</p>
    </RecordGate>,
  );
}

// BUG-R16-B1-01: /receipts/view with no ?id= waited on "Loading receipt…" forever.
describe("RecordGate", () => {
  beforeEach(() => {
    query = new URLSearchParams();
  });

  it("says no record is selected when the id is missing", () => {
    const html = render();
    expect(html).toContain("No receipt selected");
    expect(html).toContain('href="/spend"');
    expect(html).not.toContain("the receipt");
  });

  it("renders the record screen when the id is there", () => {
    query = new URLSearchParams({ id: "d8598fc6" });
    expect(render()).toContain("the receipt");
  });
});
