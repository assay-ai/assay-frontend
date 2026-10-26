// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ createToolset: vi.fn(), recordConnectUrl: vi.fn() }));
vi.mock("@/services/toolsets.service", () => service);
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true }),
  useWallets: () => ({ ready: true, wallets: [] }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/" }));
// Only get_weather has a live listing; get_usd_eur_rate is on Assay with no provider taking calls.
vi.mock("@/components/g31/use-catalogue", () => ({
  useCatalogue: () => ({ isPending: false, tools: [{ toolId: "weather", name: "get_weather", providerCount: 1 }] }),
}));
vi.mock("@/components/g31/use-tool-names", () => ({
  useToolNames: () => ({
    isPending: false,
    byId: new Map([
      ["weather", { id: "weather", name: "get_weather" }],
      ["rate", { id: "rate", name: "get_usd_eur_rate" }],
    ]),
  }),
}));

import { SaveAsToolset } from "./connect-sheet";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSave(tools: string[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SaveAsToolset tools={tools} onSaved={() => undefined} suggest={false} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save as tool set" }));
}

describe("Save as tool set keeps every chosen tool (BUG-PROD-BUY-CONNECT-02)", () => {
  it("saves a tool with no live provider along with the others", async () => {
    service.createToolset.mockResolvedValue({ id: "t1", slug: "my-2-tools", name: "My 2 tools" });
    renderSave(["get_usd_eur_rate", "get_weather"]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(service.createToolset).toHaveBeenCalledTimes(1));
    const body = service.createToolset.mock.calls[0][0];
    expect(body.entries.map((entry: { toolId: string }) => entry.toolId)).toEqual(["rate", "weather"]);
  });

  it("says which name was left out when it is not a tool on Assay", () => {
    renderSave(["get_weather", "no_such_tool"]);
    expect(screen.getByText("Left out, not a tool on Assay: no_such_tool")).toBeTruthy();
  });
});
