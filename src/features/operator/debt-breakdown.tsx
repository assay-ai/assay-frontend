"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { shortRef } from "@/features/call-disputes/model";
import type { OperatorApproval } from "@/interfaces/operator";
import { findOpenBuyerDebts, type OperatorBuyerDebt } from "@/services/operator-buyer-debts.service";
import { formatMoney } from "@/utils/money";

import { walletLabel } from "./block-targets";
import { BUYER_CAUSED_WARNING, buyerCausedCount, countText, debtBreakdown, PINNED_LOOKUP_MAX_PAGES } from "./buyer-debts";
import { useProviderNames } from "./use-operator-lookups";

type Row = Pick<OperatorBuyerDebt, "intentId" | "buyerOrganizationId" | "payerAccount" | "providerId" | "amount">;

/**
 * Who a bulk void is about: per buyer (organization and paying wallets, count,
 * amount) and per provider (count, amount), so neither the requester nor the
 * approver reads only a list of ids.
 */
export function DebtBreakdown({
  rows,
  assetId,
  decimals,
  providerName,
}: {
  rows: readonly Row[];
  assetId: string;
  decimals: number;
  providerName: (id: string | null) => string;
}) {
  const { buyers, providers } = debtBreakdown(rows);
  const money = (amount: string) => formatMoney({ amount, asset: assetId, decimals }, { decimals: 4 });
  return (
    <div className="flex w-full flex-col gap-3" data-testid="debt-breakdown">
      <section aria-label="Per buyer" className="flex flex-col gap-1">
        <h3 className="text-label-13 text-02">
          {buyers.length === 1 ? "1 buyer" : `${buyers.length} buyers`}
        </h3>
        <ul className="flex max-h-56 flex-col divide-y divide-01 overflow-y-auto rounded-md border border-01">
          {buyers.map((buyer) => (
            <li key={buyer.buyerOrganizationId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-1.5 text-body-13">
              <span className="flex min-w-0 flex-col">
                <span className="text-01">Buyer {shortRef(buyer.buyerOrganizationId)}</span>
                <span className="text-body-xs text-03 [overflow-wrap:anywhere]">
                  {buyer.payers.length === 1 ? walletLabel(buyer.payers[0]!) : `${buyer.payers.length} wallets`}
                </span>
              </span>
              <span className="tabular-nums text-01">
                {countText(buyer.count)} · {money(buyer.amount)}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Per provider" className="flex flex-col gap-1">
        <h3 className="text-label-13 text-02">
          {providers.length === 1 ? "1 provider, not paid for these" : `${providers.length} providers, not paid for these`}
        </h3>
        <ul className="flex max-h-40 flex-col divide-y divide-01 overflow-y-auto rounded-md border border-01">
          {providers.map((provider) => (
            <li key={provider.providerId ?? "none"} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5 text-body-13">
              <span className="min-w-0 text-01">{providerName(provider.providerId)}</span>
              <span className="tabular-nums text-01">
                {countText(provider.count)} · {money(provider.amount)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/**
 * The approver's breakdown of a pending bulk void. The approval pins only ids,
 * asset and total, so the debts are looked up in the open list of that asset;
 * an id not found there is no longer open and will be skipped.
 */
export function PinnedDebtBreakdown({ approval }: { approval: Pick<OperatorApproval, "id" | "payload"> }) {
  const payload = approval.payload;
  const ids = Array.isArray(payload.intentIds) ? payload.intentIds.map(String) : [];
  const assetId = typeof payload.assetId === "string" ? payload.assetId : null;
  const decimals = typeof payload.decimals === "number" ? payload.decimals : null;
  const providers = useProviderNames();
  const found = useQuery({
    queryKey: ["operator", "buyer-debts", "pinned", approval.id],
    queryFn: () => findOpenBuyerDebts(ids, assetId!, PINNED_LOOKUP_MAX_PAGES),
    enabled: ids.length > 0 && assetId !== null,
    staleTime: 30_000,
    retry: 0,
  });
  if (ids.length === 0 || assetId === null || decimals === null) return null;
  if (found.isPending) return <p className="text-body-13 text-03">Looking up who these debts belong to…</p>;
  if (found.isError || !found.data) return <p className="text-body-13 text-03">Who these debts belong to could not be read. The ids are listed above.</p>;
  const { rows, searchedAll } = found.data;
  const missing = ids.length - rows.length;
  const buyerCaused = buyerCausedCount(rows);
  return (
    <div className="flex w-full flex-col gap-2">
      {buyerCaused > 0 ? <BuyerCausedWarning count={buyerCaused} of={rows.length} /> : null}
      {missing > 0 ? (
        <p className="text-body-13 text-02">
          {rows.length} of {countText(ids.length)} found in the open list.{" "}
          {searchedAll
            ? `The other ${missing} ${missing === 1 ? "is" : "are"} no longer open and will be skipped.`
            : `The other ${missing} were not in the first ${(PINNED_LOOKUP_MAX_PAGES * 100).toLocaleString("en-US")} open debts of this asset.`}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <DebtBreakdown
          rows={rows}
          assetId={assetId}
          decimals={decimals}
          providerName={(id) => (id ? (providers.lookup(id) ?? `Provider ${shortRef(id)}`) : "Unknown provider")}
        />
      ) : null}
    </div>
  );
}

/** The warning when debts whose recorded cause does not suggest the platform are in a void. */
export function BuyerCausedWarning({ count, of }: { count: number; of: number }) {
  return (
    <div role="alert" className="flex w-full flex-col gap-1 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5 text-body-13 text-warning-700" data-testid="buyer-caused-warning">
      <p className="text-label-13">{BUYER_CAUSED_WARNING}</p>
      <p>
        {count} of {countText(of)} {count === 1 ? "has" : "have"} a recorded cause that does not suggest the platform (for example the buyer&apos;s escrow ran short, or a delegate or limit refused it).
      </p>
    </div>
  );
}
