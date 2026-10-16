import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BuyerDebt, BuyerDebts } from "@/interfaces/buyer-debt";

/*
  The Privy modules are replaced with recorders so the real `useSigner` runs,
  as in `wallet-menu-rows.dom.test.tsx`. The query is seeded, so the static
  render draws what a session with an open debt sees.
*/
vi.mock("@privy-io/react-auth/solana", () => ({
  useWallets: () => ({ ready: true, wallets: [] }),
  useSignMessage: () => ({ signMessage: async () => ({ signature: new Uint8Array() }) }),
  useSignTransaction: () => ({ signTransaction: async () => ({ signedTransaction: new Uint8Array() }) }),
  useSignAndSendTransaction: () => ({ signAndSendTransaction: async () => ({ signature: new Uint8Array() }) }),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true }),
  useWallets: () => ({ ready: true, wallets: [] }),
  useSignMessage: () => ({ signMessage: async () => ({ signature: "0x" }) }),
  useSignTypedData: () => ({ signTypedData: async () => ({ signature: "0x" }) }),
  useSignTransaction: () => ({ signTransaction: async () => ({ signature: "0x" }) }),
}));

import { BUYER_DEBTS_KEY, BuyerDebtBanner } from "./debt-banner";

const ACCOUNT = "eip155:46630:0x7FD9A17dE9fd64b35081FbAbaa9f3bb85e59F8d1";
const ASSET = "eip155:46630/erc20:0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3";

const debt = (overrides: Partial<BuyerDebt> = {}): BuyerDebt => ({
  intentId: "int_1",
  payer: ACCOUNT,
  amount: { amount: "2500000", asset: ASSET, decimals: 6 },
  providerId: "prv_1",
  toolId: "price_quote",
  cause: "VoucherExpired",
  state: "OPEN",
  lapsedAt: "2026-10-16T00:00:00.000Z",
  writeOffAt: "2026-11-15T00:00:00.000Z",
  replacedAt: null,
  createdAt: "2026-10-15T23:59:00.000Z",
  ...overrides,
});

function render(data: BuyerDebts): string {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(BUYER_DEBTS_KEY, data);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <BuyerDebtBanner />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T00:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("BuyerDebtBanner", () => {
  it("draws nothing without an open debt", () => {
    expect(render({ account: ACCOUNT, debts: [] })).toBe("");
  });

  it("says in one line what is owed and what it stops, with the deadline, and offers to settle", () => {
    const html = render({ account: ACCOUNT, debts: [debt()] });
    expect(html).toContain("You owe $2.50 for 1 call. Paid calls are paused until you settle.");
    expect(html).toContain("Settle by Nov 15, 00:00 UTC (in 29 days). After that it is written off: you still owe it, and the provider is paid only once you settle");
    expect(html).toContain("Free calls still work.");
    expect(html).toContain("the payment voucher expired before it could be collected");
    expect(html).toContain("Settle $2.50");
  });

  it("still offers to settle a written-off debt, and says settling pays the provider", () => {
    const html = render({
      account: ACCOUNT,
      debts: [debt({ state: "WRITTEN_OFF", writeOffAt: "2026-10-01T00:00:00.000Z" })],
    });
    expect(html).toContain("Written off on Oct 1, 00:00 UTC: the provider was not paid, and settling pays them.");
    expect(html).toContain("Paid calls are paused until you settle.");
    expect(html).toContain("Settle $2.50");
  });

  it("links each Details row of this wallet to that call's receipt, a written-off one included", () => {
    const html = render({
      account: ACCOUNT,
      debts: [
        debt({ intentId: "int_wo", state: "WRITTEN_OFF", writeOffAt: "2026-10-01T00:00:00.000Z" }),
        debt({ intentId: "int_other", payer: "eip155:46630:0x2222222222222222222222222222222222222222" }),
      ],
    });
    expect(html).toContain('href="/receipts/view?id=int_wo"');
    expect(html).toMatch(/href="\/receipts\/view\?id=int_wo"[^>]*>.*written off<\/a>/);
    // Another wallet's receipt is that wallet's to read: no link.
    expect(html).not.toContain("id=int_other");
    expect(html).toContain("another wallet");
  });

  it("offers no button while the only debt is being collected", () => {
    const html = render({
      account: ACCOUNT,
      debts: [debt({ state: "REPLACING", replacedAt: "2026-10-16T00:05:00.000Z" })],
    });
    expect(html).toContain("Collecting $2.50 you signed. Paid calls resume in about a minute.");
    expect(html).not.toContain("Settle $");
  });

  it("does not ask another wallet to sign a debt that is being collected", () => {
    const other = debt({
      payer: "eip155:46630:0x2222222222222222222222222222222222222222",
      state: "REPLACING",
    });
    const html = render({ account: ACCOUNT, debts: [other] });
    expect(html).not.toContain("another wallet of your organization");
  });

  it("offers no button for another wallet's debt, and says which wallet settles it", () => {
    const other = debt({ payer: "eip155:46630:0x2222222222222222222222222222222222222222" });
    const html = render({ account: ACCOUNT, debts: [other] });
    expect(html).not.toContain("Settle $");
    expect(html).toContain("Your organization owes $2.50 for 1 call");
    expect(html).toContain("sign in with that wallet to settle");
  });

  it("adds up several own debts on the button, leaving out the one being collected", () => {
    const html = render({ account: ACCOUNT, debts: [debt(), debt({ intentId: "int_2" })] });
    expect(html).toContain("You owe $5.00 for 2 calls.");
    expect(html).toContain("Settle $5.00");
    const mixed = render({
      account: ACCOUNT,
      debts: [
        debt({ state: "REPLACING" }),
        debt({ intentId: "int_2", state: "WRITTEN_OFF" }),
        debt({ intentId: "int_3" }),
      ],
    });
    expect(mixed).toContain("Settle $5.00");
    expect(mixed).toContain("1 more payment you signed is being collected.");
    expect(mixed).toContain("being collected");
  });

  describe("before the original payment expires on chain", () => {
    const soon = () => new Date(Date.now() + 30 * 60_000).toISOString();
    // The redesign's banner button is "Settle $X" (it opens the settle sheet); main's was "Sign to settle".
    const signButton = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>).)*Settle \$/)?.[0] ?? "";

    it("disables Settle and says from when, in plain words", () => {
      const at = soon();
      const html = render({ account: ACCOUNT, debts: [debt({ replaceableAt: at })] });
      expect(signButton(html)).toMatch(/disabled=""/);
      // The local time with its zone and a countdown (review P3-1).
      expect(html).toMatch(/You can settle this from today \d{2}:\d{2} [^<]+ \(in (29|30)m\): the original payment/);
      expect(html).toContain("so you never pay twice");
      // The disabled button names the note as its reason (P3-7).
      const describedBy = signButton(html).match(/aria-describedby="([^"]+)"/)?.[1];
      expect(describedBy).toBeTruthy();
      expect(html).toContain(`id="${describedBy}" data-testid="buyer-debt-not-yet"`);
    });

    it("offers it once replaceableAt has passed, or when the backend sends none", () => {
      for (const replaceableAt of [new Date(Date.now() - 60_000).toISOString(), null, undefined]) {
        const html = render({ account: ACCOUNT, debts: [debt({ replaceableAt })] });
        expect(signButton(html)).not.toBe("");
        expect(signButton(html)).not.toMatch(/disabled=""/);
        expect(html).not.toContain("never pay twice");
      }
    });

    it("settles one that is ready first, and says when the waiting one can be", () => {
      const at = soon();
      const html = render({
        account: ACCOUNT,
        debts: [debt({ replaceableAt: at }), debt({ intentId: "int_2" })],
      });
      expect(signButton(html)).not.toMatch(/disabled=""/);
      // Main: "Sign to settle (1 of 2)". Here the button names what the sheet signs now: the ready one only.
      expect(html).toContain("You owe $5.00 for 2 calls.");
      expect(html).toContain("Settle $2.50");
      expect(html).toContain("1 of them is not ready to sign yet: you can settle it from");
      expect(signButton(html)).not.toContain("aria-describedby");
    });

    it("says the first one's time when several wait", () => {
      const at = soon();
      const html = render({
        account: ACCOUNT,
        debts: [debt({ replaceableAt: at }), debt({ intentId: "int_2", replaceableAt: new Date(Date.now() + 90 * 60_000).toISOString() })],
      });
      expect(html).toContain("You can settle the first from today");
    });
  });
});
