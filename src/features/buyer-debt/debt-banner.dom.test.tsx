import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
import { notYetReplaceableSentence } from "./debt-copy";

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

describe("BuyerDebtBanner", () => {
  it("draws nothing without an open debt", () => {
    expect(render({ account: ACCOUNT, debts: [] })).toBe("");
  });

  it("explains the debt in plain words and offers to sign", () => {
    const html = render({ account: ACCOUNT, debts: [debt()] });
    expect(html).toContain("could not be collected from your escrow");
    expect(html).toContain("the payment voucher expired before it could be collected");
    expect(html).toContain("Paid calls are paused until you settle it. Free calls still work.");
    expect(html).toContain("If not settled by 15 Nov 2026, it is written off and the provider goes unpaid");
    expect(html).toContain("Sign to settle");
  });

  it("still offers to sign a written-off debt, and says it pauses paid calls", () => {
    const html = render({
      account: ACCOUNT,
      debts: [debt({ state: "WRITTEN_OFF", writeOffAt: "2026-10-01T00:00:00.000Z" })],
    });
    expect(html).toContain("written off on 1 Oct 2026");
    expect(html).toContain("Paid calls stay paused until you settle it, and settling it pays the provider.");
    expect(html).toContain("Sign to settle");
  });

  it("offers no button while the only debt is being collected", () => {
    const html = render({
      account: ACCOUNT,
      debts: [debt({ state: "REPLACING", replacedAt: "2026-10-16T00:05:00.000Z" })],
    });
    expect(html).toContain("Collecting the payment you signed");
    expect(html).toContain("Paid calls resume once it is collected.");
    expect(html).not.toContain("Sign to settle");
  });

  it("does not ask another wallet to sign a debt that is being collected", () => {
    const other = debt({
      payer: "eip155:46630:0x2222222222222222222222222222222222222222",
      state: "REPLACING",
    });
    const html = render({ account: ACCOUNT, debts: [other] });
    expect(html).not.toContain("owed by another wallet");
  });

  it("offers no button for another wallet's debt, and says which wallet settles it", () => {
    const other = debt({ payer: "eip155:46630:0x2222222222222222222222222222222222222222" });
    const html = render({ account: ACCOUNT, debts: [other] });
    expect(html).not.toContain("Sign to settle");
    expect(html).toContain("owed by another wallet of your organization");
  });

  it("counts several own debts on the button, leaving out the one being collected", () => {
    const html = render({ account: ACCOUNT, debts: [debt(), debt({ intentId: "int_2" })] });
    expect(html).toContain("Sign to settle (1 of 2)");
    const mixed = render({
      account: ACCOUNT,
      debts: [
        debt({ state: "REPLACING" }),
        debt({ intentId: "int_2", state: "WRITTEN_OFF" }),
        debt({ intentId: "int_3" }),
      ],
    });
    expect(mixed).toContain("Sign to settle (1 of 2)");
    expect(mixed).toContain("signed, being collected");
  });

  describe("before the original payment expires on chain", () => {
    const soon = () => new Date(Date.now() + 30 * 60_000).toISOString();
    const signButton = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>).)*Sign to settle/)?.[0] ?? "";

    it("disables Sign to settle and says from when, in plain words", () => {
      const at = soon();
      const html = render({ account: ACCOUNT, debts: [debt({ replaceableAt: at })] });
      expect(signButton(html)).toMatch(/disabled=""/);
      expect(html).toContain(notYetReplaceableSentence(at));
      expect(html).toContain("so you never pay twice");
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
      expect(html).toContain("Sign to settle (1 of 2)");
      expect(html).toContain("1 of them is not ready to sign yet: you can settle it from");
    });
  });
});
