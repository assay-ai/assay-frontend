import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  The API call is replaced because what this store decides is a SCHEDULE — how
  many times it asks, when it stops, and what it says while it waits. Those are
  exactly the decisions that cost the previous attempt at this problem a
  browser session to discover, and none of them is observable through a real
  request. Everything else here is the real module, including its timers.
*/
const backend = vi.hoisted(() => ({
  calls: 0,
  /** Answers in order; the last one repeats once exhausted. */
  answers: [] as Array<() => Promise<{ linked: boolean; account: string | null; chainId: string | null }>>,
}));

vi.mock("@/services/auth.service", () => ({
  linkWallet: () => {
    const answer = backend.answers[Math.min(backend.calls, backend.answers.length - 1)];
    backend.calls += 1;
    return answer();
  },
}));

import { ApiError } from "@/libs/ApiClient";

import {
  getWalletLinkStatus,
  isWalletNotLinked,
  resetWalletLink,
  startWalletLink,
} from "./wallet-link";

const LINKED = {
  linked: true,
  account: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:45bt7r8bDWm7JRtQwfWFb9GvTAfFw5rtXpAEm2LhUXLt",
  chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};
const NOT_YET = { linked: false, account: null, chainId: null };

/** Lets every already-resolved promise run before the next timer is fired. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("wallet-link — the first minute of a new account", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    backend.calls = 0;
    backend.answers = [() => Promise.resolve(LINKED)];
    resetWalletLink();
  });

  afterEach(() => {
    resetWalletLink();
    vi.useRealTimers();
  });

  it("asks once and is done when the wallet is already there", async () => {
    startWalletLink();
    await settle();

    expect(getWalletLinkStatus()).toBe("linked");
    expect(backend.calls).toBe(1);
  });

  it("keeps asking while the API says the wallet has not arrived, then stops on the one that lands", async () => {
    backend.answers = [
      () => Promise.resolve(NOT_YET),
      () => Promise.resolve(NOT_YET),
      () => Promise.resolve(LINKED),
    ];

    startWalletLink();
    await settle();
    expect(getWalletLinkStatus()).toBe("provisioning");

    await vi.advanceTimersByTimeAsync(3_000);
    expect(getWalletLinkStatus()).toBe("provisioning");

    await vi.advanceTimersByTimeAsync(3_000);
    expect(getWalletLinkStatus()).toBe("linked");
    expect(backend.calls).toBe(3);

    // The schedule really stopped — a linked account must not keep polling for
    // the rest of the session.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.calls).toBe(3);
  });

  it("gives up rather than spinning forever on an identity that has no wallet at all", async () => {
    backend.answers = [() => Promise.resolve(NOT_YET)];

    startWalletLink();
    await vi.advanceTimersByTimeAsync(90_000);

    expect(getWalletLinkStatus()).toBe("unavailable");
    const asked = backend.calls;

    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.calls).toBe(asked);
  });

  it("stops immediately on a refusal retrying cannot fix", async () => {
    backend.answers = [
      () => Promise.reject(new ApiError("AUTH_ORGANIZATION_SUSPENDED", "suspended", 403)),
    ];

    startWalletLink();
    await settle();

    expect(getWalletLinkStatus()).toBe("unavailable");
    expect(backend.calls).toBe(1);
  });

  it("says nothing and stops on a 401 — ApiClient is already signing this browser out", async () => {
    backend.answers = [() => Promise.reject(new ApiError("MCP_CREDENTIAL_INVALID", "bad", 401))];

    startWalletLink();
    await settle();

    expect(getWalletLinkStatus()).toBe("idle");
    expect(backend.calls).toBe(1);
  });

  it("keeps trying through a transport failure, which is not an answer", async () => {
    backend.answers = [
      () => Promise.reject(new ApiError("NETWORK_ERROR", "offline", 0)),
      () => Promise.resolve(LINKED),
    ];

    startWalletLink();
    await settle();
    expect(getWalletLinkStatus()).toBe("provisioning");

    await vi.advanceTimersByTimeAsync(3_000);
    expect(getWalletLinkStatus()).toBe("linked");
  });

  it("forgets everything on logout, so the next person starts clean", async () => {
    backend.answers = [() => Promise.resolve(NOT_YET)];
    startWalletLink();
    await settle();
    expect(getWalletLinkStatus()).toBe("provisioning");

    resetWalletLink();
    expect(getWalletLinkStatus()).toBe("idle");

    const asked = backend.calls;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.calls).toBe(asked);
  });
});

describe("isWalletNotLinked — the one code a screen must not paint red", () => {
  it("recognises the API's code and nothing else", () => {
    expect(isWalletNotLinked(new ApiError("AUTH_WALLET_NOT_LINKED", "no wallet", 424))).toBe(true);
    expect(isWalletNotLinked(new ApiError("AUTH_AGENT_SUSPENDED", "suspended", 403))).toBe(false);
    expect(isWalletNotLinked(new Error("AUTH_WALLET_NOT_LINKED"))).toBe(false);
    expect(isWalletNotLinked(null)).toBe(false);
  });
});
