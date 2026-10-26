import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LIST_YOUR_API } from "./entry";
import { ProviderEntryView } from "./entry-card";

describe("ProviderEntryView", () => {
  it("invites a buyer to list an API", () => {
    const html = renderToStaticMarkup(<ProviderEntryView entry={LIST_YOUR_API} />);
    expect(html).toContain("Have an API? List it on Assay and get paid per call.");
    // Live without a wait; only the public catalogue is reviewed (onboarding run 3).
    expect(html).toContain("Live in about five minutes. Listing your own API in the public catalogue is reviewed by Assay.");
    expect(html).not.toContain("no review queue");
    expect(html).toMatch(/<a[^>]*href="\/provider\/setup"[^>]*>List your API<\/a>/);
  });

  it("is one quiet link for a provider", () => {
    const html = renderToStaticMarkup(<ProviderEntryView entry={{ provider: true, label: "Provider console", href: "/provider" }} />);
    expect(html).not.toContain("Have an API?");
    expect(html).toMatch(/href="\/provider"/);
    expect(html).toContain("Provider console");
  });

  it("renders nothing while unknown", () => {
    expect(renderToStaticMarkup(<ProviderEntryView entry={null} />)).toBe("");
  });
});
