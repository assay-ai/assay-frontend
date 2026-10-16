"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, TriangleAlert } from "lucide-react";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { settleByHash } from "@/features/buyer-money/deposit-flow";
import type { PendingTx } from "@/features/buyer-money/pending-tx";
import { usePendingTransactions } from "@/hooks/usePendingTransactions";
import { readReceiptStatus } from "@/libs/chains/evm/deposit-transaction";
import { isEvmChain } from "@/libs/chains/registry";
import { cn } from "@/utils";

/**
 * Transactions sent from this browser that have not been seen through yet,
 * picked up again after a reload: a deposit is credited, a claim is confirmed.
 * Each row says what happens next; nothing here is a dead button.
 */
const POLL_MS = 8_000;

type RowState = "checking" | "finishing" | "failed" | "stuck";
/** Leave a fresh deposit to the tab that sent it for this long (another tab may be finishing it). */
const OWNER_GRACE_MS = 60_000;
const MAX_SETTLE_FAILURES = 5;

function PendingRow({ tx, onDone }: { tx: PendingTx; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [state, setState] = React.useState<RowState>(isEvmChain(tx.chainId) ? "checking" : "stuck");
  const failures = React.useRef(0);
  const busy = React.useRef(false);
  const doneRef = React.useRef(onDone);
  React.useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  React.useEffect(() => {
    if (!isEvmChain(tx.chainId)) return;
    let stopped = false;
    const tick = async () => {
      if (busy.current || stopped) return;
      busy.current = true;
      try {
        const status = await readReceiptStatus(tx.chainId, tx.hash as `0x${string}`);
        if (stopped) return;
        if (status === "reverted") {
          setState("failed");
          return;
        }
        if (status === "success") {
          if (tx.kind === "deposit" && tx.resume) {
            if (Date.now() - tx.submittedAt < OWNER_GRACE_MS) return;
            setState("finishing");
            await settleByHash({ chainId: tx.chainId, amountAtomic: tx.resume.amountAtomic }, tx.resume.depositId, tx.hash);
          }
          void queryClient.invalidateQueries({ queryKey: ["escrow"] });
          void queryClient.invalidateQueries({ queryKey: ["balances"] });
          void queryClient.invalidateQueries({ queryKey: ["deposits"] });
          doneRef.current();
        }
      } catch {
        // Try again on the next tick (the chain or the API was briefly
        // unreachable), but not for ever: then say so and offer Dismiss.
        failures.current += 1;
        if (failures.current >= MAX_SETTLE_FAILURES) {
          stopped = true;
          setState("stuck");
        }
      } finally {
        busy.current = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [tx, queryClient]);

  return (
    <li className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
      {state === "failed" || state === "stuck" ? (
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-danger-500" />
      ) : (
        <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-primary-500 motion-reduce:animate-none" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-label-13 text-01">{tx.label}</span>
        <span className={cn("text-body-xs", state === "failed" ? "text-danger-600" : "text-03")}>
          {state === "failed"
            ? "This transaction failed on chain. No money moved, though the network fee may be spent."
            : state === "stuck"
              ? "We could not confirm this yet. Check it on the explorer; if the money left your wallet, contact support with that link."
            : state === "finishing"
              ? "Confirmed on chain. Adding it to your balance…"
              : <>Sent <UtcTime value={new Date(tx.submittedAt).toISOString()} />. Waiting for the chain to confirm it.</>}
        </span>
      </span>
      {tx.explorerUrl ? (
        <a
          href={tx.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-label-xs text-02 underline-offset-2 hover:underline"
        >
          View on explorer
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      ) : null}
      {state === "failed" || state === "stuck" ? (
        <Button size="sm" variant="secondary" type="button" onClick={onDone}>
          Dismiss
        </Button>
      ) : null}
    </li>
  );
}

export function PendingTxList({ kinds, className }: { kinds?: PendingTx["kind"][]; className?: string }) {
  const { orphaned, resolve } = usePendingTransactions();
  const shown = kinds ? orphaned.filter((tx) => kinds.includes(tx.kind)) : orphaned;
  if (shown.length === 0) return null;
  return (
    <section
      aria-label="Transactions in progress"
      aria-live="polite"
      className={cn("w-full overflow-hidden rounded-xl border border-primary-20 bg-primary-5", className)}
    >
      <ul className="flex w-full flex-col divide-y divide-01">
        {shown.map((tx) => (
          <PendingRow key={tx.id} tx={tx} onDone={() => resolve(tx.id)} />
        ))}
      </ul>
    </section>
  );
}
