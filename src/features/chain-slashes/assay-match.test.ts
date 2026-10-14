import { describe, expect, it, vi } from "vitest";

import type { SlashRequestLookup } from "@/interfaces/provider-slash-cases";
import type { HexString } from "@/libs/chains/evm/stake-slashes/address";

import { LOOKUP_CHUNK_SIZE, chunk, lookupAssayCases } from "./assay-match";

/** `0x` + 64 hex, from a counter, upper-cased so the lower-casing is exercised. */
function id(n: number): HexString {
  return `0x${n.toString(16).padStart(64, "0").toUpperCase()}` as HexString;
}

describe("chunk", () => {
  it("splits in order into runs of at most the size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 200)).toEqual([]);
    expect(chunk([1, 2], 200)).toEqual([[1, 2]]);
  });

  it("refuses a size that is not a positive integer", () => {
    expect(() => chunk([1], 0)).toThrow();
    expect(() => chunk([1], 1.5)).toThrow();
  });
});

describe("lookupAssayCases", () => {
  it("asks in chunks of at most 200 ids", async () => {
    expect(LOOKUP_CHUNK_SIZE).toBe(200);
    const ids = Array.from({ length: 450 }, (_, i) => id(i + 1));
    const lookup = vi.fn(async (_ids: readonly string[]): Promise<SlashRequestLookup> => ({
      matches: [],
    }));

    const index = await lookupAssayCases(ids, lookup);

    expect(index.status).toBe("checked");
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(lookup.mock.calls.map(([sent]) => sent.length)).toEqual([200, 200, 50]);
    const sent = lookup.mock.calls.flatMap(([chunkIds]) => chunkIds);
    expect(new Set(sent).size).toBe(450);
    expect(sent.every((value) => value === value.toLowerCase())).toBe(true);
  });

  it("sends exactly 200 ids in one call, and 201 in two", async () => {
    const lookup = vi.fn(async (_ids: readonly string[]): Promise<SlashRequestLookup> => ({
      matches: [],
    }));
    await lookupAssayCases(Array.from({ length: 200 }, (_, i) => id(i)), lookup);
    expect(lookup).toHaveBeenCalledTimes(1);

    lookup.mockClear();
    await lookupAssayCases(Array.from({ length: 201 }, (_, i) => id(i)), lookup);
    expect(lookup.mock.calls.map(([sent]) => sent.length)).toEqual([200, 1]);
  });

  it("de-duplicates ids case-insensitively before chunking", async () => {
    const lookup = vi.fn(async (_ids: readonly string[]): Promise<SlashRequestLookup> => ({
      matches: [],
    }));
    await lookupAssayCases([id(7), id(7).toLowerCase() as HexString, id(8)], lookup);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0][0]).toEqual([id(7).toLowerCase(), id(8).toLowerCase()]);
  });

  it("maps every chunk's matches by lower-case request id", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => id(i + 1));
    const lookup = async (requestIds: readonly string[]): Promise<SlashRequestLookup> => ({
      // The backend answers lower-case; an upper-case answer is still matched.
      matches: requestIds.includes(id(1).toLowerCase())
        ? [{ requestId: id(1), proposalId: "case-1" }]
        : [{ requestId: id(250).toLowerCase(), proposalId: "case-250", partId: "part-1" }],
    });

    const index = await lookupAssayCases(ids, lookup);

    expect(index.status).toBe("checked");
    if (index.status !== "checked") return;
    expect(index.known.size).toBe(2);
    expect(index.known.get(id(1).toLowerCase())).toEqual({ proposalId: "case-1" });
    expect(index.known.get(id(250).toLowerCase())).toEqual({ proposalId: "case-250" });
  });

  it("does not call the backend for an empty list", async () => {
    const lookup = vi.fn(async (): Promise<SlashRequestLookup> => ({ matches: [] }));
    const index = await lookupAssayCases([], lookup);
    expect(lookup).not.toHaveBeenCalled();
    expect(index).toEqual({ status: "checked", known: new Map() });
  });

  it("answers unavailable when any chunk fails, never a partial index", async () => {
    const ids = Array.from({ length: 300 }, (_, i) => id(i + 1));
    let call = 0;
    const lookup = async (): Promise<SlashRequestLookup> => {
      call += 1;
      if (call === 2) throw new Error("ACCOUNT_BLOCKED");
      return { matches: [{ requestId: id(1).toLowerCase(), proposalId: "case-1" }] };
    };

    const index = await lookupAssayCases(ids, lookup);

    expect(index.status).toBe("unavailable");
  });
});
