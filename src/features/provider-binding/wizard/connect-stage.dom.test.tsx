// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { ConnectStage, readTestInput, writeTestInput } from "./connect-stage";

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

function mount(
  authMode: BindingAuthMode | null,
  onSave: (draft: unknown) => Promise<ToolBindingDetail> = () => Promise.reject(new Error("not used")),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConnectStage
        tool={TOOL}
        binding={authMode === null ? null : bindingWith(authMode)}
        initialEndpoint="https://p.test/v1"
        readOnly={false}
        testPassedBefore={false}
        onSave={onSave as never}
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

describe("ConnectStage new listing", () => {
  const addressInput = () => screen.getByLabelText(/Your API's address/) as HTMLInputElement;

  it("saves nothing until an authentication choice is made (D10)", async () => {
    const onSave = vi.fn();
    mount(null, onSave);
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    expect(await screen.findByText("Choose how your API knows a call is from Assay, under Authentication.")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("sends the chosen mode with the draft", async () => {
    const onSave = vi.fn().mockResolvedValue(bindingWith("SIGNATURE"));
    service.testToolBinding.mockReturnValue(new Promise(() => undefined));
    mount(null, onSave);
    fireEvent.click(screen.getByRole("radio", { name: /^Assay signature/ }));
    await waitFor(() => expect(runButton().disabled).toBe(false));
    fireEvent.click(runButton());
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ authMode: "SIGNATURE" })));
  });

  it("drops the account-setup hint once the address is edited", () => {
    mount(null);
    expect(screen.getByText(/Filled in from your account setup/)).toBeTruthy();
    fireEvent.change(addressInput(), { target: { value: "https://other.test/v1" } });
    expect(screen.queryByText(/Filled in from your account setup/)).toBeNull();
  });

  it("previews the request live, with no trailing slash", () => {
    mount(null);
    expect(screen.getByText("GET https://p.test/v1")).toBeTruthy();
    fireEvent.change(addressInput(), { target: { value: "https://httpbin.org/anything/" } });
    expect(screen.getByText("GET https://httpbin.org/anything")).toBeTruthy();
  });

  it("moves a key out of the address into an API key header", () => {
    mount(null);
    fireEvent.change(addressInput(), { target: { value: "https://httpbin.org/anything?api_key=dummy-value" } });
    fireEvent.click(screen.getByRole("button", { name: "Move it to an API key header" }));
    expect(addressInput().value).toBe("https://httpbin.org/anything");
    expect((screen.getByRole("radio", { name: /^API key/ }) as HTMLInputElement).checked).toBe(true);
    // Before the first save, the headers wait for "Save connection".
    expect(screen.getByRole("button", { name: "Save connection" })).toBeTruthy();
  });

  it("Save draft and exit saves, then goes to the listings", async () => {
    const onSave = vi.fn().mockResolvedValue(bindingWith("NONE"));
    mount(null, onSave);
    fireEvent.click(screen.getByRole("radio", { name: /^Neither/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save draft and exit" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save draft and exit" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/provider/bindings"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ authMode: "NONE", endpoint: "https://p.test/v1" }));
    expect(service.testToolBinding).not.toHaveBeenCalled();
  });
});

describe("test input kept with the draft", () => {
  it("round-trips per listing, and ignores anything that is not text", () => {
    writeTestInput("b-keep", { ids: "bitcoin", vsCurrency: "" });
    expect(readTestInput("b-keep")).toEqual({ ids: "bitcoin", vsCurrency: "" });
    expect(readTestInput("b-other")).toBeNull();
    expect(readTestInput(null)).toBeNull();
    window.localStorage.setItem("assay:binding-test-input:b-bad", JSON.stringify({ ids: 3, ok: "x" }));
    expect(readTestInput("b-bad")).toEqual({ ok: "x" });
    window.localStorage.setItem("assay:binding-test-input:b-broken", "{");
    expect(readTestInput("b-broken")).toBeNull();
  });
});
