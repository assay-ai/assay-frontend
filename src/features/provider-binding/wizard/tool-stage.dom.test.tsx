import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => "/provider/bindings/new",
  useSearchParams: () => new URLSearchParams(),
}));

import { ToolStage } from "./tool-stage";

/* Onboarding wave item 1: an empty catalogue offers "Publish your API" beside "Request a tool". */
describe("ToolStage on an empty catalogue", () => {
  it("offers both ways forward", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ToolStage tools={[]} isLoading={false} error={false} onRetry={() => undefined} boundByTool={new Map()} selectedId={null} onPick={() => undefined} />
      </QueryClientProvider>,
    );
    expect(html).toContain("No tools to list yet");
    expect(html).toContain("Request a tool");
    expect(html).toMatch(/<a[^>]*href="\/provider\/apis\/new"[^>]*>Publish your API<\/a>/);
  });
});

/* Onboarding wave 2 item 2: publishing your own API is an equal choice, also beside a full catalogue. */
describe("ToolStage with tools listed", () => {
  it("still offers publishing your own API as a new tool", () => {
    const tool = { id: "t1", name: "get_usd_eur_rate", description: "USD to EUR rate" } as unknown as import("@/interfaces").CatalogueTool;
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ToolStage tools={[tool]} isLoading={false} error={false} onRetry={() => undefined} boundByTool={new Map()} selectedId={null} onPick={() => undefined} />
      </QueryClientProvider>,
    );
    expect(html).toContain("get_usd_eur_rate");
    expect(html).toContain("Pick a tool from the catalogue");
    expect(html).toContain("Publish your own API as a new tool");
    expect(html).toMatch(/<a[^>]*href="\/provider\/apis\/new"[^>]*>Publish your API/);
  });
});
