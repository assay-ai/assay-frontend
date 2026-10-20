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

function expectEachOnce(label: string) {
  report(label, countsByRequest());
  const repeated = Object.entries(countsByPath()).filter(([, n]) => n > 1);
  expect(recorded.length).toBeGreaterThan(0);
  expect(repeated).toEqual([]);
}

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
afterEach(() => cleanup());

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
    expectEachOnce("OVERVIEW");
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
    expectEachOnce("AGENTS");
  });

  it("a provider's binding view, in the provider console", async () => {
    nav.pathname = "/provider/bindings/view";
    nav.search = "binding=b1f7c2d4-8e35-4a19-b6c0-2d9f4e71a830";
    const { default: Layout } = await import("@/app/(console)/layout");
    const { default: BindingView } = await import("@/app/(console)/provider/bindings/view/page");
    await mount(
      <Layout>
        <BindingView />
      </Layout>,
    );
    expectEachOnce("BINDING");
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

  it("Overview: the overview twice, the agents twice, the shell status once", async () => {
    nav.pathname = "/";
    const { default: Layout } = await import("@/app/(main)/layout");
    const { default: Overview } = await import("@/app/(main)/page");
    const minute = await minuteAfterMount(
      <Layout>
        <Overview />
      </Layout>,
    );
    report("OVERVIEW / MIN", minute);
    expect(minute["GET /overview"]).toBe(2);
    expect(minute["GET /me/status"]).toBe(1);
    expect(minute["GET /balances"]).toBeUndefined();
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
    expect(minute["GET /me/status"]).toBe(1);
  });

  it("a provider's binding view", async () => {
    nav.pathname = "/provider/bindings/view";
    nav.search = "binding=b1f7c2d4-8e35-4a19-b6c0-2d9f4e71a830";
    const { default: Layout } = await import("@/app/(console)/layout");
    const { default: BindingView } = await import("@/app/(console)/provider/bindings/view/page");
    const minute = await minuteAfterMount(
      <Layout>
        <BindingView />
      </Layout>,
    );
    report("BINDING / MIN", minute);
    expect(minute["GET /me/status"]).toBe(1);
  });
});
