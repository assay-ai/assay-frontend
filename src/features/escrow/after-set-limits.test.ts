import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuyerEscrow } from "@/interfaces";

const reads = vi.hoisted(() => ({ cached: null as unknown, revalidated: null as unknown }));

vi.mock("@/services/escrow.service", () => ({
  getEscrow: vi.fn(async () => reads.cached),
  revalidateEscrow: vi.fn(async () => reads.revalidated),
}));

import { getEscrow, revalidateEscrow } from "@/services/escrow.service";

import { applyLimitsSubmitted, escrowQueryKey, readEscrow } from "./after-set-limits";

const CHAIN = "eip155:46630";
const signed = { maxVoucherAmount: "1000000", maxPerWindow: "9000000" };

const escrowWith = (maxVoucherAmount: string, maxPerWindow: string): BuyerEscrow =>
  ({
    exists: true,
    maxVoucherAmount: { amount: maxVoucherAmount, asset: "usdc", decimals: 6 },
    maxPerWindow: { amount: maxPerWindow, asset: "usdc", decimals: 6 },
  }) as unknown as BuyerEscrow;

const before = escrowWith("1000000", "10000000");
const after = escrowWith("1000000", "9000000");

describe("escrowQueryKey", () => {
  it("is the key the limits drawer and the escrow drawer both read", () => {
    expect(escrowQueryKey(CHAIN)).toEqual(["escrow", CHAIN]);
    expect(escrowQueryKey(null)).toEqual(["escrow", null]);
  });
});

describe("readEscrow", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the plain (HTTP-cacheable) GET when nothing is awaited", async () => {
    await readEscrow(CHAIN, null);
    expect(getEscrow).toHaveBeenCalledWith(CHAIN);
    expect(revalidateEscrow).not.toHaveBeenCalled();
  });

  it("revalidates past the HTTP cache while a SetLimits is awaited", async () => {
    await readEscrow(CHAIN, { body: signed, since: 0 });
    expect(revalidateEscrow).toHaveBeenCalledWith(CHAIN);
    expect(getEscrow).not.toHaveBeenCalled();
  });
});

describe("applyLimitsSubmitted", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(escrowQueryKey(CHAIN), before);
    queryClient.setQueryData(escrowQueryKey(null), before);
    // What the browser's HTTP cache would answer a plain GET with: the pre-write body.
    reads.cached = before;
    reads.revalidated = after;
  });

  it("seeds this chain's entry from the relayer's read when it shows the signed limits", async () => {
    await applyLimitsSubmitted(queryClient, CHAIN, signed, after);

    expect(queryClient.getQueryData(escrowQueryKey(CHAIN))).toEqual(after);
    expect(queryClient.getQueryState(escrowQueryKey(CHAIN))?.isInvalidated).toBe(false);
    expect(revalidateEscrow).not.toHaveBeenCalled();
    expect(getEscrow).not.toHaveBeenCalled();
  });

  it("re-reads past the HTTP cache when the relayer's read is behind", async () => {
    await applyLimitsSubmitted(queryClient, CHAIN, signed, before);

    expect(revalidateEscrow).toHaveBeenCalledWith(CHAIN);
    expect(getEscrow).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(escrowQueryKey(CHAIN))).toEqual(after);
  });

  it("re-reads past the HTTP cache when there is no relayer read (self-sent transaction)", async () => {
    await applyLimitsSubmitted(queryClient, CHAIN, signed, null);

    expect(revalidateEscrow).toHaveBeenCalledWith(CHAIN);
    expect(queryClient.getQueryData(escrowQueryKey(CHAIN))).toEqual(after);
  });

  it("does not overwrite the seed with a plain refetch of the active query", async () => {
    // An active observer on the key, whose queryFn is the plain HTTP-cached GET —
    // what the screen had at the moment the write came back.
    const observer = new QueryObserver(queryClient, {
      queryKey: escrowQueryKey(CHAIN),
      queryFn: () => getEscrow(CHAIN),
      staleTime: Infinity,
    });
    const stop = observer.subscribe(() => undefined);

    await applyLimitsSubmitted(queryClient, CHAIN, signed, after);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getEscrow).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(escrowQueryKey(CHAIN))).toEqual(after);
    stop();
  });

  it("marks the other chains' escrow entries stale without refetching them", async () => {
    await applyLimitsSubmitted(queryClient, CHAIN, signed, after);

    expect(queryClient.getQueryState(escrowQueryKey(null))?.isInvalidated).toBe(true);
    expect(getEscrow).not.toHaveBeenCalled();
  });

  it("keeps the old figures when the revalidated read fails, for the poll to retry", async () => {
    vi.mocked(revalidateEscrow).mockRejectedValueOnce(new Error("offline"));

    await expect(applyLimitsSubmitted(queryClient, CHAIN, signed, null)).resolves.toBeUndefined();
    expect(queryClient.getQueryData(escrowQueryKey(CHAIN))).toEqual(before);
  });
});
