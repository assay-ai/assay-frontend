import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EntryRow, RuleEditor } from "@/components/toolsets/toolset-editor";
import { briefOf, demoVersionFields, demoVersionList, WEATHER_TOOL_ID } from "@/libs/demo/fixtures-contracts";
import type { ToolsetEntryInput } from "@/services/toolsets.service";

import { ToolContractSection, ToolContractView } from "./tool-contract";
import { DeprecatedBadge, RetiredBadge, ToolVersionBadges, VersionChip } from "./version-badges";

const SUNSET = "2027-02-01T00:00:00.000Z";

function client(seed: (c: QueryClient) => void = () => undefined): QueryClient {
  const c = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  c.setQueryData(["tool-calls", "catalogue"], { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  seed(c);
  return c;
}

function render(node: React.ReactNode, seed?: (c: QueryClient) => void): string {
  return renderToStaticMarkup(<QueryClientProvider client={client(seed)}>{node}</QueryClientProvider>);
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const weather = () => demoVersionList(WEATHER_TOOL_ID, "get_weather");
const seedWeather = (c: QueryClient) => c.setQueryData(["catalogue", "tool-versions", "signed-in", WEATHER_TOOL_ID], weather());

describe("version badges", () => {
  it("deprecated: the last day in UTC with its year, and what to use instead", () => {
    const out = text(renderToStaticMarkup(<DeprecatedBadge label="v1" sunsetAt={SUNSET} replacement="v2.0.0" />));
    expect(out).toContain("v1 Deprecated · stops on Feb 1, 2027 (UTC) · use v2.0.0");
  });
  it("retired names the replacement; the version chip is a plain v2.0.0", () => {
    expect(text(renderToStaticMarkup(<RetiredBadge replacement="v2.0.0" />))).toContain("Retired · use v2.0.0");
    expect(text(renderToStaticMarkup(<VersionChip semver="2.0.0" />))).toContain("v2.0.0");
    expect(renderToStaticMarkup(<VersionChip semver={null} />)).toBe("");
  });
  it("a card: the current version and one badge per older version on its way out", () => {
    const fields = demoVersionFields(WEATHER_TOOL_ID, "get_weather", "");
    const out = text(renderToStaticMarkup(<ToolVersionBadges version={fields.version} versions={fields.versions} deprecatedMajors={fields.deprecatedMajors} />));
    expect(out).toContain("v2.0.0");
    expect(out).toMatch(/v1 Deprecated · stops on \w{3} \d{1,2}, \d{4} \(UTC\) · use v2\.0\.0/);
    expect(out).not.toMatch(/DEPRECATED|MAJOR/);
  });
  it("no version from an older backend: nothing", () => {
    expect(renderToStaticMarkup(<ToolVersionBadges />)).toBe("");
  });
});

describe("Versions and fields on a tool page", () => {
  it("what agents get, the older version and its sunset, the extra fields and the changelog newest first", () => {
    const out = text(render(<ToolContractSection toolId={WEATHER_TOOL_ID} />, seedWeather));
    expect(out).toContain("Agents get this version unless they lock another one.");
    expect(out).toMatch(/Version 1 stops working on \w{3} \d{1,2}, \d{4} \(UTC\)\. Use v2\.0\.0 instead\./);
    expect(out).toContain("Extra fields it can return uv_index");
    expect(out).toContain("Extra inputs it can take units");
    const order = ["2.0.0", "1.1.0", "1.0.0"].map((v) => out.indexOf(`v${v} `));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(out).toContain("temperature is now temperature_c");
    expect(out).toContain("Current");
  });
  it("loading: a skeleton, not an empty list", () => {
    const html = render(<ToolContractSection toolId="nope" />);
    expect(html).toContain('role="status"');
    expect(text(html)).toContain("Loading the versions");
  });
  it("failed: says so and offers Try again", () => {
    const query = { isPending: false, isError: true, error: new Error("down"), data: undefined, refetch: () => Promise.resolve({} as never) };
    const out = text(render(<ToolContractView query={query} />));
    expect(out).toContain("Couldn't load the versions");
    expect(out).toContain("Try again");
  });
  it("a tool with no extra fields hides that part", () => {
    const list = weather();
    const plain = { ...list, versions: list.versions.map((v) => ({ ...v, optionalInputFields: [], optionalOutputFields: [] })) };
    const out = text(render(<ToolContractSection toolId={WEATHER_TOOL_ID} />, (c) => c.setQueryData(["catalogue", "tool-versions", "signed-in", WEATHER_TOOL_ID], plain)));
    expect(out).not.toContain("Extra fields");
  });
});

const ROW: ToolsetEntryInput & { toolName: string } = {
  toolId: WEATHER_TOOL_ID,
  toolName: "get_weather",
  providerMode: "BEST",
  providerIds: [],
  minTier: null,
  maxPrice: null,
  minQuality: null,
  onEmpty: "FAIL",
  toolVersionRange: "^1",
  requireOutputFields: ["uv_index"],
};

const noop = () => undefined;

describe("the tool set row: Must return and Contract version", () => {
  const briefs = weather().versions.map(briefOf);

  it("one chip carries the provider rule, Must return and the version; a deprecated-only row warns with Allow v2", () => {
    const out = text(
      render(
        <ul>
          <EntryRow row={ROW} decimals={6} asset="" providers={[]} versions={briefs} open={false} onToggle={noop} onApply={noop} onRange={noop} onRemove={noop} saving={false} />
        </ul>,
      ),
    );
    expect(out).toContain("Providers: Any (Assay picks) · Must return: uv_index · tool v1 only");
    expect(out).toMatch(/Uses v1, which stops working on \w{3} \d{1,2}, \d{4} \(UTC\)\./);
    expect(out).toContain("Allow v2");
  });

  it("a row on the current version shows no version and no warning", () => {
    const out = text(
      render(
        <ul>
          <EntryRow row={{ ...ROW, toolVersionRange: "^2", requireOutputFields: [] }} decimals={6} asset="" providers={[]} versions={briefs} open={false} onToggle={noop} onApply={noop} onRange={noop} onRemove={noop} saving={false} />
        </ul>,
      ),
    );
    expect(out).toContain("Providers: Any (Assay picks)");
    expect(out).not.toMatch(/v1 only|v2 only|Uses v/);
  });

  it("the editor offers the extra fields of the versions in range, ticked as saved, and the versions as an advanced setting", () => {
    const html = render(<RuleEditor row={ROW} decimals={6} asset="" providers={[]} versions={briefs} onApply={noop} onCancel={noop} saving={false} />, seedWeather);
    const out = text(html);
    expect(out).toContain("Must return");
    expect(out).toContain("uv_index");
    expect(out).toContain("Only providers that return uv_index serve these calls, so fewer may fit.");
    expect(out).toContain("Advanced · Contract version: v1 only");
    expect(out).toContain("v2 (latest 2.0.0) · current");
    expect(out).toMatch(/v1 \(latest 1\.1\.0\) · stops on \w{3} \d{1,2}, \d{4} \(UTC\)/);
    // A row on a deprecated version opens the advanced setting by itself.
    expect(html).toMatch(/<details[^>]*open=""/);
    expect(out).not.toMatch(/MAJOR|DEPRECATED|requireOutputFields|toolVersionRange/);
  });

  it("a tool with no extra fields hides Must return", () => {
    const list = weather();
    const plain = { ...list, versions: list.versions.map((v) => ({ ...v, optionalOutputFields: [] })) };
    const html = render(
      <RuleEditor row={{ ...ROW, toolVersionRange: "^2", requireOutputFields: [] }} decimals={6} asset="" providers={[]} versions={briefs} onApply={noop} onCancel={noop} saving={false} />,
      (c) => c.setQueryData(["catalogue", "tool-versions", "signed-in", WEATHER_TOOL_ID], plain),
    );
    expect(html).not.toContain('data-testid="must-return"');
    expect(html).not.toMatch(/<details[^>]*open=""/);
  });

  it("while the fields load it says so", () => {
    const out = text(render(<RuleEditor row={ROW} decimals={6} asset="" providers={[]} versions={briefs} onApply={noop} onCancel={noop} saving={false} />));
    expect(out).toContain("Loading this tool's extra fields…");
  });
});
