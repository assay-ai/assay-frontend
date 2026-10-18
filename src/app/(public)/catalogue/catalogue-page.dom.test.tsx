import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  search: "",
  toolsetTotal: 0,
  callsChecked: 0,
  tools: [] as Array<{ id: string; name: string; pricingMode: string | null }>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@/features/explorer/use-public-explorer", () => ({
  publicErrorText: () => "",
  usePublicFeatures: () => ({ demo: false, reserves: false, isPending: false }),
  usePublicTools: () => ({
    isSuccess: true,
    isPending: false,
    isError: false,
    data: {
      tools: state.tools.map((t) => ({
        ...t,
        description: "",
        tier: "",
        providerCount: 1,
        fromPrice: null,
        price: null,
        routable: true,
        settlementChains: null,
      })),
    },
  }),
  usePublicProviders: () => ({ isSuccess: true, isPending: false, isError: false, data: { providers: [] } }),
  usePublicProviderDetails: () => [],
  usePublicNotCharged: () => ({
    isSuccess: true,
    data: {
      windowDays: 30,
      totals: { callsChecked: state.callsChecked, callsNotCharged: 0, callsFailedCheck: 0, amountNotCharged: [] },
    },
  }),
}));
vi.mock("@/components/toolsets/use-toolsets", () => ({
  usePublicToolsets: () => ({ data: { toolsets: [], total: state.toolsetTotal } }),
}));
vi.mock("@/components/toolsets/connect-panel", () => ({
  ConnectPanel: ({ title }: { title: string }) => <p data-testid="connect-panel">{title}</p>,
}));
vi.mock("@/components/toolsets/public-toolsets", () => ({ ToolsetCatalogue: () => null }));
vi.mock("@/components/explorer/not-charged-proof", () => ({
  NotChargedProof: () => <section data-testid="not-charged-proof" />,
  NotChargedSummary: () => null,
}));
vi.mock("@/components/explorer/start-free", () => ({ StartFreeCta: () => null }));
vi.mock("@/hooks/useChainName", () => ({ useChainName: () => (id: string) => id }));

import CataloguePage from "./page";

function render() {
  return renderToStaticMarkup(<CataloguePage />);
}

beforeEach(() => {
  state.search = "";
  state.toolsetTotal = 0;
  state.callsChecked = 0;
  state.tools = [
    { id: "t1", name: "get_weather", pricingMode: "PAID" },
    { id: "t2", name: "search_web", pricingMode: "FREEMIUM" },
    { id: "t3", name: "lookup", pricingMode: "FREE" },
  ];
});

/* A (2026-10-18), public catalogue findings. */
describe("public catalogue", () => {
  it("explains one URL for everything, or a tool set URL", () => {
    expect(render()).toContain(
      "One MCP URL for everything below: connect your agent to it, or use a tool set URL for a smaller group.",
    );
  });

  it("hides the Tool sets tab while none is listed", () => {
    expect(render()).not.toContain(">Tool sets<");
    state.toolsetTotal = 2;
    expect(render()).toContain(">Tool sets<");
  });

  it("keeps the Tool sets tab when a link opened it", () => {
    state.search = "view=toolsets";
    expect(render()).toContain(">Tool sets<");
  });

  it("counts free tools on the Free calls chip", () => {
    const html = render();
    expect(html).toContain('aria-label="Free calls: 2 tools"');
    state.tools = [{ id: "t1", name: "get_weather", pricingMode: "PAID" }];
    expect(render()).toContain('aria-label="Free calls: 0 tools"');
  });

  it("folds the proof into one line, labelled with its window, before any paid call was checked", () => {
    const html = render();
    expect(html).toContain('data-testid="proof-collapsed"');
    expect(html).toContain("last 30 days:");
    expect(html).toMatch(/<details[^>]*data-testid="proof-collapsed"/);
    expect(html).not.toMatch(/<details[^>]*open/);
  });

  it("shows the full proof, labelled last 30 days, once calls were checked", () => {
    state.callsChecked = 120;
    const html = render();
    expect(html).not.toContain('data-testid="proof-collapsed"');
    expect(html).toContain("Last 30 days · paid calls, across every buyer");
    expect(html).toContain('data-testid="not-charged-proof"');
  });
});
