"use client";

import { usePathname } from "next/navigation";
import * as React from "react";

import { AccountBlockBanner } from "@/features/account-block/account-block-banner";
import { BuyerDebtBanner } from "@/features/buyer-debt/debt-banner";
import { debtBannerSummary } from "@/features/buyer-debt/debt-summary";
import { useBuyerDebtsQuery } from "@/features/buyer-debt/settle-debt-sheet";

import { PausedBanner } from "./pause-all";

/**
 * The account banners, as one stack under the section tabs, most severe first:
 *
 *  1. **Blocked** (`AccountBlockBanner`): Assay blocked the account; nothing
 *     can be paid or changed, settling included.
 *  2. **Owed** (`BuyerDebtBanner`): a payment could not be collected; paid
 *     calls stay refused until the person signs it again.
 *  3. **Paused** (`PausedBanner`): the person's own kill switch; one click
 *     resumes it.
 *
 * All three stop paid calls; free calls keep working under every one.
 */
export const BUYER_BANNER_ORDER = ["account-block", "debt", "paused"] as const;

/** Pages whose own content must come first: the debt banner is one line there. */
export const COMPACT_BANNER_PATHS = ["/connect", "/agents", "/toolsets", "/spend/calls", "/limits"];

export function BuyerBannerStack() {
  const pathname = usePathname() ?? "";
  const compact = COMPACT_BANNER_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const debts = useBuyerDebtsQuery();
  const owed = debtBannerSummary(debts.data) !== null;
  const banners: Record<(typeof BUYER_BANNER_ORDER)[number], React.ReactNode> = {
    "account-block": <AccountBlockBanner />,
    debt: <BuyerDebtBanner compact={compact} />,
    paused: <PausedBanner owed={owed} />,
  };
  return (
    <div className="flex w-full flex-col gap-2 px-4 pt-4 empty:hidden md:px-6">
      {BUYER_BANNER_ORDER.map((id) => (
        <React.Fragment key={id}>{banners[id]}</React.Fragment>
      ))}
    </div>
  );
}
