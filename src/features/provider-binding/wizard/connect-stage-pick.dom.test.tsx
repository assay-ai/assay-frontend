// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BindingTestLayer, BindingTestReport, CatalogueTool, ToolBindingDetail } from "@/interfaces";

const service = vi.hoisted(() => ({
  listBindingCredentials: vi.fn(),
  putBindingCredentials: vi.fn(),
  deleteBindingCredentials: vi.fn(),
  testToolBinding: vi.fn(),
}));
vi.mock("@/services/provider-tool-bindings.service", () => service);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
// The icon set is SVG-as-data-URI components that jsdom cannot build.
vi.mock("@/components/icons", () => ({ AlertFill: () => null, CheckCircle: () => null, CloseLine: () => null, WarningFill: () => null }));

import { ConnectStage } from "./connect-stage";

/* Onboarding wave 2 item 3: click a value in the real answer instead of typing JSONPath. */
const TOOL = {
  id: "t1",
  name: "get_usd_eur_rate",
  description: "d",
  tier: "VERIFIED",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: { rate: { type: "number" }, publishedFor: { type: "string" } } },
} as unknown as CatalogueTool;

const BINDING = {
  id: "b1",
  toolId: "t1",
  endpoint: "https://api.frankfurter.app/latest?from=USD&to=EUR",
  status: "DRAFT",
  version: 1,
  authMode: "NONE",
  publishedEndpoint: null,
  requestMapping: { method: "GET" },
  responseMapping: { rate: { $path: "$.rate" }, publishedFor: { $path: "$.publishedFor" } },
} as unknown as ToolBindingDetail;

const LAYERS: BindingTestLayer[] = ["REQUEST_MAPPING", "UPSTREAM", "CLASSIFICATION", "RESPONSE_MAPPING", "VERIFICATION"];
const REPORT: BindingTestReport = {
  callId: "c",
  outcome: "FAILED",
  failedLayer: "RESPONSE_MAPPING",
  mappingVersion: 1,
  warnings: [],
  layers: LAYERS.map((layer) => ({ layer, status: layer === "RESPONSE_MAPPING" ? "FAILED" : "PASSED", code: null, detail: null, fault: null })) as never,
  request: { method: "GET", url: "https://api.frankfurter.app/latest?from=USD&to=EUR", headerNames: [], body: null },
  upstream: {
    status: 200,
    latencyMs: 140,
    rawBody: '{"amount":1.0,"base":"USD","date":"2026-10-24","rates":{"EUR":0.92}}',
    rawBodyTruncated: false,
    contentType: "application/json",
    transportError: null,
  },
  classification: null,
  mapped: null,
  verification: null,
  ranAt: "2026-10-26T05:08:00Z",
};

beforeEach(() => {
  service.listBindingCredentials.mockResolvedValue([]);
  service.testToolBinding.mockResolvedValue(REPORT);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConnectStage response picker", () => {
  it("fills output fields from clicks on the test call's answer", async () => {
    const onSave = vi.fn().mockResolvedValue(BINDING);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ConnectStage tool={TOOL} binding={BINDING} initialEndpoint="" readOnly={false} testPassedBefore={false} onSave={onSave} onContinue={() => undefined} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId("response-picker")).toBeNull();

    const run = screen.getByRole("button", { name: /Save and run test/ }) as HTMLButtonElement;
    await waitFor(() => expect(run.disabled).toBe(false));
    fireEvent.click(run);
    await screen.findByTestId("response-picker");

    // "rate" is the field being filled first; one click on 0.92 maps it, then "publishedFor" is next.
    fireEvent.click(screen.getByRole("button", { name: "Use $.rates.EUR (0.92) for rate" }));
    fireEvent.click(screen.getByRole("button", { name: 'Use $.date ("2026-10-24") for publishedFor' }));
    expect(screen.getByText("Run the test again to check your choices.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Run the test again/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1]![0]).toEqual(
      expect.objectContaining({ responseMapping: { rate: { $path: "$.rates.EUR" }, publishedFor: { $path: "$.date" } } }),
    );
  });
});
