// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/provider/apis/new", useSearchParams: () => new URLSearchParams() }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ ready: false, authenticated: false }) }));
const listPublicCategories = vi.hoisted(() => vi.fn());
vi.mock("@/services/public-toolsets.service", async (original) => ({ ...(await original<object>()), listPublicCategories }));
const tools = vi.hoisted(() => ({ tryProviderTool: vi.fn(), createProviderTool: vi.fn() }));
vi.mock("@/services/provider-tools.service", async (original) => ({ ...(await original<object>()), listProviderTools: async () => ({ items: [] }), ...tools }));

import { toolsetKeys } from "@/components/toolsets/use-toolsets";

import { NameStep } from "./name-step";
import { triedEndpointFor } from "./tried-endpoint";

afterEach(() => cleanup());

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(toolsetKeys.handle, { handle: "acme", status: "ACTIVE", lockedAt: null, canChange: true });
  render(
    <QueryClientProvider client={client}>
      <NameStep tool={null} onContinue={() => undefined} />
    </QueryClientProvider>,
  );
}

/* Onboarding wave 3: the topic is a required choice from the catalogue's, never a misleading "social" placeholder. */
describe("NameStep topic", () => {
  it("asks for one of the catalogue's topics when there is no neutral one", async () => {
    listPublicCategories.mockResolvedValue({ categories: [{ category: "weather", tools: 1, toolsets: 0 }, { category: "finance", tools: 1, toolsets: 0 }] });
    mount();
    const select = (await screen.findByTestId("topic-select")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Choose a topic", "finance", "weather"]);
    expect(select.value).toBe("");
    expect(select.required).toBe(true);
    expect(document.body.textContent).not.toMatch(/social/);
  });

  it("defaults to a neutral topic when the catalogue has one", async () => {
    listPublicCategories.mockResolvedValue({ categories: [{ category: "weather", tools: 1, toolsets: 0 }, { category: "other", tools: 1, toolsets: 0 }] });
    mount();
    const select = (await screen.findByTestId("topic-select")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("other"));
  });
});

/* Onboarding run 3: "Use these inputs, outputs and example" cleared the one line already in the box. */
describe("NameStep with a try run", () => {
  const TRY = {
    source: "CURL",
    ran: true,
    passed: true,
    ranAt: "2026-10-26T13:54:00.000Z",
    request: { method: "GET", url: "https://api.frankfurter.app/latest?from=GBP&to=JPY", headerNames: [] },
    upstream: { status: 200, latencyMs: 154, contentType: "application/json", bodyKind: "JSON", body: {}, transportError: null },
    inferred: {
      endpoint: "https://api.frankfurter.app/latest",
      inputSchema: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
      outputSchema: { type: "object", properties: { rates: { type: "object" } }, required: ["rates"] },
      examples: [],
      requestMapping: {},
      responseMapping: null,
      operationId: null,
    },
    warnings: [],
  };
  const LINE = "Latest GBP to JPY exchange rate from the ECB reference rates.";
  const summaryBox = () => screen.getByLabelText(/What it does, in one line/) as HTMLInputElement;

  const tryIt = async () => {
    tools.tryProviderTool.mockResolvedValue(TRY);
    fireEvent.change(screen.getByLabelText("A curl command or an OpenAPI document"), { target: { value: 'curl "https://api.frankfurter.app/latest?from=GBP&to=JPY"' } });
    fireEvent.click(screen.getByRole("button", { name: /Try it/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Use these inputs, outputs and example" }));
  };

  it("keeps a line filled in by a tool React was not told about when the answer is used", async () => {
    listPublicCategories.mockResolvedValue({ categories: [{ category: "finance", tools: 1, toolsets: 0 }] });
    mount();
    // What a form-filling tool does: the value is set, then an input event React drops.
    summaryBox().value = LINE;
    summaryBox().dispatchEvent(new Event("input", { bubbles: true }));
    await tryIt();
    await screen.findByText(/Inputs, outputs and an example come from your endpoint/);
    expect(summaryBox().value).toBe(LINE);
    expect(screen.getByText(`${LINE.length}/200`)).toBeTruthy();
  });

  it("keeps a typed line, and remembers where it was tried for the connect step", async () => {
    listPublicCategories.mockResolvedValue({ categories: [{ category: "finance", tools: 1, toolsets: 0 }] });
    tools.createProviderTool.mockResolvedValue({ id: "pt-9", name: "acme__gbp_jpy", category: "finance" });
    mount();
    fireEvent.change(screen.getByLabelText(/Tool name/), { target: { value: "gbp_jpy" } });
    fireEvent.change(summaryBox(), { target: { value: LINE } });
    fireEvent.change(await screen.findByTestId("topic-select"), { target: { value: "finance" } });
    await tryIt();
    expect(summaryBox().value).toBe(LINE);
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() => expect(tools.createProviderTool).toHaveBeenCalledWith(expect.objectContaining({ summary: LINE, description: LINE })));
    await waitFor(() => expect(triedEndpointFor("pt-9")).toBe("https://api.frankfurter.app/latest"));
  });
});
