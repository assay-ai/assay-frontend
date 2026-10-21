// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ createToolset: vi.fn() }));
const sets = vi.hoisted(() => ({ items: [] as { slug: string }[] }));
vi.mock("@/services/toolsets.service", () => service);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./use-toolsets", () => ({
  useToolsets: () => ({ isPending: false, isError: false, data: { items: sets.items } }),
  toolsetKeys: { all: ["toolsets"] },
  errorText: () => "error",
}));
vi.mock("./connect-sheet", () => ({ ConnectSheet: () => null }));
vi.mock("./share-dialog", () => ({ ShareById: () => null }));
// Review F: three tools called; only get_weather has a live provider.
vi.mock("@/components/g31/use-catalogue", () => ({
  useCatalogue: () => ({
    calls: [{ toolId: "weather" }, { toolId: "weather" }, { toolId: "geocode" }, { toolId: "rate" }],
    tools: [{ toolId: "weather", name: "get_weather", routable: true }],
  }),
}));
vi.mock("@/components/g31/use-tool-names", () => ({
  useToolNames: () => ({
    byId: new Map([
      ["weather", { name: "get_weather" }],
      ["geocode", { name: "geocode_place" }],
      ["rate", { name: "get_usd_eur_rate" }],
    ]),
  }),
}));

import { ToolsetsView } from "./toolsets-view";

const nameBox = () => document.getElementById("new-toolset-name") as HTMLInputElement;

function renderView() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToolsetsView />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sets.items = [];
});

describe("Start from tools you've used", () => {
  it("asks for a name (prefilled), shows the URL, and lists every used tool with why it can't run", async () => {
    service.createToolset.mockResolvedValue({ id: "t1", name: "Tools I use" });
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Start from tools you've used" }));

    expect(nameBox().value).toBe("Tools I use");
    expect(screen.getByTestId("new-toolset-url").textContent).toMatch(/\/my\/tools-i-use$/);

    const rows = screen.getAllByTestId("used-tool");
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual(["ready", "no-provider", "no-provider"]);
    expect(rows[1].textContent).toContain("geocode_place");
    expect(rows[1].textContent).toContain("Can't run now: no provider is taking calls for it");

    fireEvent.change(nameBox(), { target: { value: "Weather kit" } });
    expect(screen.getByTestId("new-toolset-url").textContent).toMatch(/\/my\/weather-kit$/);
    fireEvent.click(within(rows[1]).getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create with 2 tools" }));

    await waitFor(() => expect(service.createToolset).toHaveBeenCalledTimes(1));
    const body = service.createToolset.mock.calls[0][0];
    expect(body).toMatchObject({ name: "Weather kit", slug: "weather-kit" });
    expect(body.entries.map((entry: { toolId: string }) => entry.toolId)).toEqual(["weather", "geocode"]);
  });

  it("shows and sends the numbered address when one of your sets has the name's", () => {
    sets.items = [{ slug: "research-kit" }];
    renderView();
    // With a set already there, the header offers "New tool set".
    fireEvent.click(screen.getByRole("button", { name: "New tool set" }));
    fireEvent.change(nameBox(), { target: { value: "Research kit" } });
    expect(screen.getByTestId("new-toolset-url").textContent).toMatch(/\/my\/research-kit-2$/);
  });

  it("is offered next to New tool set once the account has a set (V1-2)", () => {
    sets.items = [{ slug: "tools-i-use" }];
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Start from tools you've used" }));
    expect(nameBox().value).toBe("Tools I use");
    expect(screen.getByTestId("new-toolset-url").textContent).toMatch(/\/my\/tools-i-use-2$/);
    expect(screen.getAllByTestId("used-tool")).toHaveLength(3);
  });
});
