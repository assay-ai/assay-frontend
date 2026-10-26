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
const wallets = vi.hoisted(() => ({ connected: [] as string[] }));
vi.mock("@/hooks/useSigner", () => ({ useConnectedAddresses: () => wallets.connected }));
const served = vi.hoisted(() => ({ chains: [] as { chainId: string; namespace: string; displayName: string }[] }));
vi.mock("@/hooks/useChains", async (original) => ({
  ...(await original<object>()),
  useChains: () => ({ status: "ready", chains: served.chains }),
}));

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

  it("says up front that the second person is optional until a paid listing (wave 2 item 5)", () => {
    step = "you";
    allDone();
    mount();
    expect(screen.getByText("A second person (optional for now)")).toBeTruthy();
    expect(screen.getByText(/we ask for it before you charge for a tool/)).toBeTruthy();
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

  /* Onboarding wave 2 item 4: only wallets a served chain can pay, picked for you when one fits. */
  it("hides a Solana wallet when only EVM chains are served, and names the one payout address", () => {
    step = "wallet";
    const evm = "0x1111111111111111111111111111111111111111";
    const solana = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    wallets.connected = [solana, evm];
    served.chains = [{ chainId: "eip155:46630", namespace: "eip155", displayName: "Robinhood Chain testnet" }];
    allDone({
      steps: [
        { key: "account", status: "DONE" },
        { key: "payoutWallet", status: "TODO" },
        { key: "endpoint", status: "TODO" },
      ],
      address: evm,
      setAddress: () => undefined,
      chainId: "eip155:46630",
      walletBlockedBy: null,
      prove: async () => undefined,
    });
    mount();
    expect(screen.queryByText(solana)).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Wallet to be paid in" })).toBeNull();
    expect(screen.getByTestId("payout-wallet-line").textContent).toBe(`Payouts go to ${evm} on Robinhood Chain testnet.`);
    wallets.connected = [];
    served.chains = [];
  });
});
