// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";
import type { ProviderToolTryResult } from "@/services/provider-tools.service";

const service = vi.hoisted(() => ({ tryProviderTool: vi.fn() }));
vi.mock("@/services/provider-tools.service", () => service);

import { TryPanel } from "./fields-editor";

afterEach(() => {
  cleanup();
  service.tryProviderTool.mockReset();
});

const result: ProviderToolTryResult = {
  source: "OPENAPI",
  ran: true,
  passed: true,
  ranAt: "2026-10-18T10:00:00.000Z",
  request: { method: "GET", url: "https://a.example/v1/search", headerNames: [] },
  upstream: { status: 200, latencyMs: 120, contentType: "application/json", bodyKind: "JSON", body: { posts: [] }, transportError: null },
  inferred: {
    endpoint: "https://a.example/v1/search",
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    outputSchema: { type: "object", properties: { posts: { type: "array" } }, required: ["posts"] },
    examples: [],
    requestMapping: {},
    responseMapping: null,
    operationId: "searchPosts",
  },
  warnings: [
    { code: "MISSING_TEST_VALUES", detail: "q" },
    { code: "MISSING_TEST_VALUES", detail: "page" },
  ],
};

function mount(onUse = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TryPanel onUse={onUse} />
    </QueryClientProvider>,
  );
  return onUse;
}

const paste = (value: string) => fireEvent.change(screen.getByLabelText("A curl command or an OpenAPI document"), { target: { value } });

describe("TryPanel", () => {
  it("shows the answer, every warning (repeats included) and what was found", async () => {
    service.tryProviderTool.mockResolvedValue(result);
    const onUse = mount();
    paste("openapi: 3.0.0\npaths: {}");
    fireEvent.click(screen.getByRole("button", { name: /Try it/ }));
    const box = await screen.findByTestId("try-result");
    expect(box.textContent).toContain("GET https://a.example/v1/search answered 200 in 120 ms.");
    expect(box.querySelectorAll("li")).toHaveLength(2);
    expect(screen.getByTestId("try-found").textContent).toContain("Found inputs: q · outputs: posts · 0 examples");
    fireEvent.click(screen.getByRole("button", { name: "Use these inputs, outputs and example" }));
    expect(onUse).toHaveBeenCalledWith({ inputSchema: result.inferred.inputSchema, outputSchema: result.inferred.outputSchema, examples: [] });
    expect(screen.getByTestId("try-applied").textContent).not.toContain("cleared");
  });

  it("lists the problems, then resends the picked operation", async () => {
    service.tryProviderTool.mockRejectedValueOnce(
      new ApiError("TOOL_PROVIDER_TOOL_INVALID", "x", 400, "/", { problems: ["name the operation to try (operationId); there are: searchPosts, getPost"] }),
    );
    service.tryProviderTool.mockResolvedValueOnce(result);
    mount();
    paste("openapi: 3.0.0\npaths: {}");
    fireEvent.click(screen.getByRole("button", { name: /Try it/ }));
    fireEvent.change(await screen.findByTestId("try-operations"), { target: { value: "getPost" } });
    fireEvent.click(screen.getByRole("button", { name: "Try this operation" }));
    await screen.findByTestId("try-result");
    expect(service.tryProviderTool).toHaveBeenLastCalledWith({ openapi: "openapi: 3.0.0\npaths: {}", operationId: "getPost" });
  });

  it("asks for a header when an OpenAPI endpoint wants one, and clears it after use", async () => {
    service.tryProviderTool.mockResolvedValue({ ...result, warnings: [{ code: "AUTH_REQUIRED", detail: "401" }] });
    mount();
    paste("openapi: 3.0.0\npaths: {}");
    fireEvent.click(screen.getByRole("button", { name: /Try it/ }));
    fireEvent.change(await screen.findByTestId("try-headers"), { target: { value: "Authorization: Bearer secret-123" } });
    fireEvent.click(screen.getByRole("button", { name: /Try it/ }));
    await waitFor(() => expect(service.tryProviderTool).toHaveBeenLastCalledWith({ openapi: "openapi: 3.0.0\npaths: {}", headers: { Authorization: "Bearer secret-123" } }));
    fireEvent.click(await screen.findByRole("button", { name: "Use these inputs, outputs and example" }));
    expect(screen.getByTestId("try-applied").textContent).toContain("cleared");
    expect((screen.getByLabelText("A curl command or an OpenAPI document") as HTMLTextAreaElement).value).toBe("");
    expect(document.body.textContent).not.toContain("secret-123");
  });
});
