// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ meStatus: vi.fn(), markRead: vi.fn(async () => ({})) }));
const session = vi.hoisted(() => ({ ready: true, authenticated: true, user: { id: "did:privy:me" } }));
const bridge = vi.hoisted(() => ({ onBlocked: null as ((error: unknown) => void) | null }));

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => session }));
vi.mock("@/services/dashboard.service", () => ({ getMeStatus: api.meStatus }));
vi.mock("@/services/account.service", () => ({ markNotificationRead: api.markRead }));
vi.mock("@/libs/ApiClient", async () => {
  const actual = await vi.importActual<typeof import("@/libs/ApiClient")>("@/libs/ApiClient");
  return {
    ...actual,
    onAccountBlocked: (handler: ((error: unknown) => void) | null) => {
      bridge.onBlocked = handler;
    },
  };
});

import { useMarkAlertsRead } from "@/components/layout/alert-entry";
import { AccountBlockBridge } from "@/features/account-block/account-block-bridge";
import { getAccountBlockSnapshot, reportBlockedRefusal, resetAccountBlock } from "@/features/account-block/state";
import { useAccountBlockStatus } from "@/features/account-block/use-account-block";
import { useBuyerDebtsQuery } from "@/features/buyer-debt/settle-debt-sheet";
import { OVERVIEW_KEY } from "@/features/buyer/use-overview";

import { ME_STATUS_KEY, ME_STATUS_POLL_MS, useMeStatusPart } from "./use-me-status";

const ACCOUNT = "eip155:46630:0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1";
const status = (overrides: Record<string, unknown> = {}) => ({
  blockStatus: { blocked: false, blocks: [] },
  unreadCount: { count: 3 },
  debts: { account: ACCOUNT, debts: [] },
  ...overrides,
});

function Shell() {
  const block = useAccountBlockStatus();
  const unread = useMeStatusPart("unreadCount");
  const debts = useBuyerDebtsQuery();
  // More debt readers, as a page with call rows has: they must not poll on their own.
  useBuyerDebtsQuery();
  useBuyerDebtsQuery();
  const part = (q: { isError: boolean; isPending: boolean; data?: unknown }, show: (d: never) => string) =>
    q.isError ? "error" : q.isPending ? "pending" : show(q.data as never);
  return (
    <div>
      <span data-testid="block">{part(block, (d: { blocked: boolean }) => String(d.blocked))}</span>
      <span data-testid="unread">{part(unread, (d: { count: number }) => String(d.count))}</span>
      <span data-testid="debts">{part(debts, (d: { debts: unknown[] }) => String(d.debts.length))}</span>
    </div>
  );
}

function mount(child: React.ReactNode = <Shell />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}>{child}</QueryClientProvider>) };
}

const text = (id: string) => screen.getByTestId(id).textContent;

beforeEach(() => {
  api.meStatus.mockReset();
  api.markRead.mockClear();
  session.ready = true;
  session.authenticated = true;
  resetAccountBlock();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GET /me/status for the shell", () => {
  it("answers the block status, the bell's count and the debts from ONE request", async () => {
    api.meStatus.mockResolvedValue(status());
    mount();
    await waitFor(() => expect(text("unread")).toBe("3"));
    expect(text("block")).toBe("false");
    expect(text("debts")).toBe("0");
    expect(api.meStatus).toHaveBeenCalledTimes(1);
  });

  it("is not asked without a session: it would 401, and a 401 signs out", async () => {
    session.ready = true;
    session.authenticated = false;
    api.meStatus.mockResolvedValue(status());
    mount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.meStatus).not.toHaveBeenCalled();
    expect(text("unread")).toBe("pending");
  });

  it("reads a null part as that part's failed read, and answers the others", async () => {
    api.meStatus.mockResolvedValue(status({ unreadCount: null, debts: null }));
    mount();
    await waitFor(() => expect(text("block")).toBe("false"));
    expect(text("unread")).toBe("error");
    expect(text("debts")).toBe("error");
  });

  it("a failed request fails all three, as three failed polls did", async () => {
    api.meStatus.mockRejectedValue(new Error("down"));
    mount();
    await waitFor(() => expect(text("block")).toBe("error"));
    expect(text("unread")).toBe("error");
    expect(text("debts")).toBe("error");
  });

  it("polls once a minute, however many parts are read", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.meStatus.mockResolvedValue(status());
    mount();
    await waitFor(() => expect(api.meStatus).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ME_STATUS_POLL_MS);
    });
    await waitFor(() => expect(api.meStatus).toHaveBeenCalledTimes(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ME_STATUS_POLL_MS / 2);
    });
    expect(api.meStatus).toHaveBeenCalledTimes(2);
  });

  it("a part that comes back after a null one reads again", async () => {
    api.meStatus.mockResolvedValueOnce(status({ debts: null }));
    const { client } = mount();
    await waitFor(() => expect(text("debts")).toBe("error"));
    api.meStatus.mockResolvedValueOnce(status({ debts: { account: ACCOUNT, debts: [{ intentId: "i1" }] } }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ME_STATUS_KEY });
    });
    await waitFor(() => expect(text("debts")).toBe("1"));
  });

  it("confirms the block for the write guard, and a lifted block clears its refusal", async () => {
    api.meStatus.mockResolvedValueOnce(status({ blockStatus: { blocked: true, blocks: [] } }));
    const { client } = mount();
    await waitFor(() => expect(getAccountBlockSnapshot().confirmed).toBe(true));
    reportBlockedRefusal({ code: "ACCOUNT_BLOCKED", message: "blocked" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    api.meStatus.mockResolvedValueOnce(status());
    await act(async () => {
      await client.invalidateQueries({ queryKey: ME_STATUS_KEY });
    });
    await waitFor(() => expect(getAccountBlockSnapshot().confirmed).toBe(false));
    expect(getAccountBlockSnapshot().refusal).toBeNull();
  });
});

describe("after a blocked refusal", () => {
  it("reads the block status again at once, so the banner can say whether it is this account", async () => {
    api.meStatus.mockResolvedValue(status());
    mount(
      <AccountBlockBridge>
        <Shell />
      </AccountBlockBridge>,
    );
    await waitFor(() => expect(api.meStatus).toHaveBeenCalledTimes(1));
    act(() => bridge.onBlocked!({ code: "ACCOUNT_BLOCKED", message: "blocked" }));
    await waitFor(() => expect(api.meStatus).toHaveBeenCalledTimes(2));
  });
});

describe("after the person's own write", () => {
  it("marking an alert read refreshes the bell's count and Overview at once", async () => {
    api.meStatus.mockResolvedValueOnce(status()).mockResolvedValueOnce(status({ unreadCount: { count: 2 } }));
    let mark: ReturnType<typeof useMarkAlertsRead> | null = null;
    let client: QueryClient | null = null;
    function Marker() {
      const mutation = useMarkAlertsRead();
      const queryClient = useQueryClient();
      React.useEffect(() => {
        mark = mutation;
        client = queryClient;
      });
      return null;
    }
    mount(
      <>
        <Shell />
        <Marker />
      </>,
    );
    await waitFor(() => expect(text("unread")).toBe("3"));
    client!.setQueryData([...OVERVIEW_KEY, "x", null], { any: true });
    await act(async () => {
      await mark!.mutateAsync(["n1"]);
    });
    await waitFor(() => expect(text("unread")).toBe("2"));
    expect(api.markRead).toHaveBeenCalledWith("n1");
    expect(client!.getQueryState([...OVERVIEW_KEY, "x", null])?.isInvalidated).toBe(true);
  });
});
