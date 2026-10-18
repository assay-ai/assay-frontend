import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { OperatorSessionContext } from "@/features/operator/session-context";
import type { OperatorIdentity } from "@/interfaces/operator";
import type { OperatorToolRequestRow } from "@/services/operator-contracts.service";

import OperatorToolsPage from "./page";

vi.mock("next/navigation", () => ({ usePathname: () => "/operator/tools", useRouter: () => ({ push: () => undefined }) }));

/*
  The standard tools page as each role sees it: who may answer a tool
  request, what accepting means for a role that does not write tools, and
  drafts that were never published.
*/

const identity = (roles: OperatorIdentity["roles"]): OperatorIdentity => ({ id: "op-1", subject: "riley@", displayName: "Riley", walletAddress: null, roles, authorityLimit: null, status: "ACTIVE" });

const HOUR = 3_600_000;
const request = (over: Partial<OperatorToolRequestRow>): OperatorToolRequestRow => ({
  id: "req-1",
  organizationId: "org-1",
  title: "Patent search",
  expectedMonthlyCalls: null,
  status: "OPEN",
  ownerOperatorId: null,
  firstResponseDueAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  createdAt: new Date(Date.now() - 72 * HOUR).toISOString(),
  ...over,
});

const tool = (name: string, currentSemver: string | null) => ({
  id: `tool-${name}`,
  name,
  category: "uncategorised",
  status: "ACTIVE",
  kind: "STANDARD",
  currentSemver,
  hasDraft: false,
});

function render(roles: OperatorIdentity["roles"], requests: OperatorToolRequestRow[] = [request({}), request({ id: "req-2", title: "Tide times", status: "ACKNOWLEDGED" })]): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["operator", "tools", "list"], { tools: [tool("unseeded_8c1f2a", null), tool("get_weather", "2.0.0")] });
  client.setQueryData(["operator", "tool-requests"], { items: requests, pageInfo: { nextCursor: null, hasMore: false } });
  client.setQueryData(["operator", "approvals", "pending-count"], { items: [], pageInfo: { nextCursor: null, hasMore: false } });
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <OperatorSessionContext.Provider value={identity(roles)}>
        <OperatorToolsPage />
      </OperatorSessionContext.Provider>
    </QueryClientProvider>,
  );
  return html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
}

const count = (words: string, phrase: string) => words.split(phrase).length - 1;

describe("tool requests on the Tools page", () => {
  it("offers Decline on every request and Answer while nobody has answered, to a role that answers them", () => {
    const words = render(["ADJL"]);
    expect(count(words, " Decline ")).toBe(2);
    expect(count(words, " Answer Decline ")).toBe(1);
    expect(count(words, "Create tool from it")).toBe(2);
  });

  it("tells a role that answers but does not write tools what accepting does", () => {
    const words = render(["SUP"]);
    expect(words).toContain("Accepting creates a draft; writing its versions needs Policy author.");
    expect(render(["SUP", "POL"])).not.toContain("Accepting creates a draft; writing its versions needs Policy author.");
  });

  it("shows no answer buttons to a role the server would refuse, and says who can", () => {
    const words = render(["POL"]);
    expect(words).not.toContain(" Decline ");
    expect(words).not.toContain("Create tool from it");
    expect(words).toContain("Support, Provider success or a Lead adjudicator can answer it.");
  });

  it("never calls an answered request overdue", () => {
    const words = render(["ADJL"], [request({ status: "ACKNOWLEDGED" })]);
    expect(words).not.toContain("overdue");
    expect(words).toContain("Being reviewed; asked");
  });

  it("labels a tool never published as a draft, after the published ones", () => {
    const words = render(["POL"], []);
    expect(words).toContain("Draft, never published");
    expect(words).not.toContain("No version");
    expect(words.indexOf("get_weather")).toBeLessThan(words.indexOf("unseeded_8c1f2a"));
  });
});
