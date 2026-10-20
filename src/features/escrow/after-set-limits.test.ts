import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuyerEscrow } from "@/interfaces";

const reads = vi.hoisted(() => ({ cached: null as unknown, revalidated: null as unknown }));

vi.mock("@/services/escrow.service", () => ({
  getEscrow: vi.fn(async () => reads.cached),
  revalidateEscrow: vi.fn(async () => reads.revalidated),
}));

import { getEscrow, revalidateEscrow } from "@/services/escrow.service";

import { applyLimitsSubmitted, escrowQueryKey, readEscrow } from "./after-set-limits";
import { LIMITS_LANDING_POLL_MS, LIMITS_LANDING_TIMEOUT_MS } from "./limits-form";

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

/*
  O7: the SetLimits answer usually carries the escrow as the relayer read it
  after the transaction. Then nothing is fetched for it; the escrow is only
  re-read, and only polled, while no read shows the signed limits yet.
*/
describe("applyLimitsSubmitted — reads only while the limits have not shown", () => {
  let queryClient: QueryClient;
  let clock = 0;
  const now = () => clock;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    clock = 0;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(escrowQueryKey(null), before);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Advances the fake clock and timers together. */
  async function advance(ms: number) {
    clock += ms;
    await vi.advanceTimersByTimeAsync(ms);
  }

  it("does not fetch the seeded entry, and refetches the other escrow reads on screen once", async () => {
    const other = new QueryObserver(queryClient, { queryKey: escrowQueryKey(CHAIN), queryFn: () => getEscrow(CHAIN) });
    const stop = other.subscribe(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(getEscrow).mockClear();
    reads.cached = after;

    await applyLimitsSubmitted(queryClient, null, signed, after, now);
    await vi.advanceTimersByTimeAsync(0);

    expect(revalidateEscrow).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(escrowQueryKey(null))).toEqual(after);
    expect(getEscrow).toHaveBeenCalledTimes(1);
    expect(getEscrow).toHaveBeenCalledWith(CHAIN);

    await advance(LIMITS_LANDING_TIMEOUT_MS);
    expect(revalidateEscrow).not.toHaveBeenCalled();
    expect(getEscrow).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reads once when the relayer's read is behind and the next read shows the limits", async () => {
    reads.revalidated = after;
    await applyLimitsSubmitted(queryClient, null, signed, before, now);
    await advance(LIMITS_LANDING_TIMEOUT_MS);

    expect(revalidateEscrow).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(escrowQueryKey(null))).toEqual(after);
  });

  it("keeps reading every poll interval while the reads are behind, and stops on the one that shows the limits", async () => {
    vi.mocked(revalidateEscrow)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    await applyLimitsSubmitted(queryClient, null, signed, null, now);
    expect(revalidateEscrow).toHaveBeenCalledTimes(1);

    await advance(LIMITS_LANDING_POLL_MS);
    expect(revalidateEscrow).toHaveBeenCalledTimes(2);
    await advance(LIMITS_LANDING_POLL_MS);
    expect(revalidateEscrow).toHaveBeenCalledTimes(3);
    expect(queryClient.getQueryData(escrowQueryKey(null))).toEqual(after);

    await advance(LIMITS_LANDING_TIMEOUT_MS);
    expect(revalidateEscrow).toHaveBeenCalledTimes(3);
  });

  it("gives up after the bounded wait when no read ever shows the limits", async () => {
    reads.revalidated = before;
    await applyLimitsSubmitted(queryClient, null, signed, null, now);
    await advance(LIMITS_LANDING_TIMEOUT_MS + 5 * LIMITS_LANDING_POLL_MS);
    const asked = vi.mocked(revalidateEscrow).mock.calls.length;
    expect(asked).toBeLessThanOrEqual(2 + LIMITS_LANDING_TIMEOUT_MS / LIMITS_LANDING_POLL_MS);

    await advance(LIMITS_LANDING_TIMEOUT_MS);
    expect(revalidateEscrow).toHaveBeenCalledTimes(asked);
  });
});

