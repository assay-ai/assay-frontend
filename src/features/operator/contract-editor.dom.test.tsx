import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OperatorApproval, OperatorIdentity } from "@/interfaces/operator";
import { demoOperatorTool, FX_TOOL_ID, GEOCODE_TOOL_ID, TIDES_TOOL_ID, WEATHER_TOOL_ID } from "@/libs/demo/fixtures-contracts";

import { ContractEditorScreen } from "./contract-editor-view";
import { OperatorSessionContext } from "./session-context";

/*
  The editor as an operator first sees it, rendered from the demo tools: the
  live diff and its bump, the versions agents can use, and the two-person
  pending state (a publish waiting freezes the draft and says who asked).
*/

const JORDAN: OperatorIdentity = {
  id: "op-jordan",
  subject: "jordan@",
  displayName: "Jordan Blake",
  walletAddress: null,
  roles: ["ADJL", "POL"],
  authorityLimit: null,
  status: "ACTIVE",
};

function render(toolId: string, approvals: OperatorApproval[] = [], me: OperatorIdentity = JORDAN): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const tool = demoOperatorTool(toolId)!;
  client.setQueryData(["operator", "tools", toolId], tool);
  client.setQueryData(["operator", "tools", "list"], { tools: [] });
  client.setQueryData(["operator", "approvals", "pending-count"], { items: approvals, pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(["operator", "operators", "directory"], { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <OperatorSessionContext.Provider value={me}>
        <ContractEditorScreen toolId={toolId} />
      </OperatorSessionContext.Provider>
    </QueryClientProvider>,
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");

describe("the contract editor", () => {
  it("shows the draft's bump and every change, in words", () => {
    const html = text(render(WEATHER_TOOL_ID));
    expect(html).toContain("Draft of v2.1.0");
    expect(html).toContain("New optional field → v2.1.0");
    expect(html).toContain("changes from v2.0.0");
    expect(html).toContain("New optional output field: humidity");
    expect(html).toContain("Publish v2.1.0…");
    expect(html).not.toMatch(/\bMINOR\b|\bMAJOR\b|FIELD_ADDED/);
  });

  it("lists the versions agents can use, with the default and the deprecated one", () => {
    const html = text(render(WEATHER_TOOL_ID));
    expect(html).toContain("Agents get v2.0.0 by default");
    expect(html).toContain("Default for agents");
    expect(html).toMatch(/Deprecated .*Stops on .* \(UTC\)/);
    expect(html).toContain("v2 is the version agents get by default, so it can't be deprecated. Publish a newer version and make it the default first.");
  });

  it("suggests moving the default when a newer major is ready", () => {
    const html = text(render(GEOCODE_TOOL_ID));
    expect(html).toContain("v2.0.0 is ready: 2 providers can serve it.");
    expect(html).toContain("Make v2.0.0 the default");
    // v1 is still the default, so it can't be deprecated yet; any other major can.
    expect(html).toContain("v1 is the version agents get by default, so it can't be deprecated. Make another version the default first.");
    expect(html).toContain("Deprecate v2…");
    expect(html).toContain("Publish…");
  });

  it("offers Deprecate on an old major that still runs", () => {
    const html = text(render(FX_TOOL_ID));
    expect(html).toContain("Deprecate v1…");
    expect(html).toContain("Agents get v2.0.0 by default");
  });

  it("writes a new tool's first version", () => {
    const html = text(render(TIDES_TOOL_ID));
    expect(html).toContain("Nothing is published yet.");
    expect(html).toContain("First version → v1.0.0");
    expect(html).toContain("Publish first version…");
  });

  it("freezes the draft while its publish waits for a second person, and says who asked", () => {
    const waiting: OperatorApproval = {
      id: "apr-demo-1",
      action: "tool_version.publish",
      code: "P-10",
      target: `tool:${WEATHER_TOOL_ID}`,
      payload: { toolId: WEATHER_TOOL_ID, version: 4, body: { reasonCode: "PLANNED_CHANGE", note: "Adding humidity for the travel agents." } },
      status: "PENDING",
      requestedBy: "jordan@",
      requestedById: "op-jordan",
      approvedBy: null,
      rejectedBy: null,
      createdAt: "2026-10-17T10:00:00Z",
      decidedAt: null,
      expiresAt: "2099-10-18T10:00:00Z",
    };
    const html = render(WEATHER_TOOL_ID, [waiting]);
    const words = text(html);
    expect(words).toContain("Publishing the draft waits for a Policy approver. Until then the draft can't change.");
    expect(words).toContain("Open the request");
    expect(html).toContain("/operator/approvals?id=apr-demo-1");
    expect(words).toContain("The draft is locked while its publish waits for approval.");
    expect(words).toContain("Locked: a publish of this draft is waiting for a second person. Open it in Approvals");
    // Every field and the Publish button are disabled.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Publish v2\.1\.0…/);
  });

  it("is read only without a Policy role", () => {
    const words = text(render(WEATHER_TOOL_ID, [], { ...JORDAN, roles: ["ADJL"] }));
    expect(words).toContain("Read only: editing needs the Policy author or Policy approver role.");
    expect(words).not.toContain("Save draft");
    expect(words).not.toContain("Deprecate v1");
  });
});
