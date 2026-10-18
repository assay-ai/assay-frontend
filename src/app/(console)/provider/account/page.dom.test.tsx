// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/* B9: Account names the public name and the payout wallet, each with where to change it. */
const handle = vi.hoisted(() => ({ value: { handle: "acme", status: "ACTIVE", lockedAt: null, canChange: true } as unknown }));

vi.mock("@/services/provider-registration.service", () => ({
  getProviderRegistration: vi.fn(async () => ({
    registration: {
      id: "p1",
      legalName: "Acme",
      technicalContact: { name: "Alex", email: "alex@acme.example" },
      ownerContact: { name: "Sam", email: "sam@acme.example" },
      acceptedTerms: {
        providerAgreementVersion: "2026-04-01",
        payoutTermsVersion: "2026-04-01",
        slashPolicyVersion: "2026-04-01",
        acceptedAt: "2026-10-01T00:00:00Z",
      },
      payoutAccounts: [
        { chainId: "eip155:46630", accountId: "eip155:46630:0xabc0000000000000000000000000000000000001", provedAt: "", status: "ACTIVE" },
      ],
    },
    terms: { providerAgreementVersion: "2026-04-01", payoutTermsVersion: "2026-04-01", slashPolicyVersion: "2026-04-01" },
  })),
}));
vi.mock("@/services/account.service", () => ({
  listAgents: vi.fn(async () => ({ items: [] })),
  listCredentials: vi.fn(async () => ({ items: [] })),
  createCredential: vi.fn(),
}));
vi.mock("@/components/toolsets/use-toolsets", () => ({
  useOrgHandle: () => ({ isPending: false, data: handle.value }),
}));
vi.mock("@/hooks/useChainName", () => ({ useChainName: () => () => "Robinhood Chain testnet" }));

import ProviderAccountPage from "./page";

afterEach(cleanup);

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProviderAccountPage />
    </QueryClientProvider>,
  );
}

describe("Account: public name and payout wallet", () => {
  it("shows both, with where to change each, and an Edit on contacts", async () => {
    handle.value = { handle: "acme", status: "ACTIVE", lockedAt: null, canChange: true };
    mount();
    expect(await screen.findByText("@acme")).toBeTruthy();
    expect(screen.getByText("0xabc0000000000000000000000000000000000001")).toBeTruthy();
    expect(screen.getByText("Robinhood Chain testnet")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Change it/ }).getAttribute("href")).toBe("/provider/setup?step=wallet");
    expect(screen.getByRole("link", { name: /Edit/ }).getAttribute("href")).toBe("/provider/setup?step=you");
  });

  it("says how to claim a public name when there is none", async () => {
    handle.value = { handle: null, status: null, lockedAt: null, canChange: true };
    mount();
    expect(await screen.findByText("Not claimed yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "publish your API" }).getAttribute("href")).toBe("/provider/apis/new");
  });
});
