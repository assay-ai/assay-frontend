// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const health = vi.hoisted(() => ({ getPlatformHealth: vi.fn() }));
const tools = vi.hoisted(() => ({ listCutoffs: vi.fn() }));
vi.mock("@/services/operator.service", () => health);
vi.mock("@/services/operator-provider-tools.service", () => tools);

import type { OperatorRole } from "@/interfaces/operator";

import { mayConfirmCutoffs, mayDecideCallDisputes, mayReviewTools } from "./provider-tool-review";
import { useToolWork } from "./use-tool-work";

afterEach(() => {
  cleanup();
  health.getPlatformHealth.mockReset();
  tools.listCutoffs.mockReset();
});

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ALL: OperatorRole[] = ["SRE", "ADJ", "ADJL", "POL", "POLA", "TRE", "TREA", "BD", "SUP", "CMP", "SEC", "OPS_ADMIN"];

describe("useToolWork", () => {
  it("counts the server's numbers only for a role that decides them, and takedowns by someone else", async () => {
    health.getPlatformHealth.mockResolvedValue({ pendingToolReviews: 3, openCallDisputes: 2 });
    tools.listCutoffs.mockResolvedValue([
      { actedBy: "op-2", confirmedAt: null, revertedAt: null },
      { actedBy: "op-1", confirmedAt: null, revertedAt: null },
      { actedBy: "op-2", confirmedAt: "2026-10-18T00:00:00.000Z", revertedAt: null },
    ]);
    expect(mayReviewTools(ALL) && mayDecideCallDisputes(ALL) && mayConfirmCutoffs(ALL)).toBe(true);
    const { result } = renderHook(() => useToolWork({ id: "op-1", roles: ALL }), { wrapper });
    await waitFor(() => expect(result.current.work).toEqual({ reviews: 3, callDisputes: 2, takedowns: 1 }));
    expect(result.current.readOnly).toEqual({ reviews: 0, callDisputes: 0 });
    expect(tools.listCutoffs).toHaveBeenCalledWith({ pending: true, targetType: "TOOL" });
  });

  it("shows a role that can't decide the counts as read-only, and never asks for cutoffs", async () => {
    health.getPlatformHealth.mockResolvedValue({ pendingToolReviews: 4, openCallDisputes: 1 });
    const role = ALL.find((r) => !mayReviewTools([r]) && !mayDecideCallDisputes([r]) && !mayConfirmCutoffs([r]));
    expect(role).toBeDefined();
    const { result } = renderHook(() => useToolWork({ id: "op-1", roles: [role!] }), { wrapper });
    await waitFor(() => expect(result.current.readOnly).toEqual({ reviews: 4, callDisputes: 1 }));
    expect(result.current.work).toEqual({ reviews: 0, callDisputes: 0, takedowns: 0 });
    expect(tools.listCutoffs).not.toHaveBeenCalled();
  });

  it("asks nothing while signed out", () => {
    renderHook(() => useToolWork(null), { wrapper });
    expect(health.getPlatformHealth).not.toHaveBeenCalled();
  });
});
