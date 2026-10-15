"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { formatLimit } from "@/components/g31/format";
import { WalletActionSheet, type WalletStep } from "@/components/patterns/sign-action";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { capsToForm, parseCaps } from "@/features/buyer-money/caps";
import { describeMoneyError } from "@/features/buyer-money/money-errors";
import { strandReasons } from "@/features/delegation/unsettled";
import { applyLimitsSubmitted } from "@/features/escrow/after-set-limits";
import { ESCROW_SUBMITTERS, runEscrowAction } from "@/features/escrow/relayed-submission";
import type { EscrowLimitsBody } from "@/interfaces";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { getEscrowUnsettled } from "@/services/delegation.service";
import { createEscrowLimitsIntent, submitEscrowLimits } from "@/services/escrow.service";

import { CapsFields, type CapsValue } from "./caps-fields";
import { requireSigner, useBuyerMoney, useWalletBlocker } from "./use-buyer-money";

/**
 * Safety caps (enforced on chain): the two limits on the escrow that nobody,
 * the platform included, can exceed. Presets so nobody has to invent numbers,
 * one button that builds the request and opens the wallet, free (relayed).
 *
 * Lowering caps below payments still being settled would strand them; the
 * drawer then asks for an explicit acknowledgement instead of a second screen.
 */
export interface CapsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The next step after success, e.g. "Next: let your agent pay". */
  next?: { label: string; onClick: () => void };
}

export function CapsSheet({ open, onOpenChange, next }: CapsSheetProps) {
  const queryClient = useQueryClient();
  const readOnly = useAccountReadOnly();
  const money = useBuyerMoney();
  const current = capsToForm(money.escrow);
  const [value, setValue] = React.useState<CapsValue>({ perCall: "", perDay: "" });
  const [seeded, setSeeded] = React.useState(false);
  // Seed only once the escrow is read, so the form starts from the real caps.
  if (open && !seeded && !money.escrowQuery.isPending) {
    setSeeded(true);
    setValue(current ?? { perCall: "1", perDay: "20" });
  }
  if (!open && seeded) setSeeded(false);

  const parsed = parseCaps(value.perCall, value.perDay, money.decimals);
  const body: EscrowLimitsBody | null =
    parsed.ok && parsed.perCall.atomic && parsed.perDay.atomic
      ? { maxVoucherAmount: parsed.perCall.atomic, maxPerWindow: parsed.perDay.atomic }
      : null;
  const unchanged =
    body !== null &&
    money.escrow?.maxVoucherAmount?.amount === body.maxVoucherAmount &&
    money.escrow?.maxPerWindow?.amount === body.maxPerWindow;

  const unsettled = useQuery({
    queryKey: ["escrow-unsettled", null],
    enabled: open && Boolean(money.escrow?.exists),
    retry: 0,
    staleTime: 0,
    queryFn: () => getEscrowUnsettled(Date.now()),
  });
  const strands =
    body && money.escrow?.maxVoucherAmount && money.escrow.maxPerWindow
      ? strandReasons(
          unsettled.data?.unsettled,
          { maxVoucherAmount: money.escrow.maxVoucherAmount.amount, maxPerWindow: money.escrow.maxPerWindow.amount },
          body,
        )
      : [];
  const atRisk = strands.length > 0;
  const count = unsettled.data?.unsettled?.count ?? 0;

  const walletBlocker = useWalletBlocker(money.signerState, money.ownerShort);
  const disabledReason = readOnly
    ? "Your account is blocked, so caps cannot change now."
    : !money.escrow?.exists
      ? "Add funds first: your first deposit opens your escrow."
      : !body
        ? (parsed.perCall.error ?? parsed.perDay.error ?? "Choose caps.")
        : unchanged
          ? "These are your caps already. Pick other numbers to change them."
          : walletBlocker;

  const steps: WalletStep[] = [
    {
      id: "caps",
      label: "Sign the new safety caps",
      cost: "free",
      run: async ({ report }) => {
        const signer = requireSigner(money.signerState, money.ownerShort);
        report({ stage: "preparing" });
        const signed: EscrowLimitsBody = atRisk ? { ...body!, acknowledgeUnsettled: true } : body!;
        const intent = await createEscrowLimitsIntent(signed);
        report({ stage: "wallet" });
        const result = await runEscrowAction(
          intent,
          signer,
          atRisk
            ? {
                ...ESCROW_SUBMITTERS,
                SET_LIMITS: (b) =>
                  submitEscrowLimits({ ...(b as unknown as Parameters<typeof submitEscrowLimits>[0]), acknowledgeUnsettled: true }),
              }
            : ESCROW_SUBMITTERS,
        );
        await applyLimitsSubmitted(queryClient, null, signed, result.kind === "relayed" ? result.relayed.escrow : null);
        void queryClient.invalidateQueries({ queryKey: ["escrow"] });
        const hash = result.kind === "relayed" ? result.relayed.transactionHash : result.signature;
        return { explorerUrl: money.chain ? explorerTxUrl(money.chain, hash) : undefined };
      },
    },
  ];

  return (
    <WalletActionSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Safety caps (enforced on chain)"
      description="The most any one call can cost, and the most your agents can spend in 24 hours. Nobody can go past them, Assay included."
      steps={steps}
      label="Sign to apply (free, no gas)"
      resetKey={`${value.perCall}|${value.perDay}`}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason}
      describeError={describeMoneyError}
      acknowledge={
        atRisk
          ? `${count} ${count === 1 ? "payment is" : "payments are"} still being settled and would no longer fit. I accept that ${count === 1 ? "it" : "they"} will not be paid to the provider${count === 1 ? "" : "s"} and may be owed by me.`
          : undefined
      }
      successTitle="Safety caps set"
      successDescription={
        next
          ? "They apply from the next payment. Next: let your agent pay within them."
          : "They apply from the next payment. Payments may pause for about 30 seconds while the change settles."
      }
      doneAction={next ?? { label: "Done", onClick: () => onOpenChange(false) }}
    >
      <CapsFields unit={money.symbol} value={value} onChange={setValue} parsed={parsed} idPrefix="escrow-caps" label="Safety caps" />
      {current ? (
        <p className="text-body-xs text-03">
          Now: {formatLimit(money.escrow?.maxVoucherAmount)} a call · {formatLimit(money.escrow?.maxPerWindow)} a day.
        </p>
      ) : null}
    </WalletActionSheet>
  );
}
