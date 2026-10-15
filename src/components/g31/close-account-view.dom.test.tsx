import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FullBalance } from "@/features/g30/balance";

import { CloseAccountView } from "./close-account-view";

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM = "eip155:46630";

const SOLANA_ROW: FullBalance = {
  chainId: SOLANA,
  accountId: `${SOLANA}:AgentAccount1111111111111111111111111111111`,
  asset: `${SOLANA}/token:4zMM`,
  decimals: 6,
  available: { amount: "12500000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
  held: { amount: "300000", asset: `${SOLANA}/token:4zMM`, decimals: 6 },
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
  /* A readable chain. Stated, never defaulted — see `FullBalance.chainReadable`. */
  chainReadable: true,
};

/**
 * Renders the view with the `["balances"]` cache pre-seeded, so `useQuery`
 * answers from the cache and no request is made. Passing `undefined` leaves the
 * cache empty, which is the state a browser is in while the API is unreachable
 * — the state a real page was measured in on 2026-09-10.
 */
function markup(balances?: FullBalance[]): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (balances) client.setQueryData(["balances"], { balances });
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
});
