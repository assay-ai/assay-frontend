import { describe, expect, it } from "vitest";

import { HANDOFF_MAX_AGE_MS, latestHandoff, parseHandoffs } from "./handoff-record";

const NOW = Date.parse("2026-10-16T12:00:00Z");

describe("hand-off records", () => {
  it("keeps well-formed entries younger than a day, and drops the rest", () => {
    const raw = JSON.stringify({
      a: { kind: "file", at: NOW - 60_000 },
      b: { kind: "sent", at: NOW - 120_000, hash: "0xabc", explorerUrl: "https://x/tx/0xabc" },
      old: { kind: "file", at: NOW - HANDOFF_MAX_AGE_MS - 1 },
      bad: { kind: "other", at: NOW },
    });
    expect(Object.keys(parseHandoffs(raw, NOW)).sort()).toEqual(["a", "b"]);
    expect(parseHandoffs("not json", NOW)).toEqual({});
    expect(parseHandoffs(null, NOW)).toEqual({});
  });

  it("reads the latest hand-off for any of a record's ids, case-insensitively", () => {
    const store = parseHandoffs(
      JSON.stringify({ "0xaa": { kind: "file", at: NOW - 5_000 }, "0xbb": { kind: "sent", at: NOW - 1_000, hash: "0x1" } }),
      NOW,
    );
    expect(latestHandoff(store, ["0xAA", "0xBB"])).toMatchObject({ kind: "sent", hash: "0x1" });
    expect(latestHandoff(store, ["0xAA"])).toMatchObject({ kind: "file" });
    expect(latestHandoff(store, ["0xcc"])).toBeNull();
  });
});
