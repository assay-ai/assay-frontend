// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { appendFileSync } from "node:fs";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api", async () => (await import("@/test/request-recorder")).recordedApiModule());
vi.mock("@privy-io/react-auth", async () => (await import("@/test/request-recorder")).privyModule());
vi.mock("@privy-io/react-auth/solana", async () => (await import("@/test/request-recorder")).privySolanaModule());
const nav = vi.hoisted(() => ({ pathname: "/", search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined, prefetch: () => undefined }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { createAppQueryClient } from "@/providers/query-client";
import { setSharedReader } from "@/services/shared-reads";
import { ThemeProvider } from "@/providers/ThemeProvider";

import { ROBINHOOD_TESTNET } from "@/libs/chains/demo-chains";
import { demoAgentsWithKeys } from "@/libs/demo/demo-agent-health";

import { answerWith, countsByPath, countsByRequest, recorded, resetRecorded } from "./request-recorder";

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

async function mount(node: React.ReactNode, client = createAppQueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>{node}</ThemeProvider>
    </QueryClientProvider>,
  );
  await settle();
  return client;
}

/** Set REQUEST_COUNTS_FILE to keep what each page asked for (the numbers in the API-optimise report). */
function report(label: string, counts: Record<string, number>) {
  const file = process.env.REQUEST_COUNTS_FILE;
  if (file) appendFileSync(file, `${label} ${JSON.stringify(counts, null, 1)}\n`);
}

/** Exactly these endpoints, each requested once. */
function expectEachOnce(label: string, endpoints: readonly string[]) {
  report(label, countsByRequest());
  expect(countsByPath()).toEqual(Object.fromEntries(endpoints.map((endpoint) => [endpoint, 1])));
}

const AGENT_A = "b71e05a3-2c48-4d90-9f61-38ca7d0b2e54";
const AGENT_B = "9d4c1f80-6b2e-4a57-8c31-7e05b9a2d146";
const BINDING = "b1f7c2d4-8e35-4a19-b6c0-2d9f4e71a830";
/** The buyer shell's own reads, on every buyer page. */
// The account menu's provider entry ("List your API" / "Provider console") is read once signed in (onboarding run 3).
const BUYER_SHELL = ["GET /me/status", "GET /chains", "GET /escrow", "GET /spend-policy", "GET /tools", "GET /balances", "GET /providers/me/registration"];

beforeEach(() => {
  resetRecorded();
  nav.search = "";
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  // Each mount plugs its own client into the services' shared reads; unplug it.
  setSharedReader(null);
});

describe("each endpoint is requested once when a heavy page mounts", { timeout: 60_000 }, () => {
  it("Overview, in the buyer shell", async () => {
    nav.pathname = "/";
    const { default: Layout } = await import("@/app/(main)/layout");
    const { default: Overview } = await import("@/app/(main)/page");
    await mount(
      <Layout>
        <Overview />
      </Layout>,
    );
    expectEachOnce("OVERVIEW", [
      ...BUYER_SHELL,
      "GET /overview",
      "GET /agents",
      "GET /escrow/delegates",
      "GET /catalogue/providers",
      "GET /catalogue/tools",
      "GET /tool-calls",
    ]);
  });

  it("Agents & keys, in the buyer shell", async () => {
    nav.pathname = "/agents";
    const { default: Layout } = await import("@/app/(main)/layout");
    const { default: Agents } = await import("@/app/(main)/agents/page");
    await mount(
      <Layout>
        <Agents />
      </Layout>,
    );
    expectEachOnce("AGENTS", [
      ...BUYER_SHELL,
      "GET /agents",
      "GET /escrow/delegates",
      `GET /agents/${AGENT_A}/servers`,
      `GET /agents/${AGENT_A}/access`,
      `GET /agents/${AGENT_B}/servers`,
      `GET /agents/${AGENT_B}/access`,
      "GET /catalogue/providers",
      "GET /catalogue/tools",
      "GET /tool-calls",
      "GET /toolsets",
    ]);
  });

  it("a provider's binding view, in the provider console", async () => {
    nav.pathname = "/provider/bindings/view";
    nav.search = `binding=${BINDING}`;
    const { default: Layout } = await import("@/app/(console)/layout");
    const { default: BindingView } = await import("@/app/(console)/provider/bindings/view/page");
    await mount(
      <Layout>
        <BindingView />
      </Layout>,
    );
    expectEachOnce("BINDING", [
      "GET /me/status",
      "GET /chains",
      "GET /providers/me",
      "GET /providers/me/registration",
      "GET /providers/me/stake",
      "GET /providers/me/earnings",
      "GET /providers/me/call-disputes",
      "GET /providers/me/sla-windows",
      "GET /providers/me/tool-bindings",
      "GET /providers/me/tool-bindings/catalogue",
      `GET /providers/me/tool-bindings/${BINDING}`,
      "GET /providers/me/tool-bindings/f2c84d19-3b6e-4a07-9d51-8e2f0a7c4b63/publish-check",
      "GET /notifications",
    ]);
  });
});

describe("requests in the minute after a heavy page mounted", { timeout: 60_000 }, () => {
  afterEach(() => vi.useRealTimers());

  async function minuteAfterMount(node: React.ReactNode): Promise<Record<string, number>> {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount(node);
    const before = recorded.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    return countsByPath(recorded.slice(before));
  }

  it("Overview: the overview, the agents with their keys and the pay permissions twice, the shell status once", async () => {
    nav.pathname = "/";
    const { default: Layout } = await import("@/app/(main)/layout");
    const { default: Overview } = await import("@/app/(main)/page");
    const minute = await minuteAfterMount(
      <Layout>
        <Overview />
      </Layout>,
    );
    report("OVERVIEW / MIN", minute);
    // Overview every 30 s, the agent rows every 30 s, the shell every minute; never /balances.
    expect(minute).toEqual({ "GET /overview": 2, "GET /agents": 2, "GET /escrow/delegates": 2, "GET /me/status": 1 });
  });

  it("Agents & keys", async () => {
    nav.pathname = "/agents";
    const { default: Layout } = await import("@/app/(main)/layout");
    const { default: Agents } = await import("@/app/(main)/agents/page");
    const minute = await minuteAfterMount(
      <Layout>
        <Agents />
      </Layout>,
    );
    report("AGENTS / MIN", minute);
    // The first agent waits for its first call (Servers in use, every 10 s); the shell every minute.
    expect(minute).toEqual({ [`GET /agents/${AGENT_A}/servers`]: 6, "GET /me/status": 1 });
  });

  it("a provider's binding view", async () => {
    nav.pathname = "/provider/bindings/view";
    nav.search = `binding=${BINDING}`;
    const { default: Layout } = await import("@/app/(console)/layout");
    const { default: BindingView } = await import("@/app/(console)/provider/bindings/view/page");
    const minute = await minuteAfterMount(
      <Layout>
        <BindingView />
      </Layout>,
    );
    report("BINDING / MIN", minute);
    // Every minute: the binding and its SLA window, the shell's status, hold, inbox and disputes.
    expect(minute).toEqual({
      "GET /me/status": 1,
      "GET /providers/me": 1,
      [`GET /providers/me/tool-bindings/${BINDING}`]: 1,
      "GET /providers/me/sla-windows": 1,
      "GET /notifications": 1,
      "GET /providers/me/call-disputes": 1,
    });
  });
});

describe("Overview with one agent whose keys are all revoked and one that pays", { timeout: 60_000 }, () => {
  afterEach(() => vi.useRealTimers());

  it("reads the agents and the pay permissions every 30 s, never in the 5-second listener", async () => {
    // As seen on testnet: "E2E-M2 agent" first, every key revoked; "My agent" paying, last call 4 h ago.
    answerWith("GET /agents", (params, fixture) => {
      const page = fixture() as { items: { agentId: string; label?: string; credentials?: { items: Record<string, unknown>[] } }[] };
      if (!params.include) return page;
      const paying = page.items.find((agent) => agent.credentials?.items.some((key) => key.delegateAccount && !key.revokedAt))!;
      const revoked = page.items.find((agent) => agent !== paying)!;
      const at = new Date(Date.now() - 4 * 3_600_000).toISOString();
      const keys = {
        [revoked.agentId]: (revoked.credentials?.items ?? []).map((key) => ({ ...key, revokedAt: key.revokedAt ?? at })),
        [paying.agentId]: (paying.credentials?.items ?? []).map((key) => (key.delegateAccount ? { ...key, lastUsedAt: at } : key)),
      };
      const strip = ({ credentials: _c, health: _h, ...agent }: Record<string, unknown>) => agent;
      return demoAgentsWithKeys(
        { items: [{ ...strip(revoked), label: "E2E-M2 agent" }, { ...strip(paying), label: "My agent" }] as never },
        keys,
      );
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    nav.pathname = "/";
    const { default: Layout } = await import("@/app/(main)/layout");
    const { default: Overview } = await import("@/app/(main)/page");
    await mount(
      <Layout>
        <Overview />
      </Layout>,
    );
    const before = recorded.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const minute = countsByPath(recorded.slice(before));
    report("TWO AGENTS / MIN", minute);
    expect(minute["GET /agents"]).toBeLessThanOrEqual(2);
    expect(minute["GET /escrow/delegates"]).toBeLessThanOrEqual(2);
    for (const [endpoint, count] of Object.entries(minute)) expect([endpoint, count <= 2]).toEqual([endpoint, true]);
  });
});

/** A provider who settles on two chains, as on testnet: the earnings are asked about per settlement asset. */
const SOLANA = {
  ...ROBINHOOD_TESTNET,
  chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  displayName: "Solana devnet",
  settlementAsset: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/token:4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

describe("provider console pages, each endpoint once on mount", { timeout: 60_000 }, () => {
  async function mountProviderPage(pathname: string, load: () => Promise<{ default: React.ComponentType }>, search = "") {
    answerWith("GET /chains", () => ({ chains: [ROBINHOOD_TESTNET, SOLANA] }));
    nav.pathname = pathname;
    nav.search = search;
    const { default: Layout } = await import("@/app/(console)/layout");
    const { default: Page } = await load();
    await mount(
      <Layout>
        <Page />
      </Layout>,
    );
    report(pathname.toUpperCase(), countsByRequest());
    return countsByPath();
  }

  // Each exact request once (two different report windows are two requests).
  const once = (_counts: Record<string, number>) => Object.entries(countsByRequest()).filter(([, n]) => n > 1);

  it("Home: this month's earnings and the last 30 days', each once", async () => {
    const counts = await mountProviderPage("/provider", () => import("@/app/(console)/provider/page"));
    expect(once(counts)).toEqual([]);
    // The screen's own windows (whole days); the asset look-up's 31 days end on the minute.
    const windows = new Set(
      recorded
        .filter((r) => r.path === "/providers/me/earnings" && String(r.params.to).endsWith("T00:00:00.000Z"))
        .map((r) => `${String(r.params.from)}..${String(r.params.to)}`),
    );
    expect(windows.size).toBe(2);
    // Onboarding wave 3: the console links back to the buyer app, on the phone bar and the rail.
    const back = screen.getAllByRole("link", { name: "Back to buyer app" });
    expect(back.length).toBe(2);
    for (const link of back) expect(link.getAttribute("href")).toBe("/");
  });

  it("Money: no call export until the download is asked for", async () => {
    const counts = await mountProviderPage("/provider/money", () => import("@/app/(console)/provider/money/page"));
    expect(counts["GET /providers/me/calls/export"]).toBeUndefined();
    expect(once(counts)).toEqual([]);
  });

  it("Money: the download reads the export once, and a second download re-uses it", async () => {
    URL.createObjectURL = vi.fn(() => "blob:csv");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await mountProviderPage("/provider/money", () => import("@/app/(console)/provider/money/page"));
    const exports = () => recorded.filter((r) => r.path === "/providers/me/calls/export").length;
    expect(exports()).toBe(0);
    const button = screen.getByRole("button", { name: /Download .* CSV/ });
    fireEvent.click(button);
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(exports()).toBe(1);
    fireEvent.click(button);
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    expect(exports()).toBe(1);
    click.mockRestore();
  });

  it("Listings", async () => {
    expect(once(await mountProviderPage("/provider/bindings", () => import("@/app/(console)/provider/bindings/page")))).toEqual([]);
  });

  it("Bad-result reports", async () => {
    expect(once(await mountProviderPage("/provider/call-disputes", () => import("@/app/(console)/provider/call-disputes/page")))).toEqual([]);
  });

  it("moving from Home to Money asks which assets were earned in once, not per page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Past the services' own few-second memo, so only the app's cache can answer.
      await vi.advanceTimersByTimeAsync(11_000);
      answerWith("GET /chains", () => ({ chains: [ROBINHOOD_TESTNET, SOLANA] }));
      nav.pathname = "/provider";
      const { default: Layout } = await import("@/app/(console)/layout");
      const { default: Home } = await import("@/app/(console)/provider/page");
      const { default: Money } = await import("@/app/(console)/provider/money/page");
      const client = await mount(
        <Layout>
          <Home />
        </Layout>,
      );
      const lookups = () => recorded.filter((r) => r.path === "/providers/me/earnings" && !String(r.params.to).endsWith("T00:00:00.000Z")).length;
      expect(lookups()).toBe(2);
      cleanup();
      await vi.advanceTimersByTimeAsync(11_000);
      nav.pathname = "/provider/money";
      await mount(
        <Layout>
          <Money />
        </Layout>,
        client,
      );
      expect(lookups()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a binding's view", async () => {
    expect(
      once(
        await mountProviderPage(
          "/provider/bindings/view",
          () => import("@/app/(console)/provider/bindings/view/page"),
          `binding=${BINDING}`,
        ),
      ),
    ).toEqual([]);
  });
});
