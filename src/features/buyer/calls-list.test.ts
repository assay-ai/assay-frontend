import { afterEach, describe, expect, it, vi } from "vitest";

const service = vi.hoisted(() => ({ listFreeToolCalls: vi.fn(), listToolCalls: vi.fn() }));
vi.mock("@/services/tool-calls.service", () => service);

import { ApiError } from "@/libs/ApiClient";

import { listCalls } from "./calls-list";

/* Lot 1 B5 (BUG-AGT-01): the Free chip lists served free calls; an older backend keeps today's list. */
const page = (items: unknown[]) => ({ items, pageInfo: { hasMore: false, nextCursor: null } });

afterEach(() => {
  vi.clearAllMocks();
});

describe("listCalls", () => {
  it("asks for the served free calls on the Free chip", async () => {
    service.listFreeToolCalls.mockResolvedValue(page([{ kind: "free", callId: "c1" }]));
    const answer = await listCalls("free", { limit: 50, toolId: "t1" });
    expect(answer.items).toEqual([{ kind: "free", callId: "c1" }]);
    expect(service.listFreeToolCalls).toHaveBeenCalledWith({ limit: 50, toolId: "t1" });
    expect(service.listToolCalls).not.toHaveBeenCalled();
  });

  it("falls back to the plain list per request when the backend refuses include=free (400)", async () => {
    service.listFreeToolCalls.mockRejectedValue(new ApiError("API_VALIDATION_FAILED", "property include should not exist", 400));
    service.listToolCalls.mockResolvedValue(page([]));
    expect((await listCalls("free", { limit: 50 })).source).toBe("plain");
    // A new first page tries the free list again: nothing is remembered for the session (review M3).
    expect((await listCalls("free", { limit: 50 })).source).toBe("plain");
    expect(service.listFreeToolCalls).toHaveBeenCalledTimes(2);
    // The next page of a plain first page stays on the plain list.
    await listCalls("free", { limit: 50, cursor: "c" }, "plain");
    expect(service.listFreeToolCalls).toHaveBeenCalledTimes(2);
  });

  it("does not fall back on a later free page: its cursor is the free list's", async () => {
    service.listFreeToolCalls.mockRejectedValue(new ApiError("API_VALIDATION_FAILED", "bad cursor", 400));
    await expect(listCalls("free", { limit: 50, cursor: "c" }, "free")).rejects.toMatchObject({ status: 400 });
    expect(service.listToolCalls).not.toHaveBeenCalled();
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
