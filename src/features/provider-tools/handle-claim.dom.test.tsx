// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }), usePathname: () => "/provider/apis/new", useSearchParams: () => new URLSearchParams() }));
const claimOrgHandle = vi.hoisted(() => vi.fn());
vi.mock("@/services/toolsets.service", async (original) => ({ ...(await original<object>()), claimOrgHandle }));
vi.mock("@/services/chains.service", () => ({
  getChains: async () => ({ chains: [{ chainId: "eip155:46630", displayName: "Robinhood Chain testnet", settlementAssetSymbol: "USDG" }] }),
}));

import { ApiError } from "@/libs/ApiClient";

import { HandleClaim } from "./name-step";

afterEach(() => cleanup());

/* Onboarding wave item 4: the public name is checked as it is typed, by the server's rule. */
describe("HandleClaim", () => {
  function mount(freeClaim: boolean | null = null) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <HandleClaim freeClaim={freeClaim} />
      </QueryClientProvider>,
    );
    return { input: screen.getByRole("textbox", { name: /Public name/ }) as HTMLInputElement, claim: () => screen.getByRole("button", { name: "Claim" }) as HTMLButtonElement };
  }

  it("refuses 1abc before any request, with the rule, and keeps Claim off", () => {
    const { input, claim } = mount();
    fireEvent.change(input, { target: { value: "1abc" } });
    expect(screen.getByText("Use 3–24 lowercase letters, digits or “-”, starting with a letter.")).toBeTruthy();
    expect(claim().disabled).toBe(true);
    fireEvent.click(claim());
    expect(claimOrgHandle).not.toHaveBeenCalled();
  });

  it("turns Claim on for a name the server would take", () => {
    const { input, claim } = mount();
    fireEvent.change(input, { target: { value: "acme-labs" } });
    expect(claim().disabled).toBe(false);
  });

  /* Onboarding wave 3: the cost is said before any click, and a refusal for funding links to Add funds. */
  it("says up front that a set-up provider's first name is free, and what it takes otherwise", () => {
    mount(true);
    expect(screen.getByTestId("handle-claim-free").textContent).toMatch(/first public name is free: no funds needed/);
    cleanup();
    mount(false);
    expect(screen.getByTestId("handle-claim-cost").textContent).toMatch(/funds added once \(at least \$5\)/);
    expect(screen.queryByTestId("handle-claim-free")).toBeNull();
  });

  it("turns a refusal for funding into Add funds, the testnet minimum, gas and the faucet, and a retry", async () => {
    claimOrgHandle.mockReset();
    claimOrgHandle.mockRejectedValueOnce(
      new ApiError("TOOLSET_HANDLE_CLAIM_REFUSED", "x", 403, "/org/handle", { reason: "NOT_VERIFIED", fundingRequired: true, minimumDepositUsd: 5, providerSetUp: false }),
    );
    const { input, claim } = mount(false);
    fireEvent.change(input, { target: { value: "acme-labs" } });
    fireEvent.click(claim());
    const box = await screen.findByTestId("handle-claim-funding");
    expect(box.textContent).toMatch(/Add at least \$5 in funds once, or finish provider setup/);
    const link = screen.getByRole("link", { name: /Add funds/ }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/funding?action=deposit");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    await waitFor(() => expect(box.textContent).toMatch(/at least \$5 in USDG plus a little ETH for gas.*Robinhood Chain testnet faucet/));
    claimOrgHandle.mockResolvedValueOnce({ handle: "acme-labs", status: "ACTIVE", lockedAt: null, canChange: true });
    fireEvent.click(screen.getByRole("button", { name: /try again/ }));
    await waitFor(() => expect(claimOrgHandle).toHaveBeenCalledTimes(2));
    expect(claimOrgHandle).toHaveBeenLastCalledWith("acme-labs");
  });
});
