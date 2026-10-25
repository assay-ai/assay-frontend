// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CredentialSetSummary } from "@/interfaces/provider-bindings";
import { ApiError } from "@/libs/ApiClient";

const service = vi.hoisted(() => ({
  listBindingCredentials: vi.fn(),
  putBindingCredentials: vi.fn(),
  deleteBindingCredentials: vi.fn(),
}));
vi.mock("@/services/provider-tool-bindings.service", () => service);

import { AuthenticationPanel, runBlockedByCredentials, runCredentialsHint, type AuthenticationPanelProps } from "./authentication-panel";

function setFor(origin: string, hint: string | null = "cdef"): CredentialSetSummary {
  return { origin, headers: [{ name: "X-Key", hint }], updatedAt: "2026-10-01T10:00:00.000Z" };
}

function mount(props: Partial<AuthenticationPanelProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthenticationPanel
        bindingId="b1"
        endpoint="https://p.test/v1"
        savedEndpoint="https://p.test/v1"
        publishedEndpoint={null}
        mode="API_KEY"
        onModeChange={() => undefined}
        readOnly={false}
        {...props}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  service.listBindingCredentials.mockResolvedValue([]);
  service.putBindingCredentials.mockResolvedValue(setFor("https://p.test"));
  service.deleteBindingCredentials.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthenticationPanel choice (D10)", () => {
  it("preselects nothing and asks for a choice", () => {
    mount({ mode: null, bindingId: null, savedEndpoint: null });
    expect(screen.getByText("Choose one. There is no default.")).toBeTruthy();
    for (const radio of screen.getAllByRole("radio")) expect((radio as HTMLInputElement).checked).toBe(false);
  });

  it("explains every option before the choice, and recommends the signature", () => {
    mount({ mode: null, bindingId: null, savedEndpoint: null });
    expect(screen.getByRole("radio", { name: /^Assay signature \(recommended\)/ })).toBeTruthy();
    expect(screen.getByText(/Your API checks the signature and refuses anything else/)).toBeTruthy();
    expect(screen.getByText(/Assay sends headers you store here/)).toBeTruthy();
    expect(screen.getByText(/A signature and your API key headers/)).toBeTruthy();
    expect(screen.getByText(/Your API accepts any call/)).toBeTruthy();
  });

  it("explains the signature inline, with a snippet and the full guide (D23)", () => {
    mount({ mode: "SIGNATURE" });
    expect(screen.getByText("How to check the signature")).toBeTruthy();
    expect(screen.getByText(/older than 5 minutes/)).toBeTruthy();
    expect(screen.getByText(/assayVerify/)).toBeTruthy();
    // The verifier must pin the provider id (aud); a placeholder until it loads.
    expect(screen.getByText(/so it refuses calls Assay signed for another provider/)).toBeTruthy();
    expect(screen.getByText(/provider: "YOUR_PROVIDER_ID"/)).toBeTruthy();
    // The package is on npm: no "coming soon" note above the snippet.
    expect(screen.queryByText(/coming soon/)).toBeNull();
    const guide = screen.getByRole("link", { name: /^Full guide/ }) as HTMLAnchorElement;
    expect(guide.href).toBe("https://github.com/assay-ai/assay-provider-verify#readme");
  });
});

describe("AuthenticationPanel", () => {
  it("warns under Neither", () => {
    mount({ mode: "NONE" });
    expect(screen.getByText("Anyone who learns your endpoint URL can call it directly, without paying.")).toBeTruthy();
  });

  it("reports the picked mode", () => {
    const onModeChange = vi.fn();
    mount({ mode: "API_KEY", onModeChange });
    fireEvent.click(screen.getByRole("radio", { name: /^Neither/ }));
    expect(onModeChange).toHaveBeenCalledWith("NONE");
  });

  it("saves typed headers, then no input holds the value", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add headers" }));
    expect(screen.getAllByLabelText("Header name")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Header name"), { target: { value: "X-Key" } });
    fireEvent.change(screen.getByLabelText("Header value"), { target: { value: "v" } });
    fireEvent.click(screen.getByRole("button", { name: "Save headers" }));
    await waitFor(() => expect(service.putBindingCredentials).toHaveBeenCalledWith("b1", "https://p.test", [{ name: "X-Key", value: "v" }]));
    await waitFor(() => expect(screen.queryByLabelText("Header value")).toBeNull());
    expect(Array.from(document.querySelectorAll("input")).some((input) => input.value === "v")).toBe(false);
  });

  it("splits a pasted Name: value line", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add headers" }));
    fireEvent.paste(screen.getByLabelText("Header name"), { clipboardData: { getData: () => "Authorization: Bearer sk-1" } });
    expect((screen.getByLabelText("Header name") as HTMLInputElement).value).toBe("Authorization");
    expect((screen.getByLabelText("Header value") as HTMLInputElement).value).toBe("Bearer sk-1");
  });

  it("tags a set stored for another address", async () => {
    service.listBindingCredentials.mockResolvedValue([setFor("https://old.test")]);
    mount();
    expect(await screen.findByText("Old address")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(service.deleteBindingCredentials).toHaveBeenCalledWith("b1", "https://old.test"));
  });

  it("labels the live set without Remove and an unrelated set with Remove", async () => {
    service.listBindingCredentials.mockResolvedValue([setFor("https://live.test"), setFor("https://old.test")]);
    mount({ publishedEndpoint: "https://live.test/v1" });
    expect(await screen.findByText("Live address")).toBeTruthy();
    expect(screen.getAllByText("Old address")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(service.deleteBindingCredentials).toHaveBeenCalledWith("b1", "https://old.test"));
  });

  it("notes where live calls go only when the published origin differs from the saved one", async () => {
    const view = mount({ publishedEndpoint: "https://live.test/v1" });
    expect(await screen.findByText(/Live calls still go to https:\/\/live\.test/)).toBeTruthy();
    view.unmount();
    mount({ publishedEndpoint: "https://p.test/v1" });
    await screen.findByText("No headers stored for this address yet.");
    expect(screen.queryByText(/Live calls still go to/)).toBeNull();
    cleanup();
    mount({ publishedEndpoint: null });
    await screen.findByText("No headers stored for this address yet.");
    expect(screen.queryByText(/Live calls still go to/)).toBeNull();
  });

  it("writes for the saved origin, and waits for Run when the typed origin moved", async () => {
    const view = mount({ endpoint: "https://p.test/v2" });
    fireEvent.click(await screen.findByRole("button", { name: "Add headers" }));
    fireEvent.change(screen.getByLabelText("Header name"), { target: { value: "X-Key" } });
    fireEvent.change(screen.getByLabelText("Header value"), { target: { value: "v" } });
    fireEvent.click(screen.getByRole("button", { name: "Save headers" }));
    await waitFor(() => expect(service.putBindingCredentials).toHaveBeenCalledWith("b1", "https://p.test", [{ name: "X-Key", value: "v" }]));
    view.unmount();
    const onSaveConnection = vi.fn();
    mount({ endpoint: "https://new.test/v1", onSaveConnection });
    expect(await screen.findByText("Saves the new address so you can add its headers. Your API is not called.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add headers" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
    expect(onSaveConnection).toHaveBeenCalledTimes(1);
  });

  it("keeps the rows and explains a failed save", async () => {
    service.putBindingCredentials.mockRejectedValue(new ApiError("PROVIDER_CREDENTIAL_VAULT_UNAVAILABLE", "x", 503));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add headers" }));
    fireEvent.change(screen.getByLabelText("Header name"), { target: { value: "X-Key" } });
    fireEvent.change(screen.getByLabelText("Header value"), { target: { value: "secret-v" } });
    fireEvent.click(screen.getByRole("button", { name: "Save headers" }));
    expect(await screen.findByText(/can't reach the key store/i)).toBeTruthy();
    expect((screen.getByLabelText("Header value") as HTMLInputElement).value).toBe("secret-v");
  });

  it("shows only the hint of a stored value", async () => {
    service.listBindingCredentials.mockResolvedValue([setFor("https://p.test", "cdef")]);
    mount();
    expect(await screen.findByText("••••cdef")).toBeTruthy();
  });

  it("offers Save connection before the first save, so headers can be added before any test", () => {
    const onSaveConnection = vi.fn();
    mount({ bindingId: null, savedEndpoint: null, onSaveConnection });
    expect(screen.queryByText("Save the connection first.")).toBeNull();
    expect(screen.queryByRole("button", { name: /headers/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
    expect(onSaveConnection).toHaveBeenCalledTimes(1);
  });

  it("says Replace headers only when headers are stored for this address", async () => {
    service.listBindingCredentials.mockResolvedValue([setFor("https://p.test")]);
    mount();
    expect(await screen.findByRole("button", { name: "Replace headers" })).toBeTruthy();
    expect(screen.getByText(/used for every tool|every tool you list on it uses them/i)).toBeTruthy();
  });

  it("reads a vault that is not set up as a storage problem (503)", async () => {
    service.putBindingCredentials.mockRejectedValue(new ApiError("PROVIDER_CREDENTIAL_VAULT_NOT_CONFIGURED", "x", 503));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add headers" }));
    fireEvent.change(screen.getByLabelText("Header name"), { target: { value: "X-Key" } });
    fireEvent.change(screen.getByLabelText("Header value"), { target: { value: "v" } });
    fireEvent.click(screen.getByRole("button", { name: "Save headers" }));
    expect(
      await screen.findByText("Key storage isn't set up on this server, so headers can't be saved. Nothing was stored. Tell Assay support."),
    ).toBeTruthy();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });

  it("opens the form prefilled with headers moved out of the address", async () => {
    const onPendingDone = vi.fn();
    mount({ pendingHeaders: [{ name: "api_key", value: "moved-value" }], onPendingDone });
    expect(((await screen.findByLabelText("Header name")) as HTMLInputElement).value).toBe("api_key");
    expect((screen.getByLabelText("Header value") as HTMLInputElement).value).toBe("moved-value");
    expect(screen.getByText(/Check the header name your API reads/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save headers" }));
    await waitFor(() =>
      expect(service.putBindingCredentials).toHaveBeenCalledWith("b1", "https://p.test", [{ name: "api_key", value: "moved-value" }]),
    );
    await waitFor(() => expect(onPendingDone).toHaveBeenCalled());
  });
});

describe("runBlockedByCredentials", () => {
  const base = {
    hasBinding: true,
    loading: false,
    sets: [] as CredentialSetSummary[],
    endpoint: "https://p.test/v1",
    savedEndpoint: "https://p.test/v1",
  };
  it("does not gate signature, neither or an unsaved binding", () => {
    expect(runBlockedByCredentials({ ...base, mode: "SIGNATURE" })).toBe(false);
    expect(runBlockedByCredentials({ ...base, mode: "NONE" })).toBe(false);
    expect(runBlockedByCredentials({ ...base, mode: "API_KEY", hasBinding: false, savedEndpoint: null })).toBe(false);
  });
  it("gates an API key with no set for the saved origin", () => {
    expect(runBlockedByCredentials({ ...base, mode: "API_KEY" })).toBe(true);
    expect(runBlockedByCredentials({ ...base, mode: "BOTH", sets: [setFor("https://old.test")] })).toBe(true);
    expect(runBlockedByCredentials({ ...base, mode: "API_KEY", loading: true })).toBe(true);
  });
  it("opens once a set exists for the saved origin", () => {
    expect(runBlockedByCredentials({ ...base, mode: "API_KEY", sets: [setFor("https://p.test")] })).toBe(false);
  });
  it("does not gate when the typed origin differs from the saved one (Run saves it)", () => {
    expect(runBlockedByCredentials({ ...base, mode: "API_KEY", endpoint: "https://new.test/v1" })).toBe(false);
    expect(runCredentialsHint({ ...base, mode: "API_KEY", endpoint: "https://new.test/v1" })).toBeNull();
  });
  it("does not claim headers are missing when the list failed to load", () => {
    const failed = { ...base, mode: "API_KEY" as const, isError: true, sets: undefined };
    expect(runBlockedByCredentials(failed)).toBe(false);
    expect(runCredentialsHint(failed)).toBe("Couldn't load your stored headers — try again.");
    expect(runCredentialsHint({ ...base, mode: "API_KEY" })).toBe("Add the API key headers for this address under Authentication first.");
  });
});

describe("CredentialHeadersForm rows", () => {
  it("opens without an error, and checks a row once focus leaves it", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add headers" }));
    expect(screen.queryByText("Header name is required.")).toBeNull();
    // Moving from the name to the value of the same row is not leaving it.
    fireEvent.blur(screen.getByLabelText("Header name"), { relatedTarget: screen.getByLabelText("Header value") });
    expect(screen.queryByText("Header name is required.")).toBeNull();
    fireEvent.blur(screen.getByLabelText("Header value"), { relatedTarget: document.body });
    expect(screen.getByText("Header name is required.")).toBeTruthy();
  });

  it("flags an empty row next to a filled one on save, and does not save", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Add headers" }));
    fireEvent.change(screen.getByLabelText("Header name"), { target: { value: "X-Key" } });
    fireEvent.change(screen.getByLabelText("Header value"), { target: { value: "v" } });
    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    expect(screen.queryByText("Header name is required.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save headers" }));
    expect(screen.getByText("Header name is required.")).toBeTruthy();
    expect(service.putBindingCredentials).not.toHaveBeenCalled();
  });
});
