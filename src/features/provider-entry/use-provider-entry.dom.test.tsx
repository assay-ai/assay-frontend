// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

const privy = vi.hoisted(() => ({ ready: true, authenticated: true }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => privy }));
const getProviderRegistration = vi.hoisted(() => vi.fn());
vi.mock("@/services/provider-registration.service", async (original) => ({ ...(await original<object>()), getProviderRegistration }));

import { ProviderEntryCard } from "./entry-card";

afterEach(() => {
  cleanup();
  getProviderRegistration.mockReset();
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProviderEntryCard />
    </QueryClientProvider>,
  );
}

/* Onboarding run 3: "List your API" popped in under the buyer checklist after the first paint. */
describe("ProviderEntryCard while the registration is read", () => {
  it("keeps its place, then shows List your API for a buyer", async () => {
    let answer: (value: never) => void = () => undefined;
    getProviderRegistration.mockReturnValue(new Promise((_, reject) => (answer = reject as never)));
    mount();
    expect(await screen.findByTestId("provider-entry-pending")).toBeTruthy();
    answer(new ApiError("PROVIDER_NOT_FOUND", "not found", 404) as never);
    await waitFor(() => expect(screen.queryByTestId("provider-entry-pending")).toBeNull());
    expect(screen.getByRole("link", { name: "List your API" })).toBeTruthy();
  });

  it("keeps no place for someone signed out", () => {
    privy.authenticated = false;
    mount();
    expect(screen.queryByTestId("provider-entry-pending")).toBeNull();
    privy.authenticated = true;
  });
});
