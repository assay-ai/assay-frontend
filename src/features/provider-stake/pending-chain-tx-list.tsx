"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, TriangleAlert } from "lucide-react";
import * as React from "react";

import { LocalTime } from "@/components/patterns/local-time";
import { Button } from "@/components/ui/button";
import { createPendingStore } from "@/hooks/usePendingTransactions";
import { readReceiptStatus } from "@/libs/chains/evm/deposit-transaction";
import { isEvmChain } from "@/libs/chains/registry";
import { cn } from "@/utils";

import {
  PROVIDER_PENDING_TX_STORAGE_KEY,
  parseProviderPending,
  type ProviderPendingKind,
  type ProviderPendingTx,
} from "./pending-chain-tx";

/** The provider's pending stake and dispute transactions, shared by every component on the page. */
export const useProviderPendingTransactions = createPendingStore<ProviderPendingTx>(
  PROVIDER_PENDING_TX_STORAGE_KEY,
  parseProviderPending,
);

const POLL_MS = 8_000;
const MAX_READ_FAILURES = 5;

type RowState = "checking" | "failed" | "stuck";

const WAITING: Record<ProviderPendingKind, string> = {
  stake: "Waiting for the chain to confirm it. Your stake updates once it does.",
  unstake: "Waiting for the chain to confirm it. The waiting period starts once it does.",
  withdraw: "Waiting for the chain to confirm it. The money reaches your wallet once it does.",
  dispute: "Waiting for the chain to confirm it. The penalty is frozen once it does.",
};

function PendingRow({ tx, onDone }: { tx: ProviderPendingTx; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [state, setState] = React.useState<RowState>(isEvmChain(tx.chainId) ? "checking" : "stuck");
  const failures = React.useRef(0);
  const doneRef = React.useRef(onDone);
  React.useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  React.useEffect(() => {
    if (!isEvmChain(tx.chainId)) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const status = await readReceiptStatus(tx.chainId, tx.hash as `0x${string}`);
        if (stopped) return;
        if (status === "reverted") {
          stopped = true;
          setState("failed");
          return;
        }
        if (status === "success") {
          stopped = true;
          void queryClient.invalidateQueries({ queryKey: ["provider"] });
          void queryClient.invalidateQueries({ queryKey: ["chain-slashes"] });
          doneRef.current();
        }
      } catch {
        failures.current += 1;
        if (failures.current >= MAX_READ_FAILURES) {
          stopped = true;
          setState("stuck");
        }
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
      {state === "checking" ? (
        <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-primary-500 motion-reduce:animate-none" />
      ) : (
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-danger-500" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-label-13 text-01">{tx.label}</span>
        <span className={cn("text-body-xs", state === "failed" ? "text-danger-600" : "text-03")}>
          {state === "failed" ? (
            "This transaction failed on chain. Nothing changed, though the network fee may be spent. You can try again."
          ) : state === "stuck" ? (
            "We could not confirm this yet. Check it on the explorer before you send it again."
          ) : (
            <>
              Sent <LocalTime value={new Date(tx.submittedAt).toISOString()} />. {WAITING[tx.kind]}
            </>
          )}
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
      {state !== "checking" ? (
        <Button size="sm" variant="secondary" type="button" onClick={onDone}>
          Dismiss
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Stake, withdraw and dispute transactions sent from this browser that a
 * reload interrupted: each shows what it was, when it was sent, its explorer
 * link, and is watched until the chain confirms it.
 */
export function ProviderPendingTxList({ kinds, className }: { kinds?: ProviderPendingKind[]; className?: string }) {
  const { orphaned, resolve } = useProviderPendingTransactions();
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
