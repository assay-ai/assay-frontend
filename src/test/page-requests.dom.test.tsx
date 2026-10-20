// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
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

import { countsByPath, countsByRequest, recorded, resetRecorded } from "./request-recorder";

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

async function mount(node: React.ReactNode) {
  const client = createAppQueryClient();
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
const BUYER_SHELL = ["GET /me/status", "GET /chains", "GET /escrow", "GET /spend-policy", "GET /tools", "GET /balances"];

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
