"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { formatLimit } from "@/components/g31/format";
import { WalletActionSheet, type WalletStep } from "@/components/patterns/sign-action";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { capsToForm, parseCaps } from "@/features/buyer-money/caps";
import { describeMoneyError } from "@/features/buyer-money/money-errors";
import {
  hasTightenDelay,
  loweredDelayNote,
  strandAcknowledgement,
  strandReasons,
} from "@/features/delegation/unsettled";
import { applyLimitsSubmitted } from "@/features/escrow/after-set-limits";
import { ESCROW_SUBMITTERS, runEscrowAction } from "@/features/escrow/relayed-submission";
import type { EscrowLimitsBody } from "@/interfaces";
import { explorerTxUrl } from "@/libs/chains/explorer";
import { freeCallsOnlyText, servesPaidCalls } from "@/libs/chains/paid-rails";
import { getEscrowUnsettled } from "@/services/delegation.service";
import { createEscrowLimitsIntent, submitEscrowLimits } from "@/services/escrow.service";

import { CapsFields, type CapsValue } from "./caps-fields";
import { requireSigner, useBuyerMoney, useWalletBlocker } from "./use-buyer-money";

/**
 * The account ceiling (enforced on chain): the two limits on the whole escrow
 * that nobody, the platform included, can exceed — whichever agent pays.
 * Each agent's own spending limits sit under it. Presets so nobody has to invent numbers,
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
  /*
    An escrow with the tighten delay (assay-evm D-21) applies lower limits to
    payments already signed only after that delay, so nothing can be stranded:
    no warning, no acknowledgement — just say when they apply.
  */
  const tightenDelay = unsettled.data?.tightenDelaySeconds;
  const currentCaps =
    money.escrow?.maxVoucherAmount && money.escrow.maxPerWindow
      ? { maxVoucherAmount: money.escrow.maxVoucherAmount.amount, maxPerWindow: money.escrow.maxPerWindow.amount }
      : null;
  const strands = body && currentCaps ? strandReasons(unsettled.data?.unsettled, currentCaps, body, tightenDelay) : [];
  const atRisk = strands.length > 0;
  const loweredNote = body && currentCaps ? loweredDelayNote(tightenDelay, currentCaps, body) : null;
  // Solana serves free calls only (paid rails off): the ceiling caps no call there today.
  const freeOnly = money.chainId !== null && !servesPaidCalls(money.chainId);

  const walletBlocker = useWalletBlocker(money.signerState, money.ownerShort);
  const disabledReason = readOnly
    ? "Your account is blocked, so the ceiling cannot change now."
    : !money.escrow?.exists
      ? "Add funds first: your first deposit opens your escrow."
      : !body
        ? (parsed.perCall.error ?? parsed.perDay.error ?? "Choose a ceiling.")
        : unchanged
          ? "This is your ceiling already. Pick other numbers to change it."
          : walletBlocker;

  const steps: WalletStep[] = [
    {
      id: "caps",
      label: "Sign the new account ceiling",
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
          // Signed only if the payload carries exactly the ceiling chosen here.
          { kind: "SET_LIMITS", maxVoucherAmount: signed.maxVoucherAmount, maxPerWindow: signed.maxPerWindow },
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
      chain={money.chain}
      title="Account ceiling (on chain)"
      description="Protects your whole escrow: the most any one call can cost, and the most all your agents together can spend in 24 hours. Nobody can go past it, Assay included. Each agent's own spending limits sit under it."
      steps={steps}
      label="Sign to apply (free, no gas)"
      resetKey={`${value.perCall}|${value.perDay}`}
      disabled={Boolean(disabledReason)}
      disabledReason={disabledReason}
      describeError={describeMoneyError}
      acknowledge={atRisk ? (strandAcknowledgement(unsettled.data?.unsettled) ?? undefined) : undefined}
      successTitle="Account ceiling set"
      successDescription={
        next
          ? "It applies from the next payment. Next: let your agent pay under it."
          : loweredNote && hasTightenDelay(tightenDelay)
            ? `It applies from the next payment. ${loweredNote}`
            : "It applies from the next payment. Payments may pause for about 30 seconds while the change settles."
      }
      doneAction={next ?? { label: "Done", onClick: () => onOpenChange(false) }}
    >
      <CapsFields
        unit={money.symbol}
        value={value}
        onChange={setValue}
        parsed={parsed}
        idPrefix="escrow-caps"
        label="Account ceiling"
        current={current}
      />
      {current ? (
        <p className="text-body-xs text-03">
          Now: {formatLimit(money.escrow?.maxVoucherAmount)} a call · {formatLimit(money.escrow?.maxPerWindow)} per 24 hours.
        </p>
      ) : null}
      {loweredNote ? (
        <p className="text-body-13 text-02" data-testid="limits-tighten-delay">
          {loweredNote}
        </p>
      ) : null}
      {freeOnly && money.chainName ? (
        <p className="text-body-13 text-warning-700" data-testid="escrow-free-calls-only">
          {freeCallsOnlyText(money.chainName)} This ceiling only applies to paid calls, so it has no effect on this
          chain for now.
        </p>
      ) : null}
    </WalletActionSheet>
  );
}
