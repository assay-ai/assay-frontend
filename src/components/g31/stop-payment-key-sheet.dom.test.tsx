// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const EVM = "eip155:46630";
const PAYER = `${EVM}:0x18103e1D79257c695B2FBbd4b346CD2Ba7927296`;
const DELEGATE = `${EVM}:0x76B98fD03eE16e2673532769891f1400b447d10C`;

const reads = vi.hoisted(() => ({ fail: true }));
vi.mock("@/hooks/useSigner", () => ({
  useSigner: () => ({ status: "hydrating" }),
  isUserRejection: () => false,
}));
vi.mock("@/services/delegation.service", () => ({
  listDelegates: vi.fn(async () => {
    if (reads.fail) throw new Error("rpc down");
    return { account: PAYER, delegates: [], tightenDelaySeconds: 3600 };
  }),
  createRevokeDelegateIntent: vi.fn(),
  submitRevokeDelegate: vi.fn(),
}));

import { StopPaymentKeySheet } from "./agent-payment-delegation";

afterEach(cleanup);

function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["chains"], { chains: [] });
  return render(
    <QueryClientProvider client={client}>
      <StopPaymentKeySheet account={PAYER} target={{ delegateAccount: DELEGATE, delegation: null }} onClose={() => undefined} onFinished={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("Stop it paying: a key whose permission is not known (the page's chain read failed)", () => {
  it("says it could not read the chain, offers Read again, and signs nothing", async () => {
    reads.fail = true;
    renderSheet();
    await waitFor(() => expect(screen.getByTestId("delegate-unreadable")).toBeTruthy());
    expect(screen.getByTestId("delegate-unreadable").textContent).toContain("may still be active and nothing can be signed yet");
    expect((screen.getByTestId("sign-revoke-delegate") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Read again" })).toBeTruthy();
  });

  it("after Read again finds no permission, the key reads as gone and still cannot be signed", async () => {
    reads.fail = true;
    renderSheet();
    await waitFor(() => expect(screen.getByTestId("delegate-unreadable")).toBeTruthy());
    reads.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    await waitFor(() => expect(screen.getByTestId("delegate-gone")).toBeTruthy());
    expect((screen.getByTestId("sign-revoke-delegate") as HTMLButtonElement).disabled).toBe(true);
  });
});
