"use client";

import { useMutation } from "@tanstack/react-query";
import { Clock, PenLine, ShieldCheck } from "lucide-react";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { PageState } from "@/components/patterns/page-state";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmedCancelCall } from "@/features/operator/confirmed-cancel-call";
import { nothingStandingOutcome, operatorErrorSentence } from "@/features/operator/operator-errors";
import type { CancelIntent } from "@/interfaces/operator";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { ApiError } from "@/libs/ApiClient";
import { createCancelIntent } from "@/services/operator.service";

import { WhatHappens } from "./what-happens";

/**
 * Get a requested cancel signed. Opening the sheet builds the cancel (it
 * changes nothing: unsigned bytes), then it is one "Sign and send" when this
 * browser holds the arbiter's wallet, otherwise a file to download and sign
 * in the arbiter's multi-signer wallet.
 * The case moves to cancelled on its own once the chain watcher sees it.
 *
 * When nothing of the penalty stands on chain (409 SLASH_NOTHING_STANDING,
 * read from the chain by the backend), there is nothing to sign: the sheet
 * says what the read showed (`error.context.chainStatus`, `closed`) and the
 * page reads the penalty again. `mode: "close"` is the same call made on
 * purpose for a penalty the brief already reads as having nothing on chain:
 * the 409 with `closed` is its success.
 */
function evmCancelCall(intent: CancelIntent, penaltyAsset: string): SlashContractCall {
  return {
    chainId: penaltyAsset.split("/")[0] ?? penaltyAsset,
    to: intent.to ?? "",
    data: intent.transaction,
    value: "0",
    signer: intent.admin,
    // Always the arbiter on EVM: the backend builds `cancelSlash` for no one else.
    signerRole: "ARBITER",
    functionName: "cancelSlash",
    requestIds: [intent.requestId.startsWith("0x") ? intent.requestId : `0x${intent.requestId}`],
  };
}

export function CancelSheet({
  open,
  onOpenChange,
  proposalId,
  penaltyAsset,
  deadlineSentence,
  onSigned,
  onNothingStanding,
  mode = "sign",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  penaltyAsset: string;
  /** When it must be signed by and what happens if not (`cancelDeadlineSentence`). */
  deadlineSentence: string;
  onSigned: (hash: string | null) => void;
  /** The backend found nothing on chain to cancel (see the error's context): read the penalty again. */
  onNothingStanding?: (error: ApiError) => void;
  /** "close": confirm nothing stands and close the on-chain side (no signature). */
  mode?: "sign" | "close";
}) {
  const build = useMutation({
    mutationFn: () => createCancelIntent(proposalId),
    onError: (error) => {
      if (error instanceof ApiError && error.code === "SLASH_NOTHING_STANDING") onNothingStanding?.(error);
    },
  });
  const { mutate, reset } = build;

  React.useEffect(() => {
    if (open) mutate();
    else reset();
  }, [open, mutate, reset]);

  const intent = build.data;
  const nothingStanding = build.error instanceof ApiError && build.error.code === "SLASH_NOTHING_STANDING";
  const [signing, setSigning] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={(next) => (signing ? undefined : onOpenChange(next))}>
      <SheetContent showCloseButton={!signing}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">{mode === "close" ? "Close the on-chain side" : "Get the cancel signed"}</SheetTitle>
          <SheetDescription className="sr-only">Only the arbiter&rsquo;s key can retire the record on chain.</SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-4">
          {nothingStanding || mode === "close" ? null : (
            <WhatHappens
              lines={[
                { icon: <ShieldCheck />, text: "The reserved stake goes back to the provider once it lands." },
                { icon: <PenLine />, text: "Signed by the arbiter key: sign here if this browser holds it, or download the file to sign." },
                { icon: <Clock />, text: deadlineSentence },
              ]}
            />
          )}
          {nothingStanding && build.error instanceof ApiError ? (
            (() => {
              const outcome = nothingStandingOutcome(build.error);
              return (
                <div
                  role={outcome.alert ? "alert" : "status"}
                  className={
                    outcome.alert
                      ? "flex w-full flex-col gap-1 rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-3"
                      : "flex w-full flex-col gap-1 rounded-lg border border-01 bg-02 px-3.5 py-3"
                  }
                  data-testid="nothing-on-chain"
                >
                  <p className={outcome.alert ? "text-label-13 text-danger-700" : "text-label-13 text-01"}>{outcome.title}</p>
                  <p className="text-body-13 text-02">{outcome.next}</p>
                </div>
              );
            })()
          ) : build.isPending || build.isIdle ? (
            <PageState kind="loading" rows={2} label="Preparing the cancel" bare />
          ) : build.isError ? (
            <PageState
              kind="error"
              title="The cancel could not be prepared"
              description={operatorErrorSentence(build.error)}
              onRetry={() => mutate()}
              code={build.error instanceof ApiError ? build.error.code : null}
              bare
            />
          ) : intent && intent.to ? (
            /*
              The case brief carries no on-chain request id to compare the call
              with (frontend review N3), so the id decoded from the calldata is
              shown and the operator ticks it; only that id is then signed.
            */
            <ConfirmedCancelCall
              call={evmCancelCall(intent, penaltyAsset)}
              signLabel="Sign and send the cancel"
              successTitle="Cancel sent"
              successDescription="The penalty shows as cancelled once the chain watcher reads it back, usually within a minute."
              afterExport="Open the file in the arbiter's multi-signer wallet and sign it there. The penalty shows as cancelled once it lands."
              onSigned={onSigned}
              onBusyChange={setSigning}
            />
          ) : intent ? (
            <div className="flex w-full flex-col gap-2">
              <p className="text-body-13 text-02">
                On this chain the program admin signs the cancel. Copy the transaction to the machine that holds that key.
              </p>
              <div className="flex flex-wrap gap-2">
                <CopyChip value={intent.transaction} display="Copy transaction" label="cancel transaction" />
                <CopyChip value={intent.admin} label="signer address" />
              </div>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
