import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { OperatorIdentity } from "@/interfaces/operator";

import type { OperatorToolSummary } from "@/interfaces/contracts";

import { OperatorToolsTabs, ReviewChanges, ReviewedVersion, TakeDownButton, takedownSearch } from "./provider-tool-ui";
import { OperatorSessionContext } from "./session-context";

vi.mock("next/navigation", () => ({ usePathname: () => "/operator/tools/reviews", useRouter: () => ({ push: () => undefined }) }));

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const identity = (roles: OperatorIdentity["roles"]): OperatorIdentity => ({ id: "op-1", subject: "riley@", displayName: "Riley", walletAddress: null, roles, authorityLimit: null, status: "ACTIVE" });

describe("what the reviewer reads", () => {
  it("every word a model reads, with the schemas", () => {
    const words = text(
      renderToStaticMarkup(
        <ReviewedVersion
          version={{
            version: 1,
            semver: "1.0.0",
            major: 1,
            status: "ACTIVE",
            summary: "Search public posts by keyword.",
            description: "Returns up to 20 posts.",
            inputSchema: { type: "object", properties: { q: { type: "string" } } },
            outputSchema: { type: "object" },
            optionalInputFields: ["lang"],
            optionalOutputFields: [],
            examples: [{ arguments: { q: "rain" } }],
            rules: [],
            tier: "UNVERIFIED",
            changelog: null,
            sunsetAt: null,
            publishedAt: null,
            isCurrent: true,
            approved: false,
          }}
        />,
      ),
    );
    expect(words).toContain("Search public posts by keyword.");
    expect(words).toContain("INPUT SCHEMA");
    expect(words).toContain('"q"');
    expect(words).toContain("Optional inputs: lang");
    expect(words).toContain("Examples (1)");
  });

  it("a change, as the diff against the approved version", () => {
    const words = text(renderToStaticMarkup(<ReviewChanges changes={[{ kind: "FIELD_ADDED_OPTIONAL", side: "output", field: "lang", bump: "MINOR", detail: "optional output field lang added" }]} />));
    expect(words).toContain("Addition");
    expect(text(renderToStaticMarkup(<ReviewChanges changes={[]} />))).toContain("only text changed");
  });
});

describe("Tools tabs", () => {
  it("show the reviews tab as current, and only what the role can use", () => {
    const html = renderToStaticMarkup(
      <OperatorSessionContext.Provider value={identity(["ADJ"])}>
        <OperatorToolsTabs />
      </OperatorSessionContext.Provider>,
    );
    expect(text(html)).toContain("Reviews");
    expect(text(html)).toContain("Takedowns");
    expect(text(html)).toContain("Standard tools (read only)");
    expect(html).toContain('aria-current="page"');
  });
});

describe("taking a provider tool down without a review (B12, D24)", () => {
  const tool = (name: string, kind: OperatorToolSummary["kind"], status: OperatorToolSummary["status"] = "ACTIVE"): OperatorToolSummary => ({
    id: `id-${name}`,
    name,
    kind,
    category: "weather",
    tags: [],
    status,
    currentSemver: "1.0.0",
    currentVersion: 1,
    hasDraft: false,
  });
  const tools = [tool("acme_weather", "PROVIDER"), tool("get_weather", "STANDARD"), tool("old_weather", "PROVIDER", "REMOVED"), tool("draft_weather", "PROVIDER", "DRAFT")];

  it("finds live provider tools only, and names the standard tools it will not offer", () => {
    const found = takedownSearch(tools, "weather");
    expect(found.matches.map((t) => t.name)).toEqual(["acme_weather"]);
    expect(found.standard.map((t) => t.name)).toEqual(["get_weather"]);
    expect(takedownSearch(tools, "  ")).toEqual({ matches: [], standard: [] });
  });

  const button = (roles: OperatorIdentity["roles"], t: OperatorToolSummary) =>
    text(
      renderToStaticMarkup(
        <QueryClientProvider client={new QueryClient()}>
          <OperatorSessionContext.Provider value={identity(roles)}>
            <TakeDownButton tool={t} />
          </OperatorSessionContext.Provider>
        </QueryClientProvider>,
      ),
    );

  it("offers Take down only to the roles the endpoint accepts, and only on a live provider tool", () => {
    expect(button(["SRE"], tools[0]!)).toContain("Take down");
    expect(button(["ADJ"], tools[0]!)).toContain("Take down");
    expect(button(["POL", "TRE", "SUP"], tools[0]!)).toBe("");
    expect(button(["ADJL"], tools[1]!)).toBe("");
    expect(button(["ADJL"], tools[2]!)).toBe("");
  });
});
