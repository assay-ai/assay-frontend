import { describe, expect, it } from "vitest";

import type { SlashHoldHealth } from "@/interfaces/operator";

import { sortHoldsOldestFirst } from "../operator/slash-holds-panel";
import { HOLD_RESUMES, HOLD_WHAT_TO_DO, holdChainName, holdSentence, slashHoldBanner } from "./model";

describe("holdSentence", () => {
  it("says where, since when and why, in the provider's words", () => {
    expect(
      holdSentence({
        chainId: "eip155:46630",
        reasons: ["SLASH_WINDOW_FULL", "BONDED_BELOW_MINIMUM"],
        heldSince: "2026-10-15T07:30:00.000Z",
      }),
    ).toBe(
      "Paid calls are not being routed to you on Robinhood Chain testnet since 2026-10-15 07:30 UTC, "
      + "because today's penalty limit is full and a penalty is waiting and your free stake (your stake minus pending penalties) is below the minimum.",
    );
  });

  it("uses the short chain label for a chain this build does not pin, and survives no reasons", () => {
    expect(holdSentence({ chainId: "eip155:8453", reasons: [], heldSince: "2026-10-15T07:30:00.000Z" })).toBe(
      "Paid calls are not being routed to you on eip155:8453 since 2026-10-15 07:30 UTC.",
    );
    expect(holdChainName("eip155:46630")).toBe("Robinhood Chain testnet");
  });
});

describe("slashHoldBanner", () => {
  it("shows nothing without a hold, or on an older backend", () => {
    expect(slashHoldBanner([])).toBeNull();
    expect(slashHoldBanner(undefined)).toBeNull();
  });

  it("names the one chain, or counts several, oldest first", () => {
    const one = slashHoldBanner([
      { chainId: "eip155:46630", reasons: ["STAKE_FULLY_RESERVED"], heldSince: "2026-10-15T07:30:00Z" },
    ]);
    expect(one?.title).toBe("Paid calls are paused on Robinhood Chain testnet");
    expect(one?.lines[0]).toMatch(/because your stake is fully reserved by pending penalties\.$/);

    const two = slashHoldBanner([
      { chainId: "eip155:8453", reasons: ["BONDED_BELOW_MINIMUM"], heldSince: "2026-10-15T09:00:00Z" },
      { chainId: "eip155:46630", reasons: ["SLASH_WINDOW_FULL"], heldSince: "2026-10-15T07:30:00Z" },
    ]);
    expect(two?.title).toBe("Paid calls are paused on 2 chains");
    expect(two?.lines[0]).toMatch(/Robinhood Chain testnet/);
  });

  it("says what to do and that routing resumes by itself", () => {
    expect(HOLD_WHAT_TO_DO).toMatch(/wait.*add stake.*dispute/i);
    expect(HOLD_RESUMES).toMatch(/resumes automatically/);
  });
});

describe("sortHoldsOldestFirst", () => {
  it("puts the longest-held provider first", () => {
    const hold = (providerId: string, heldSince: string): SlashHoldHealth => ({
      providerId,
      chainId: "eip155:46630",
      reasons: ["SLASH_WINDOW_FULL"],
      heldSince,
      checkedAt: null,
    });
    expect(
      sortHoldsOldestFirst([hold("b", "2026-10-15T09:00:00Z"), hold("a", "2026-10-15T07:00:00Z")]).map(
        (h) => h.providerId,
      ),
    ).toEqual(["a", "b"]);
  });
});
