import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ProviderLoading from "./loading";

/* Onboarding run 3: "Create your first tool listing" and "Publish your API" left the old page up for seconds. */
describe("provider console route loading", () => {
  it("answers a click at once, with a visible line and a status for screen readers", () => {
    const html = renderToStaticMarkup(<ProviderLoading />);
    expect(html).toContain("Opening the page…");
    expect(html).toContain('role="status"');
    expect(html).toContain("Opening the page</span>");
  });
});
