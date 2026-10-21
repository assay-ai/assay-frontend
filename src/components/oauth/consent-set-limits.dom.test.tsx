// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SpendPolicy } from "@/services/limits.service";

/*
 * BUG-R2-01: the consent page re-renders every second ("started N seconds
 * ago") and its limits context hands back fresh objects each render. The
 * sheet must keep what the person typed through that, and "Save and approve"
 * must save the typed limits, then approve.
 */
const calls = vi.hoisted(() => [] as string[]);
const update = vi.hoisted(() => vi.fn());

const usd = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x0", decimals: 6 });
function policy(): SpendPolicy {
  return {
    id: "p1",
    scope: "AGENT",
    agentId: "agt-1",
    policyVersion: 1,
    asset: "eip155:46630/erc20:0x0",
    decimals: 6,
    perCallMax: usd("500000"),
    dailyCap: usd("10000000"),
    monthlyCap: usd("100000000"),
    maxCallsPerHour: null,
    maxCallsPerMinute: null,
    maxSpendPerHour: null,
    requireApprovalAbove: null,
    paused: false,
    changedBy: null,
    changeReason: null,
    createdAt: "2026-10-19T10:00:00.000Z",
  };
}

vi.mock("@/components/buyer-money/agent-limits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/buyer-money/agent-limits")>();
  return {
    ...actual,
    // Fresh objects on every render, as a re-render or a re-fetch gives them.
    useLimitsContext: () => ({
      policy: policy(),
      bootstrap: { assetId: "eip155:46630/erc20:0x0", decimals: 6, symbol: "USDC" },
      editableFor: "agt-1",
    }),
  };
});
vi.mock("@/services/limits.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/limits.service")>()),
  updateSpendPolicy: update,
}));
vi.mock("@/utils/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ConsentSetLimits } from "./consent-set-limits";

beforeEach(() => {
  vi.useFakeTimers();
  calls.length = 0;
  update.mockImplementation(async (body: unknown) => {
    calls.push("save");
    return { ...policy(), policyVersion: 2, body };
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** The card around the control: re-renders every second, like the consent card's ticker. */
function Ticking({ approve }: { approve: () => void }) {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <ConsentSetLimits
      agentId="agt-1"
      agentName="ops-bot"
      disabled={false}
      canAct={() => true}
      precheck={() => Promise.resolve(null)}
      approve={approve}
    />
  );
}

describe("BUG-R2-01: Approve and set limits keeps typed limits", () => {
  it("type, wait several seconds of re-renders, Save and approve: saves the typed value, then approves", async () => {
    const approve = vi.fn(() => calls.push("approve"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Ticking approve={approve} />
      </QueryClientProvider>,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve and set limits" }));
    });
    const field = () => document.querySelector<HTMLInputElement>("#budget-per-call")!;
    expect(field().value).toBe("0.5");
    const element = field();
    fireEvent.change(element, { target: { value: "0.40" } });

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(field()).toBe(element); // not remounted
    expect(field().value).toBe("0.40");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save and approve" }));
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({ perCallMax: "400000" });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["save", "approve"]);
  });
});
