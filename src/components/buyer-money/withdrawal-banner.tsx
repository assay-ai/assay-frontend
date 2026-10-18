"use client";

import { ArrowUpFromLine } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { formatLimit } from "@/components/g31/format";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { useChains } from "@/hooks/useChains";
import { useCountdown } from "@/hooks/useCountdown";
import type { BuyerEscrow } from "@/interfaces";
import { chainDisplayName } from "@/services/chains.service";
import { chainIdOfAccount } from "@/utils/chain";
import { toDecimal } from "@/utils/money";

import { useEscrowQuery } from "./use-buyer-money";

/** Funding already shows the request with Claim and Cancel; the banner would only repeat it. */
const HIDDEN_ON = ["/funding"];

/** Whether the escrow carries a standing withdrawal request (the chain's own `withdrawRequested`). */
export function withdrawalPending(escrow: Pick<BuyerEscrow, "withdrawRequested"> | null | undefined): boolean {
  return Boolean(escrow?.withdrawRequested && toDecimal(escrow.withdrawRequested).gt(0));
}

/**
 * App-wide while a withdrawal request stands (B7): paid calls on that chain
 * are paused until it is claimed or cancelled, so every page says so, with the
 * way to finish it. From `GET /escrow`, the live chain read.
 */
export function WithdrawalPendingBanner() {
  const pathname = usePathname() ?? "";
  const escrow = useEscrowQuery().data ?? null;
  const { chains } = useChains();
  const { hasPassed: claimable } = useCountdown(escrow?.withdrawAvailableAt);
  if (!escrow || !withdrawalPending(escrow)) return null;
  if (HIDDEN_ON.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return null;
  const chainId = chainIdOfAccount(escrow.account);
  const chainName = chainId ? chainDisplayName(chains, chainId) : "this chain";
  return (
    <div role="status" className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-primary-20 bg-primary-5 px-4 py-3" data-testid="withdrawal-banner">
      <ArrowUpFromLine aria-hidden="true" className="size-4 shrink-0 text-primary-600" />
      <p className="min-w-0 flex-1 text-body-13 text-01">
        Withdrawal of up to {formatLimit(escrow.withdrawRequested)} requested. Paid calls on {chainName} are paused until you claim or
        cancel it; free calls keep working.{" "}
        {claimable ? (
          "You can claim it now."
        ) : escrow.withdrawAvailableAt ? (
          <>
            You can claim it from <UtcTime value={escrow.withdrawAvailableAt} midSentence />.
          </>
        ) : null}
      </p>
      <Button asChild size="sm" variant={claimable ? "primary" : "secondary"}>
        <Link href={claimable ? "/funding?action=claim" : "/funding"}>{claimable ? "Claim" : "Open Funding"}</Link>
      </Button>
    </div>
  );
}
