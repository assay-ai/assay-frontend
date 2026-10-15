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
 * This suite exists because of a measured miss.
 *
 * Replacing `rows.length === 0 ?` with `!rows ?` in this file — the
 * array-is-always-truthy mutation that already shipped once as
 * `providers-view.tsx:112` — deleted the "Withdrawable balance" blocker row
 * from the rendered page entirely, and **213 tests, `tsc` and `next build` all
 * stayed green.** It was only visible in a browser. A blocker that vanishes on
 * the screen telling somebody what stands between them and closing a funded
 * account is the most expensive shape this defect has.
 */
describe("CloseAccountView — blockers are per chain and never summarised", () => {
  it("keeps the Withdrawable blocker row when the balance could NOT be read", () => {
    const html = markup();
    expect(html).toContain("Withdrawable balance");
    // A dash, not a zero: "we could not read it" and "there is none" are
    // different facts and only one of them lets an account close.
    expect(html).not.toContain("$0.00");
  });

  it("shows one row per chain, both figures, and no sum", () => {
    const html = markup([SOLANA_ROW, EVM_ROW]);
    expect(html.match(/Withdrawable balance/g)).toHaveLength(2);
    expect(html).toContain("$12.50");
    expect(html).toContain("$4.00");
    // 12.50 + 4.00 = $16.50 of nothing.
    expect(html).not.toContain("$16.50");
  });

  it("names the chain on each row only when there is more than one", () => {
    const many = markup([SOLANA_ROW, EVM_ROW]);
    expect(many).toContain("eip155:46630");
    // Assert the loser: a single-chain account must read exactly as it always
    // has, with no chain suffix appended to a row that cannot be confused.
    const one = markup([SOLANA_ROW]);
    expect(one.match(/Withdrawable balance/g)).toHaveLength(1);
    expect(one).not.toContain("Withdrawable balance ·");
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
