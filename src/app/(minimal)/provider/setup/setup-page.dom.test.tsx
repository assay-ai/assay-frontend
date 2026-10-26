// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libs/ApiClient";

let step = "you";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => "/provider/setup",
  useSearchParams: () => new URLSearchParams({ step }),
}));
vi.mock("@privy-io/react-auth", () => ({ useConnectWallet: () => ({ connectWallet: () => undefined }), usePrivy: () => ({ ready: false, authenticated: false }) }));
vi.mock("@/hooks/useSigner", () => ({ useConnectedAddresses: () => [] }));

const refused = new ApiError("ENDPOINT_REFUSED", "This address cannot be used: it resolves to a private network.", 422);
const setup = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/features/m41/use-setup", async (original) => ({ ...(await original<object>()), useProviderSetup: () => setup.current }));

import ProviderSetupPage from "./page";

function allDone(over: Record<string, unknown> = {}) {
  setup.current = {
    loading: false,
    loadError: null,
    registered: true,
    accepted: true,
    state: { registration: { acceptedTerms: true } },
    steps: [
      { key: "account", status: "DONE" },
      { key: "payoutWallet", status: "DONE" },
      { key: "endpoint", status: "DONE" },
    ],
    terms: { commercialTerms: [], acceptanceLine: "" },
    account: { legalName: "Acme", technicalName: "a", technicalEmail: "a@acme.example", ownerName: "b", ownerEmail: "b@acme.example", timezone: "UTC" },
    accountErrors: {},
    payoutAccounts: [],
    savedEndpoint: "https://api.acme.example",
    endpoint: "https://api.acme.example",
    setEndpoint: () => undefined,
    probe: null,
    checking: false,
    check: () => undefined,
    checkError: null,
    ...over,
  };
}

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProviderSetupPage />
    </QueryClientProvider>,
  );
}

afterEach(() => cleanup());

/* Onboarding wave item 4. */
describe("provider setup", () => {
  it("shows each step's real state: finished steps read done from the first step too", () => {
    step = "you";
    allDone();
    mount();
    const nav = screen.getByRole("navigation", { name: "Setup progress" });
    expect(nav.textContent).toContain("Get paid, done");
    expect(nav.textContent).toContain("Your API, done");
    expect(nav.textContent).not.toContain("not started");
  });

  it("says a refused address once after Finish setup", async () => {
    step = "api";
    allDone({
      steps: [
        { key: "account", status: "DONE" },
        { key: "payoutWallet", status: "DONE" },
        { key: "endpoint", status: "TODO" },
      ],
      savedEndpoint: null,
      endpoint: "https://10.0.0.1/api",
      checkError: refused,
      declareAsync: async () => {
        throw refused;
      },
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Finish setup/ }));
    // Wait for the save to fail and its sentence to be set, then count it.
    await waitFor(() => expect(screen.getByRole("button", { name: /Finish setup/ }).getAttribute("aria-busy")).toBeNull());
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(screen.getAllByText(/resolves to a private network/)).toHaveLength(1);
  });
});
