// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BindingAuthMode, CatalogueTool, ToolBindingDetail } from "@/interfaces";

const service = vi.hoisted(() => ({
  listBindingCredentials: vi.fn(),
  putBindingCredentials: vi.fn(),
  deleteBindingCredentials: vi.fn(),
  testToolBinding: vi.fn(),
}));
vi.mock("@/services/provider-tool-bindings.service", () => service);

import { ConnectStage } from "./connect-stage";

const TOOL = {
  id: "t1",
  name: "quote",
  description: "d",
  tier: "VERIFIED",
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object", properties: {} },
} as unknown as CatalogueTool;

function bindingWith(authMode: BindingAuthMode): ToolBindingDetail {
  return {
    id: "b1",
    toolId: "t1",
    endpoint: "https://p.test/v1",
    status: "DRAFT",
    version: 1,
    authMode,
    publishedEndpoint: null,
    requestMapping: { method: "GET" },
    responseMapping: {},
  } as unknown as ToolBindingDetail;
}

function mount(authMode: BindingAuthMode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConnectStage
        tool={TOOL}
        binding={bindingWith(authMode)}
        initialEndpoint="https://p.test/v1"
        readOnly={false}
        testPassedBefore={false}
        onSave={() => Promise.reject(new Error("not used"))}
        onContinue={() => undefined}
      />
    </QueryClientProvider>,
  );
}

const HINT = "Add the API key headers for this address under Authentication first.";
const runButton = () => screen.getByRole("button", { name: /Save and run test/ }) as HTMLButtonElement;

beforeEach(() => {
  service.listBindingCredentials.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConnectStage run gate", () => {
  it("leaves Run enabled for a saved binding that signs its calls", async () => {
    mount("SIGNATURE");
    await waitFor(() => expect(runButton().disabled).toBe(false));
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("holds Run back, with the hint, when API_KEY has no set for the saved origin", async () => {
    service.listBindingCredentials.mockResolvedValue([
      { origin: "https://old.test", headers: [{ name: "X-Key", hint: "cdef" }], updatedAt: "2026-10-01T10:00:00.000Z" },
    ]);
    mount("API_KEY");
    expect(await screen.findByText(HINT)).toBeTruthy();
    expect(runButton().disabled).toBe(true);
  });
});
