// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/* B9: Account names the public name and the payout wallet, each with where to change it. */
const keys = vi.hoisted(() => ({ agents: [] as unknown[], credentials: [] as unknown[] }));
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
  listAgents: vi.fn(async () => ({ items: keys.agents })),
  listCredentials: vi.fn(async () => ({ items: keys.credentials })),
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

describe("Account: API keys", () => {
  afterEach(() => {
    keys.agents = [];
    keys.credentials = [];
  });

  it("masks an API key and names an OAuth grant (null prefix) as an app sign-in", async () => {
    handle.value = { handle: "acme", status: "ACTIVE", lockedAt: null, canChange: true };
    const base = { agentId: "a1", scopes: [], lastUsedAt: null, expiresAt: null, revokedAt: null, createdAt: "2026-10-17T00:00:00Z" };
    keys.agents = [{ agentId: "a1", label: "Main" }];
    keys.credentials = [
      { ...base, id: "k1", name: "Deploy", prefix: "assay_sk_live_8f3a" },
      { ...base, id: "g1", name: "Claude Code · 2026-10-17", prefix: null, oauthClient: { name: "Claude Code" } },
      { ...base, id: "g2", name: "Another app", prefix: null },
    ];
    mount();
    expect(await screen.findByText("••••8f3a")).toBeTruthy();
    expect(screen.getByText("Signed in with Claude Code")).toBeTruthy();
    expect(screen.getByText("App sign-in")).toBeTruthy();
    expect(document.body.textContent).not.toContain("null");
  });

  // Provider routes are a signed-in person's only: a key made here could manage nothing.
  it("offers no key creation, and says a key cannot manage the account", async () => {
    keys.agents = [{ agentId: "a1", label: "Main" }];
    mount();
    expect(await screen.findByText("No API key yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /New API key|Create key/ })).toBeNull();
    expect(document.body.textContent).toContain("A key cannot manage your tools or this account: only a signed-in person can.");
    expect(document.body.textContent).not.toMatch(/deploy pipeline|script/i);
  });
});
