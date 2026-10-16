import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FullBalance } from "@/features/g30/balance";
import type { ToolCall } from "@/services/tool-calls.service";

import { ApprovalLinkView, outcomeOf } from "./approval-link-view";

/**
 * This suite exists because of a measured miss on a sibling file.
 *
 * Batch B changed `rows.length === 0` to `!rows` in `close-account-view.tsx` —
 * an array is always truthy — and it deleted the "Withdrawable balance" blocker
 * row from the rendered page while 213 tests, `tsc --noEmit` and a 56/56 build
 * all stayed green. This file carries the identical shape at
 * `rows.length === 1 ? rows[0].available : null`, and it had no rendering test:
 * the screen is behind a signed one-time link and a live call id, so it could
 * not be reached in a browser either.
 *
 * The failure it would produce is specific and expensive. `!rows` there makes
 * `available` unconditionally `null`, so **"Balance after" silently becomes an
 * em dash** on the one screen whose entire job is to let somebody decide
 * whether to spend money — and `rows[0]` without the length check is the
 * ORIGINAL defect: an eip155 price subtracted from a Solana balance, printed
 * as a fact.
 */

const SOLANA = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM = "eip155:46630";

function money(amount: string, chain = SOLANA) {
  return { amount, asset: `${chain}/token:4zMM`, decimals: 6 };
}

const CALL: ToolCall = {
  intentId: "intent-1",
  toolId: "11111111-1111-4111-8111-111111111111",
  providerId: "provider-1",
  status: "PENDING",
  price: money("2500000"),
  charged: money("0"),
  verdict: null,
  createdAt: "2026-09-10T09:15:00.000Z",
};

const SOLANA_ROW: FullBalance = {
  chainId: SOLANA,
  accountId: `${SOLANA}:AgentAccount1111111111111111111111111111111`,
  asset: `${SOLANA}/token:4zMM`,
  decimals: 6,
  available: money("12500000"),
  held: money("0"),
  /* A readable chain. Stated, never defaulted — see `FullBalance.chainReadable`. */
  chainReadable: true,
};

const EVM_ROW: FullBalance = {
  chainId: EVM,
  accountId: `${EVM}:0x83ab1234567890abcdef1234567890abcdef2913`,
  asset: `${EVM}/erc20:0xa0b8`,
  decimals: 6,
  available: money("4000000", EVM),
  held: money("0", EVM),
  /* A readable chain. Stated, never defaulted — see `FullBalance.chainReadable`. */
  chainReadable: true,
};

/**
 * Renders the real view with every query's cache pre-seeded, so nothing is
 * fetched. `balances` left undefined leaves that cache empty — the state a
 * browser is in while the API is unreachable.
 */
function markup(balances?: FullBalance[]): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["tool-call", "approval-1"], CALL);
  if (balances) client.setQueryData(["balances"], { balances });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ApprovalLinkView approvalId="approval-1" />
    </QueryClientProvider>,
  );
}

describe("ApprovalLinkView — the outcome, never dead approve buttons", () => {
  it("shows a call still in progress with its price and a receipt link", () => {
    const html = markup([SOLANA_ROW]);
    expect(html).toContain("Still in progress");
    expect(html).toContain("$2.50");
    expect(html).toContain("/receipts/view?id=intent-1");
    expect(html).not.toContain("Decline");
    expect(html).not.toContain('disabled=""');
  });

  it("says a settled call is already settled", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["tool-call", "approval-1"], { ...CALL, status: "SETTLED", charged: money("250000") });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ApprovalLinkView approvalId="approval-1" />
      </QueryClientProvider>,
    );
    expect(html).toContain("Already settled");
    expect(html).toContain("$0.25");
  });

  it("maps every status to one of three outcomes", () => {
    expect(outcomeOf("SETTLED").chip).toBe("charged");
    expect(outcomeOf("REFUNDED").chip).toBe("not-charged");
    expect(outcomeOf("VERIFYING").chip).toBe("checking");
  });
});

describe("outcomeOf — buyer debt (final review M1/M2)", () => {
  it("says an open or written-off debt is owed, not settled or not charged", () => {
    expect(outcomeOf("SETTLED", "OUTSTANDING").chip).toBe("owed");
    expect(outcomeOf("SETTLED", "WRITTEN_OFF").chip).toBe("owed");
  });

  it("keeps a voided debt and an ordinary call on their own outcome", () => {
    expect(outcomeOf("SETTLED", null).chip).toBe("charged");
    expect(outcomeOf("REFUNDED", "VOIDED").chip).toBe("not-charged");
  });
});
