import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

vi.mock("./use-catalogue", () => ({ useCatalogue: () => ({ calls: [], tools: [] }) }));
vi.mock("@/components/explorer/tool-access-control", () => ({
  ToolAccessControl: () => null,
  useExploreAgent: () => ({ agent: null, agents: [], name: "Your agent", access: null, many: false }),
}));
vi.mock("@/hooks/useChainName", () => ({ useChainName: () => (id: string | null | undefined) => id ?? "" }));

import { ProviderDetailView } from "./provider-detail-view";

/** Renders the view with the provider read already failed with `error`. */
function markup(id: string, error: ApiError): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  client.getQueryCache().build(client, { queryKey: ["catalogue", "provider", id] }).setState({
    status: "error",
    error,
    fetchStatus: "idle",
    errorUpdatedAt: Date.now(),
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ProviderDetailView providerId={id} />
    </QueryClientProvider>
  );
}

describe("ProviderDetailView — a missing provider", () => {
  it("shows the not-found state for an unknown id (404)", () => {
    const html = markup("11111111-1111-4111-8111-111111111111", new ApiError("NOT_FOUND", "Not found", 404));
    expect(html).toContain("We could not find this provider");
  });

  it("shows the same not-found state, not a load error, for an id that is not a UUID (BUG-DEV-NF-03)", () => {
    const html = markup("not-a-uuid", new ApiError("VALIDATION_FAILED", "Some of the details are not valid", 400));
    expect(html).toContain("We could not find this provider");
    expect(html).not.toContain("could not be loaded");
  });
});
