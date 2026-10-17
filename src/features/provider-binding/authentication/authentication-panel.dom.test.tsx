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

import { AuthenticationPanel, runBlockedByCredentials, type AuthenticationPanelProps } from "./authentication-panel";

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

describe("AuthenticationPanel", () => {
  it("warns under Neither", () => {
    mount({ mode: "NONE" });
    expect(screen.getByText("Anyone who learns your endpoint URL can call it directly, without paying.")).toBeTruthy();
  });

  it("reports the picked mode", () => {
    const onModeChange = vi.fn();
    mount({ mode: "API_KEY", onModeChange });
    fireEvent.click(screen.getByRole("radio", { name: "Neither" }));
    expect(onModeChange).toHaveBeenCalledWith("NONE");
  });

  it("saves typed headers, then no input holds the value", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Replace headers" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Replace headers" }));
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

  it("keeps the rows and explains a failed save", async () => {
    service.putBindingCredentials.mockRejectedValue(new ApiError("PROVIDER_CREDENTIAL_VAULT_UNAVAILABLE", "x", 503));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Replace headers" }));
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

  it("disables the credentials before the first save", () => {
    mount({ bindingId: null });
    expect(screen.getByText("Save the connection first.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Replace headers" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("runBlockedByCredentials", () => {
  const base = { hasBinding: true, loading: false, sets: [] as CredentialSetSummary[], endpoint: "https://p.test/v1" };
  it("does not gate signature, neither or an unsaved binding", () => {
    expect(runBlockedByCredentials({ ...base, mode: "SIGNATURE" })).toBe(false);
    expect(runBlockedByCredentials({ ...base, mode: "NONE" })).toBe(false);
    expect(runBlockedByCredentials({ ...base, mode: "API_KEY", hasBinding: false })).toBe(false);
  });
  it("gates an API key with no set for the origin", () => {
    expect(runBlockedByCredentials({ ...base, mode: "API_KEY" })).toBe(true);
    expect(runBlockedByCredentials({ ...base, mode: "BOTH", sets: [setFor("https://old.test")] })).toBe(true);
    expect(runBlockedByCredentials({ ...base, mode: "API_KEY", loading: true })).toBe(true);
  });
  it("opens once a set exists for the current origin", () => {
    expect(runBlockedByCredentials({ ...base, mode: "API_KEY", sets: [setFor("https://p.test")] })).toBe(false);
  });
});

describe("CredentialHeadersForm rows", () => {
  it("flags an empty row next to a filled one and does not save", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Replace headers" }));
    fireEvent.change(screen.getByLabelText("Header name"), { target: { value: "X-Key" } });
    fireEvent.change(screen.getByLabelText("Header value"), { target: { value: "v" } });
    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    expect(screen.getByText("Header name is required.")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save headers" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(service.putBindingCredentials).not.toHaveBeenCalled();
  });
});
