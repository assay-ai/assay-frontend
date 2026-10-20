// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
  An unreachable API used to put the whole app in a loop: `/chains` failed,
  the gate mounted the app, a screen's own `useChains()` refetched the failed
  query on mount, the query went back to pending, the gate unmounted the app
  for the splash, and the request failed again — hundreds of `/chains` (and
  every page's own reads) a second, and a splash forever.
*/
const getChains = vi.hoisted(() => vi.fn());
vi.mock("@/services/chains.service", () => ({ getChains }));
vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@privy-io/react-auth/solana", () => ({ toSolanaWalletConnectors: () => [] }));
vi.mock("@/providers/PrivySessionBridge", () => ({
  PrivySessionBridge: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/features/account-block/account-block-bridge", () => ({
  AccountBlockBridge: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/providers/ThemeProvider", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { useChains } from "@/hooks/useChains";

import { Providers } from "./index";

/** A screen that reads the chain list itself, as most screens do. */
function Screen() {
  const chains = useChains();
  return <p>screen: {chains.status}</p>;
}

afterEach(() => cleanup());

describe("ChainsGate with an unreachable API", () => {
  it("mounts the app once and does not loop on /chains", async () => {
    getChains.mockRejectedValue(new Error("Network Error"));

    render(
      <Providers>
        <Screen />
      </Providers>,
    );

    await screen.findByText(/^screen:/);
    // Long enough for a loop to show itself many times over.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(screen.getByText(/^screen:/)).toBeTruthy();
    expect(getChains.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("still holds the app on the splash until the first answer", async () => {
    let answer: (value: { chains: [] }) => void = () => undefined;
    getChains.mockReset();
    getChains.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    render(
      <Providers>
        <Screen />
      </Providers>,
    );

    expect(screen.queryByText(/^screen:/)).toBeNull();
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
    answer({ chains: [] });
    await waitFor(() => expect(screen.getByText("screen: ready")).toBeTruthy());
  });
});
