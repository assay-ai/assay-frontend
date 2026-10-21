import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { InboxItem } from "@/app/(console)/provider/inbox/_components/inbox-item";
import type { EntryFix } from "@/features/toolsets/refused";
import { DEMO_FIXTURES } from "@/libs/demo/fixtures";
import { contractNotices, contractRefusedCalls } from "@/libs/demo/fixtures-refusals-contracts";
import type { RefusedCall, Toolset, ToolsetEntry } from "@/services/toolsets.service";

import { EntryGone, RefusedCallCard, runEntryFix } from "./refused-calls";
import { toolsetKeys } from "./use-toolsets";

function render(node: React.ReactNode): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["agents"], { items: [{ agentId: "a1", label: "research-bot" }], pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(toolsetKeys.all, { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const IDS = {
  agentId: "a1",
  toolsetId: "s-weather",
  providers: { helios: "p-helios", northwind: "p-north", quanta: "p-quanta" },
  name: (id: string) => ({ "p-helios": "Helios Data Labs", "p-north": "Northwind Geo", "p-quanta": "Quanta Signals" })[id] ?? null,
};
const CALLS = contractRefusedCalls(IDS);
const byId = (suffix: string) => CALLS.find((c) => c.callId.endsWith(suffix)) as RefusedCall;

describe("a T3 refused call, drawn", () => {
  it("Must return: the reason per provider and one Remove button for both", () => {
    const out = text(render(<RefusedCallCard call={byId("weather-uv")} />));
    expect(out).toContain("Doesn't return uv_index, and the tool set requires it");
    expect(out).toContain("Remove 'Must return: uv_index'");
    expect(out).toContain("for these 2 providers");
    expect(out).toContain("Nothing was charged.");
  });

  it("a contract version: Allow v2, said as a version, not as the buyer's limits", () => {
    const out = text(render(<RefusedCallCard call={byId("weather-v1")} />));
    expect(out).toContain("No provider serves this version of the tool yet.");
    expect(out).toContain("Serves only v2; this call uses v1");
    expect(out).toContain("Allow v2");
    expect(out).toContain("Contract version");
    expect(out).not.toMatch(/MIGRATION|CONTRACT_VERSION/);
  });

  it("an input nobody accepts: what the agent can do, and the agent-limit fix that brings one back", () => {
    const out = text(render(<RefusedCallCard call={byId("weather-units")} />));
    expect(out).toContain("No allowed provider supports units.");
    expect(out).toContain("Doesn't accept the input units this call sent");
    expect(out).toContain("Call without units");
    expect(out).toContain("See the inputs it accepts");
    expect(out).toContain("The call's own inputs");
    expect(out).not.toMatch(/REQUEST|UNSUPPORTED_INPUT_FIELD/);
  });
});

function set(entries: Partial<ToolsetEntry>[]): Toolset {
  return {
    id: "s-weather",
    name: "Weather and places",
    entries: entries.map((e, position) => ({
      position,
      toolId: "t-weather",
      toolName: "get_weather",
      category: "weather",
      providerMode: "BEST",
      providerIds: [],
      minTier: null,
      maxPrice: null,
      minQuality: null,
      onEmpty: "FAIL",
      ...e,
    })),
  } as unknown as Toolset;
}

describe("running a T3 fix (what the button does)", () => {
  const drop: EntryFix = { kind: "drop-required-field", toolsetId: "s-weather", toolId: "t-weather", fields: ["uv_index"], label: "Remove 'Must return: uv_index'" };

  it("saves the whole list with only that entry changed, and hands back the list before for Undo", async () => {
    const before = set([{ toolId: "t-geo", toolName: "geocode_place" }, { requireOutputFields: ["uv_index"], toolVersionRange: "^2" }]);
    const replace = vi.fn(async (_id: string, entries: unknown[]) => ({ ...before, entries }) as unknown as Toolset);
    const result = await runEntryFix(drop, { get: async () => before, replace });
    expect(replace).toHaveBeenCalledTimes(1);
    const sent = replace.mock.calls[0]![1] as { toolId: string; requireOutputFields?: string[]; toolVersionRange?: string }[];
    expect(sent.map((e) => e.toolId)).toEqual(["t-geo", "t-weather"]);
    expect(sent[1]).toMatchObject({ requireOutputFields: [], toolVersionRange: "^2" });
    expect((result.before as { requireOutputFields?: string[] }[])[1]!.requireOutputFields).toEqual(["uv_index"]);
  });

  it("an entry already fixed sends nothing; a removed tool says so", async () => {
    const replace = vi.fn();
    expect((await runEntryFix(drop, { get: async () => set([{ requireOutputFields: [] }]), replace })).before).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    await expect(runEntryFix(drop, { get: async () => set([{ toolId: "t-geo" }]), replace })).rejects.toBeInstanceOf(EntryGone);
  });
});

describe("tool_version notices in the provider Inbox", () => {
  it("speaks to the provider, with the step to take", () => {
    const [notice] = contractNotices("PROVIDER") as Parameters<typeof InboxItem>[0]["item"][];
    const out = text(renderToStaticMarkup(<InboxItem item={notice!} />));
    expect(out).toMatch(/get_weather v1 stops on .* \(UTC\)/);
    expect(out).toContain("Add v2 to the versions you serve");
    expect(out).toContain("Serve v2");
    expect(out).not.toContain("CONTRACT_VERSION_RETIRED");
  });
});

describe("the demo", () => {
  it("has a refused call for every T3 reason, consistent with the contract story", () => {
    const reasons = CALLS.flatMap((c) => c.providers.map((p) => `${p.reason}/${p.source}`));
    expect(reasons).toEqual(expect.arrayContaining(["MISSING_OUTPUT_FIELD/TOOLSET", "CONTRACT_VERSION_MISMATCH/MIGRATION", "UNSUPPORTED_INPUT_FIELD/REQUEST"]));
    expect(CALLS.map((c) => c.refusalCode)).toContain("UNSUPPORTED_INPUT_FIELD");
    expect(CALLS.every((c) => c.charged === false && c.toolName === "get_weather")).toBe(true);
  });

  it("serves the refusals and both audiences' notices through the fixture table", () => {
    const refused = DEMO_FIXTURES.find((f) => f.method === "GET" && f.match === "/refused-calls")!;
    const page = refused.body("/refused-calls", {}) as { items: RefusedCall[] };
    expect(page.items.some((c) => c.callId === "rc-31d7a6e0-weather-units")).toBe(true);
    const feed = DEMO_FIXTURES.find((f) => f.method === "GET" && f.match === "/notifications")!;
    const buyer = feed.body("/notifications", {}) as { items: { event: string; payload?: { role?: string } }[] };
    expect(buyer.items.find((n) => n.event === "tool_version.deprecated")?.payload?.role).toBe("BUYER");
    const provider = feed.body("/notifications", { event: ["provider.slash_proposed", "tool_version.deprecated"] }) as typeof buyer;
    expect(provider.items.find((n) => n.event === "tool_version.deprecated")?.payload?.role).toBe("PROVIDER");
  });
});
