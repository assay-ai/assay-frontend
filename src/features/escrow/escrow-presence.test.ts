import { describe, expect, it } from "vitest";

import type { BuyerEscrow } from "@/interfaces";

import { escrowPresence } from "./escrow-presence";

/**
 * Three fixtures, and every one of them is a response this API actually
 * returned on 2026-09-11 against the local stack — captured with `curl`, not
 * invented. The fields not under test are elided through a cast so the shape
 * drift this file exists to catch stays visible in the three that are.
 */
const base = {
  account: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:AgentDemoFundedWalletAddress1111",
  escrowPda: null,
  escrowTokenAccount: null,
  balance: null,
  openHolds: null,
  spendable: null,
  withdrawRequested: null,
  withdrawAvailableAt: null,
  serverTime: "2026-09-11T15:03:55.286Z",
  maxVoucherAmount: null,
  maxPerWindow: null,
  spentInWindow: null,
  windowStartedAt: null,
  windowSeconds: 86400,
  observedAt: null,
} satisfies Omit<BuyerEscrow, "exists" | "chainReadable">;

/** `GET /escrow` for `mcp_demo_token_funded` while Solana devnet was down. */
const UNREADABLE: BuyerEscrow = { ...base, exists: null, chainReadable: false };

/** `GET /escrow?chainId=eip155:46630` for `mcp_demo_token_evm_buyer` — the chain answered. */
const ABSENT: BuyerEscrow = {
  ...base,
  exists: false,
  chainReadable: true,
  observedAt: "2026-09-11T15:04:02.465Z",
};

const OPEN: BuyerEscrow = {
  ...base,
  exists: true,
  chainReadable: true,
  observedAt: "2026-09-11T15:04:02.465Z",
};

describe("escrowPresence", () => {
  it("has no state while the query is still pending", () => {
    expect(escrowPresence(undefined)).toBeNull();
  });

  it("reads a chain that answered 'open' as open", () => {
    expect(escrowPresence(OPEN)).toBe("open");
  });

  it("reads a chain that answered 'nothing there' as absent", () => {
    expect(escrowPresence(ABSENT)).toBe("absent");
  });

  it("reads a chain that could not be read as unreadable", () => {
    expect(escrowPresence(UNREADABLE)).toBe("unreadable");
  });

  it("KILLS `!escrow.exists`: unknown is not the same answer as absent", () => {
    /*
      The shipped line was `escrow && !escrow.exists`. `!null === true`, so the
      two inputs below took the SAME branch and printed the same definitive
      sentence. Any implementation that reaches for truthiness instead of
      reading `chainReadable` / `exists === null` fails here.
    */
    expect(escrowPresence(UNREADABLE)).not.toBe(escrowPresence(ABSENT));
    expect(escrowPresence(UNREADABLE)).not.toBe("absent");
  });

  it("KILLS 'unknown is open': an unreadable chain is not something to draw figures from", () => {
    // The opposite degenerate — `escrow.exists !== false` would put a buyer on
    // the balance/withdraw panels with nothing but nulls to render.
    expect(escrowPresence(UNREADABLE)).not.toBe("open");
  });

  it("trusts NEITHER flag alone", () => {
    /*
      A response that lost only one half of the pair still does not know. Both
      of these are unreadable, and an implementation reading just one of the
      two fields passes only one of these two assertions.
    */
    expect(escrowPresence({ ...OPEN, chainReadable: false })).toBe("unreadable");
    expect(escrowPresence({ ...UNREADABLE, chainReadable: true })).toBe("unreadable");
  });
});
