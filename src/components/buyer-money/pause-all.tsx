"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CirclePause, CirclePlay } from "lucide-react";
import * as React from "react";

import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { debtBlocksPaidCalls, resumeSheetCopy } from "@/features/buyer-debt/debt-summary";
import type { BuyerDebts } from "@/interfaces/buyer-debt";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { getBuyerDebts } from "@/services/escrow.service";
import { updateSpendPolicy, type SpendPolicy } from "@/services/limits.service";
import { cn } from "@/utils";
import { toast } from "@/utils/toast";

import { useSpendPolicyQuery } from "./use-agents";
import { useFreeOnlyChain } from "./use-buyer-money";

/**
 * The kill switch: pause every paid call at once. On Budgets as a large
 * switch, in the top bar as a button, and as a red banner across the app while
 * it is on. Always confirmed, always reversible, free calls unaffected.
 *
 * Needs a budget to exist (the pause is a field of it). Without one, the
 * control does not render rather than offering a switch that cannot work.
 *
 * Not offered on a chain that serves free calls only (`useFreeOnlyChain`):
 * the backend checks the pause on the paid path alone
 * (`SpendPolicyEnforcementService.assertPolicyAdmits`; a free call is relayed
 * before it), so there it would stop nothing and only show a red "Paused".
 */
/**
 * Whether a debt still blocks paid calls, read from the debts list the buyer
 * shell already keeps (`BUYER_DEBTS_KEY` in the settle sheet). It only
 * subscribes: the banner's query does the fetching.
 */
function useDebtBlocksPaidCalls(): boolean {
  const debts = useQuery<BuyerDebts>({ queryKey: ["escrow", "debts"], queryFn: getBuyerDebts, enabled: false });
  return debtBlocksPaidCalls(debts.data);
}

export function usePauseAll() {
  const queryClient = useQueryClient();
  const debtOwed = useDebtBlocksPaidCalls();
  const policyQuery = useSpendPolicyQuery();
  const policy = policyQuery.data ?? null;
  // Read once the policy is (an authenticated session): the escrow names the chain.
  const { freeOnly } = useFreeOnlyChain({ enabled: policy !== null });
  const mutation = useMutation({
    mutationFn: (paused: boolean) =>
      updateSpendPolicy({ paused, changeReason: paused ? "Paused all paid calls" : "Resumed paid calls" }),
    onSuccess: (next: SpendPolicy) => {
      queryClient.setQueryData<SpendPolicy | null>(["spend-policy"], (previous) =>
        next.usage === undefined && previous?.usage ? { ...next, usage: previous.usage } : next,
      );
      void queryClient.invalidateQueries({ queryKey: ["spend-policy"] });
      void queryClient.invalidateQueries({ queryKey: ["spend-policy-history"] });
      toast.success(next.paused ? "All paid calls are paused. Free calls still work." : resumeSheetCopy(debtOwed).toast);
    },
  });
  return {
    policy,
    // The stored flag, whatever the chain: the debt copy reads it.
    paused: policy?.paused === true,
    // Whether to offer the switch (and show its paused state) at all.
    available: policy !== null && !freeOnly,
    mutation,
  };
}

export function PauseAllConfirm({
  open,
  onOpenChange,
  pausing,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pausing: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const resume = resumeSheetCopy(useDebtBlocksPaidCalls());
  return (
    <ConfirmSheet
      open={open}
      onOpenChange={onOpenChange}
      tone={pausing ? "danger" : "primary"}
      title={pausing ? "Pause all paid calls?" : "Resume paid calls?"}
      description={
        pausing
          ? "Every agent's paid calls are refused from now until you resume. Free calls keep working, and nothing already charged changes."
          : resume.description
      }
      changes={[{ label: "Paid calls", before: pausing ? "Running" : "Paused", after: pausing ? "Paused" : resume.after }]}
      confirmLabel={pausing ? "Pause all paid calls" : "Resume paid calls"}
      onConfirm={onConfirm}
      describeError={(error) => (error instanceof ApiError ? plainError(error.code) : "That did not go through. Try again.")}
    />
  );
}

/** The large switch at the top of Budgets. */
export function PauseAllCard({ className }: { className?: string }) {
  const { paused, available, mutation } = usePauseAll();
  const [confirming, setConfirming] = React.useState(false);
  if (!available) return null;
  return (
    <section
      aria-label="Pause all paid calls"
      className={cn(
        "flex w-full flex-wrap items-center gap-3 rounded-xl border p-4 tablet:p-5",
        paused ? "border-danger-20 bg-danger-10" : "border-01 bg-01",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-label-md", paused ? "text-danger-700" : "text-01")}>
          {paused ? "All paid calls are paused" : "Pause all paid calls"}
        </span>
        <span className={cn("text-body-13", paused ? "text-danger-700" : "text-02")}>
          {paused ? "Your agents cannot pay until you resume. Free calls still work." : "An emergency stop for every agent. Free calls keep working."}
        </span>
      </div>
      <Switch
        checked={paused}
        label={paused ? "Paused" : "Running"}
        onChange={() => setConfirming(true)}
        disabled={mutation.isPending}
      />
      <PauseAllConfirm open={confirming} onOpenChange={setConfirming} pausing={!paused} onConfirm={() => mutation.mutateAsync(!paused)} />
    </section>
  );
}

/** The top-bar button, so the stop is one click from every screen. */
export function PauseAllButton({ className }: { className?: string }) {
  const { paused, available, mutation } = usePauseAll();
  const [confirming, setConfirming] = React.useState(false);
  if (!available) return null;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={paused ? "danger" : "ghost"}
        icon={paused ? <CirclePlay /> : <CirclePause />}
        className={className}
        onClick={() => setConfirming(true)}
        aria-label={paused ? "Paid calls are paused. Resume them" : "Pause all paid calls"}
      >
        <span className={paused ? undefined : "hidden lg:inline"}>{paused ? "Paused · Resume" : "Pause all"}</span>
      </Button>
      <PauseAllConfirm open={confirming} onOpenChange={setConfirming} pausing={!paused} onConfirm={() => mutation.mutateAsync(!paused)} />
    </>
  );
}

/**
 * Shell-wide banner while paid calls are paused by the kill switch. It sits
 * last in `BuyerBannerStack`: a pause the person chose is the least severe of
 * the account banners. With a payment owed, resuming alone does not restart
 * paid calls, and the banner says so.
 */
export function PausedBanner({ owed = false, wrapperClassName }: { owed?: boolean; wrapperClassName?: string }) {
  const { paused, available, mutation } = usePauseAll();
  const [confirming, setConfirming] = React.useState(false);
  if (!paused || !available) return null;
  return (
    <div className={wrapperClassName}>
      <div role="status" className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-danger-20 bg-danger-10 px-4 py-3">
        <CirclePause aria-hidden="true" className="size-4 shrink-0 text-danger-600" />
        <p className="min-w-0 flex-1 text-body-13 text-danger-700">
          You paused all paid calls. Free calls still work.
          {owed ? " Paid calls also need the payment above settled before they restart." : null}
        </p>
        <Button size="sm" variant="secondary" type="button" onClick={() => setConfirming(true)}>
          Resume
        </Button>
        <PauseAllConfirm open={confirming} onOpenChange={setConfirming} pausing={false} onConfirm={() => mutation.mutateAsync(false)} />
      </div>
    </div>
  );
}
