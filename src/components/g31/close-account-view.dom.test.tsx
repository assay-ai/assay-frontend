import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FullBalance } from "@/features/g30/balance";

import { isLiveKey, readyToClose } from "@/features/buyer/close-account";

import { CloseAccountView } from "./close-account-view";
import { AGENTS_WITH_KEYS_KEY } from "@/components/buyer-money/use-agents";
import { demoAgentsWithKeys, withDemoKeys } from "@/libs/demo/demo-agent-health";

// A deployment with a support link: the close request is a real link once the steps are done.
vi.mock("@/libs/support", () => ({ SUPPORT_URL: "mailto:support@example.com" }));

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM = "eip155:46630";

const SOLANA_ROW: FullBalance = {
  chainId: SOLANA,
  accountId: `${SOLANA}:AgentAccount1111111111111111111111111111111`,
  asset: `${SOLANA}/token:4zMM`,
  decimals: 6,
  available: { amount: "12500000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
  held: { amount: "300000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
  withdrawable: { amount: "12500000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
  /* A readable chain. Stated, never defaulted — see `FullBalance.chainReadable`. */
  chainReadable: true,
};

const EVM_ROW: FullBalance = {
  chainId: EVM,
  accountId: `${EVM}:0x83ab1234567890abcdef1234567890abcdef2913`,
  asset: `${EVM}/erc20:0xa0b8`,
  decimals: 6,
  available: { amount: "4000000", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
  held: { amount: "0", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
  withdrawable: { amount: "4000000", asset: `${EVM}/erc20:0xa0b8`, decimals: 6 },
  /* A readable chain. Stated, never defaulted — see `FullBalance.chainReadable`. */
  chainReadable: true,
};

/**
 * Renders the view with the `["balances"]` cache pre-seeded, so `useQuery`
 * answers from the cache and no request is made. Passing `undefined` leaves the
 * cache empty, which is the state a browser is in while the API is unreachable
 * — the state a real page was measured in on 2026-09-10.
 */
function markup(balances?: FullBalance[], seed?: (client: QueryClient) => void): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (balances) client.setQueryData(["balances"], { balances });
  seed?.(client);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CloseAccountView />
    </QueryClientProvider>,
  );
}

/**
 * The blocker that matters most: money left on the account. It must never
 * read as zero when it could not be read, never be summed across chains, and
 * never repeat one line per account of the same asset.
 */
describe("CloseAccountView — withdraw step", () => {
  it("says the balance could not be read instead of showing $0.00", () => {
    const html = markup();
    expect(html).toContain("Withdraw your money");
    expect(html).not.toContain("$0.00");
  });

  it("shows one line per chain, both figures, and no sum", () => {
    const html = markup([SOLANA_ROW, EVM_ROW]);
    expect(html).toContain("$12.50");
    expect(html).toContain("$4.00");
    expect(html).not.toContain("$16.50");
  });

  it("merges several accounts of one asset into one total", () => {
    const second = { ...EVM_ROW, accountId: `${EVM}:0xdead` };
    const html = markup([EVM_ROW, second]);
    expect(html).toContain("$8.00");
    expect(html).toContain("across 2 accounts");
  });

  it("says Unknown for an unreadable chain, never the ledger's available", () => {
    // R16b-B4-01: Funding said "Unknown" while this screen printed available ($499).
    const html = markup([{ ...EVM_ROW, withdrawable: null, chainReadable: false }]);
    expect(html).toContain("Unknown");
    expect(html).toContain("could not read this chain");
    expect(html).not.toContain("$4.00");
    expect(html).not.toContain("must be withdrawn first");
  });
});

const EMPTY_EVM_ROW: FullBalance = {
  ...EVM_ROW,
  available: { ...EVM_ROW.available, amount: "0" },
  withdrawable: { ...EVM_ROW.available, amount: "0" },
};

describe("CloseAccountView — the close request (review B P1)", () => {
  it("offers the request but keeps it off until 3 of 3, and says so", () => {
    const html = markup([EVM_ROW]);
    expect(html).toContain("Ask us to close the account");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Ask us to close the account/);
    expect(html).not.toContain('href="mailto:support@example.com"');
    expect(html).toContain("0 of 3 steps done. The request opens at 3 of 3.");
  });

  it("ticks the keys step from data: no agent means no key that works", () => {
    const html = markup([EMPTY_EVM_ROW], (client) => {
      client.setQueryData(["holds"], { items: [] });
      client.setQueryData(["me", "status"], { blockStatus: null, unreadCount: null, debts: { account: EVM_ROW.accountId, debts: [] } });
      client.setQueryData(AGENTS_WITH_KEYS_KEY, demoAgentsWithKeys({ items: [] }));
    });
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("Withdraw your money , done");
    expect(text).toContain("Revoke your agent keys , done");
    // Withdrawn and no keys, but the records are not ticked yet: 2 of 3, still off.
    expect(html).toContain("2 of 3 steps done.");
  });
});

describe("CloseAccountView — unknown or owed is never withdrawn (review m2)", () => {
  const seedAllBut = (skip: "holds" | "debts") => (client: QueryClient) => {
    if (skip !== "holds") client.setQueryData(["holds"], { items: [] });
    if (skip !== "debts") client.setQueryData(["me", "status"], { blockStatus: null, unreadCount: null, debts: { account: EVM_ROW.accountId, debts: [] } });
    client.setQueryData(AGENTS_WITH_KEYS_KEY, demoAgentsWithKeys({ items: [] }));
  };
  const stripped = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("does not tick Withdraw while the holds are not read", () => {
    const text = stripped(markup([EMPTY_EVM_ROW], seedAllBut("holds")));
    expect(text).not.toContain("Withdraw your money , done");
    expect(text).toContain("1 of 3 steps done.");
  });

  it("does not tick Withdraw while the debts are not read", () => {
    expect(stripped(markup([EMPTY_EVM_ROW], seedAllBut("debts")))).not.toContain("Withdraw your money , done");
  });

  it("does not tick Withdraw while a payment is owed, and says to settle it", () => {
    const text = stripped(
      markup([EMPTY_EVM_ROW], (client) => {
        seedAllBut("debts")(client);
        client.setQueryData(["me", "status"], { blockStatus: null, unreadCount: null, debts: {
          account: EVM_ROW.accountId,
          debts: [{ intentId: "int-1", payer: EVM_ROW.accountId, amount: EVM_ROW.available, state: "OUTSTANDING" }],
        } });
      }),
    );
    expect(text).not.toContain("Withdraw your money , done");
    expect(text).toContain("A payment is still owed");
  });
});

describe("CloseAccountView — a deployment without a support link (review m7)", () => {
  it("says closing is done by the team, with no button to nowhere", async () => {
    vi.resetModules();
    vi.doMock("@/libs/support", () => ({ SUPPORT_URL: null }));
    const { CloseAccountView: View } = await import("./close-account-view");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <View />
      </QueryClientProvider>,
    );
    expect(html).toContain("Closing is done by the Assay team, not in the app.");
    expect(html).not.toContain("Ask us to close the account");
    vi.doUnmock("@/libs/support");
  });
});

describe("readyToClose and isLiveKey", () => {
  it("is ready only with every step done, and never on an unknown key count", () => {
    expect(readyToClose({ withdrawn: true, recordsKept: true, liveKeys: 0 })).toBe(true);
    expect(readyToClose({ withdrawn: true, recordsKept: true, liveKeys: null })).toBe(false);
    expect(readyToClose({ withdrawn: true, recordsKept: false, liveKeys: 0 })).toBe(false);
    expect(readyToClose({ withdrawn: false, recordsKept: true, liveKeys: 0 })).toBe(false);
    expect(readyToClose({ withdrawn: true, recordsKept: true, liveKeys: 1 })).toBe(false);
  });

  it("counts a key that is neither revoked nor expired", () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    expect(isLiveKey({ revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(isLiveKey({ revokedAt: "2026-10-01T00:00:00Z", expiresAt: null }, now)).toBe(false);
    expect(isLiveKey({ revokedAt: null, expiresAt: "2026-10-18T11:00:00Z" }, now)).toBe(false);
    expect(isLiveKey({ revokedAt: null, expiresAt: "2026-10-19T00:00:00Z" }, now)).toBe(true);
  });
});
