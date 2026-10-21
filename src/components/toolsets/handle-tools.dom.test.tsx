import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { HandleTools } from "./public-toolsets";

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: true, authenticated: false }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/toolsets/handle" }));

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

describe("a public name's own tools", () => {
  it("lists each LISTED tool with its tier, and says one maker serves it", () => {
    const html = renderToStaticMarkup(
      <HandleTools
        handle="acme"
        tools={[
          { id: "t1", name: "acme__search_posts", summary: "Search public posts.", category: "social", tags: [], tier: "VERIFIED", version: "1.2.0", kind: "PROVIDER", reviewed: true, replacementName: null },
          { id: "t2", name: "acme__trends", summary: "Trending topics.", category: "social", tags: [], tier: "UNVERIFIED", version: "1.0.0", kind: "PROVIDER", reviewed: false, replacementName: "get_trends" },
        ]}
      />,
    );
    const words = text(html);
    expect(words).toContain("Tools by @acme · 2");
    expect(words).toContain("no backup provider");
    expect(words).toContain("acme__search_posts Verified");
    expect(words).toContain("acme__trends Unverified Not reviewed");
    expect(words).toContain("now also a standard tool with backups: get_trends");
    expect(html).toContain('href="/catalogue/view?tool=t1"');
  });
});
