import { QueryClient, QueryObserver } from "@tanstack/react-query";
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
  forgetWalletRefusals,
  getWalletLinkStatus,
  isWalletNotLinked,
  noteWalletNotLinked,
  resetWalletLink,
  startWalletLink,
  subscribeLinkedRefetch,
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

  it("waits out a rate limit instead of giving up, never asking sooner than Retry-After", async () => {
    backend.answers = [
      () => Promise.reject(new ApiError("TOO_MANY_REQUESTS", "Too many requests. Try again in 10 s.", 429, undefined, undefined, 10)),
      () => Promise.resolve(LINKED),
    ];

    startWalletLink();
    await settle();
    expect(getWalletLinkStatus()).toBe("provisioning");

    await vi.advanceTimersByTimeAsync(9_000);
    expect(backend.calls).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(backend.calls).toBe(2);
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

/*
  F3: on every reload of an account linked long ago the link answers `linked`
  at once, and the bridge used to refetch every query a second time for it.
  It refetches only when a screen was refused for want of the wallet.
*/
describe("wallet-link — refetching the screens once the link lands", () => {
  let refetches = 0;
  let stop: () => void = () => undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    backend.calls = 0;
    backend.answers = [() => Promise.resolve(LINKED)];
    resetWalletLink();
    forgetWalletRefusals();
    refetches = 0;
    stop = subscribeLinkedRefetch(() => {
      refetches += 1;
    });
  });

  afterEach(() => {
    stop();
    resetWalletLink();
    forgetWalletRefusals();
    vi.useRealTimers();
  });

  it("does not refetch when nothing was refused (an account linked long ago)", async () => {
    startWalletLink();
    await settle();
    expect(getWalletLinkStatus()).toBe("linked");
    expect(refetches).toBe(0);
  });

  it("refetches once when a screen was refused before the link landed", async () => {
    backend.answers = [() => Promise.resolve(NOT_YET), () => Promise.resolve(LINKED)];
    startWalletLink();
    await settle();
    noteWalletNotLinked();
    noteWalletNotLinked();
    expect(refetches).toBe(0);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(getWalletLinkStatus()).toBe("linked");
    expect(refetches).toBe(1);

    // A request still in flight then may come back refused late: one more
    // refetch, on the next task; any later refusal changes nothing.
    noteWalletNotLinked();
    noteWalletNotLinked();
    expect(refetches).toBe(1);
    await settle();
    expect(refetches).toBe(2);
    noteWalletNotLinked();
    await settle();
    expect(refetches).toBe(2);
  });

  it("keeps a refusal from before Privy resolved the identity (the reset at boot)", async () => {
    noteWalletNotLinked();
    resetWalletLink();
    startWalletLink();
    await settle();
    expect(refetches).toBe(1);
  });

  it("refetches once for a request refused just before the link landed and answered after it", async () => {
    startWalletLink();
    await settle();
    expect(refetches).toBe(0);

    noteWalletNotLinked();
    noteWalletNotLinked();
    // Not from inside the refused response: once it has settled.
    expect(refetches).toBe(0);
    await settle();
    expect(refetches).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refetches).toBe(1);
  });

  it("a new identity does not inherit the previous one's late-refusal refetch", async () => {
    startWalletLink();
    await settle();
    resetWalletLink();

    noteWalletNotLinked();
    await settle();
    expect(refetches).toBe(0);
  });
});

/*
  Review I1: a refetch of a query still fetching with no data joins that
  request instead of starting a new one. Started from inside the refused
  response, it settled with the same 424 and spent the one late refetch, and
  a new account's screen stayed on "wallet not linked" until a reload.
*/
describe("wallet-link — a late refusal leaves the screen with data", () => {
  let stop: () => void = () => undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    backend.calls = 0;
    resetWalletLink();
    forgetWalletRefusals();
  });

  afterEach(() => {
    stop();
    resetWalletLink();
    forgetWalletRefusals();
    vi.useRealTimers();
  });

  /** A mounted query whose first request is refused only when the test says so, the way ApiClient reports it. */
  function screen(queryClient: QueryClient) {
    let refuse: () => void = () => undefined;
    let calls = 0;
    const observer = new QueryObserver(queryClient, {
      queryKey: ["escrow", null],
      queryFn: () => {
        calls += 1;
        if (calls > 1) return Promise.resolve("escrow");
        return new Promise<string>((_, reject) => {
          refuse = () => {
            // ApiClient reports the 424 from its response handler, then rejects.
            noteWalletNotLinked();
            reject(new ApiError("AUTH_WALLET_NOT_LINKED", "no wallet", 424));
          };
        });
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    return { observer, refuse: () => refuse(), calls: () => calls, unsubscribe };
  }

  function wire(queryClient: QueryClient) {
    stop = subscribeLinkedRefetch(() => void queryClient.invalidateQueries());
  }

  it("refused after the link landed with nothing refused before", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
    wire(queryClient);
    const view = screen(queryClient);
    backend.answers = [() => Promise.resolve(LINKED)];
    startWalletLink();
    await settle();
    expect(getWalletLinkStatus()).toBe("linked");

    view.refuse();
    await settle();

    expect(view.observer.getCurrentResult().data).toBe("escrow");
    expect(view.calls()).toBe(2);
    view.unsubscribe();
  });

  it("still in flight when the link landed after an earlier refusal, refused after it", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
    wire(queryClient);
    noteWalletNotLinked(); // an earlier screen's refusal
    const view = screen(queryClient);
    backend.answers = [() => Promise.resolve(LINKED)];
    startWalletLink();
    await settle();
    // The link landed and refetched, but this query joined its own in-flight request.
    expect(view.calls()).toBe(1);

    view.refuse();
    await settle();

    expect(view.observer.getCurrentResult().data).toBe("escrow");
    expect(view.calls()).toBe(2);
    view.unsubscribe();
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
