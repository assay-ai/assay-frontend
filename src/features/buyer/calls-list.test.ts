import { afterEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ listFreeToolCalls: vi.fn(), listToolCalls: vi.fn() }));
vi.mock("@/services/tool-calls.service", () => service);

import { ApiError } from "@/libs/ApiClient";

import { listCalls, resetFreeListSupport } from "./calls-list";

/* Lot 1 B5 (BUG-AGT-01): the Free chip lists served free calls; an older backend keeps today's list. */
const page = (items: unknown[]) => ({ items, pageInfo: { hasMore: false, nextCursor: null } });

afterEach(() => {
  vi.clearAllMocks();
  resetFreeListSupport();
});

describe("listCalls", () => {
  it("asks for the served free calls on the Free chip", async () => {
    service.listFreeToolCalls.mockResolvedValue(page([{ kind: "free", callId: "c1" }]));
    const answer = await listCalls("free", { limit: 50, toolId: "t1" });
    expect(answer.items).toEqual([{ kind: "free", callId: "c1" }]);
    expect(service.listFreeToolCalls).toHaveBeenCalledWith({ limit: 50, toolId: "t1" });
    expect(service.listToolCalls).not.toHaveBeenCalled();
  });

  it("falls back to the plain list once when the backend refuses include=free (400)", async () => {
    service.listFreeToolCalls.mockRejectedValue(new ApiError("API_VALIDATION_FAILED", "property include should not exist", 400));
    service.listToolCalls.mockResolvedValue(page([]));
    await listCalls("free", { limit: 50 });
    await listCalls("free", { limit: 50 });
    expect(service.listFreeToolCalls).toHaveBeenCalledTimes(1);
    expect(service.listToolCalls).toHaveBeenCalledTimes(2);
  });

  it("does not hide any other failure", async () => {
    service.listFreeToolCalls.mockRejectedValue(new ApiError("INTERNAL", "boom", 500));
    await expect(listCalls("free", { limit: 50 })).rejects.toMatchObject({ status: 500 });
  });

  it("leaves the other chips as they were (no include param)", async () => {
    service.listToolCalls.mockResolvedValue(page([]));
    await listCalls("charged", { limit: 50 });
    expect(service.listFreeToolCalls).not.toHaveBeenCalled();
    expect(service.listToolCalls).toHaveBeenCalledWith({ limit: 50, status: ["SETTLED"], refundable: undefined });
  });
});
