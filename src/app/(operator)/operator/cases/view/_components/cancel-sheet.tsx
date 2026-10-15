"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { PageState } from "@/components/patterns/page-state";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ContractCallAction } from "@/features/operator/contract-call-action";
import { operatorErrorSentence } from "@/features/operator/operator-errors";
import type { CancelIntent } from "@/interfaces/operator";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { ApiError } from "@/libs/ApiClient";
import { createCancelIntent } from "@/services/operator.service";

/**
 * Get a requested cancel signed. Opening the sheet builds the cancel (it
 * changes nothing: unsigned bytes), then it is one "Sign and send" when this
 * browser holds the arbiter's wallet, otherwise a Safe batch to download.
 * The case moves to cancelled on its own once the chain watcher sees it.
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
  deadlineText,
  onSigned,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: string;
  penaltyAsset: string;
  /** "before 18 Oct, 14:00" */
  deadlineText: string;
  onSigned: (hash: string | null) => void;
}) {
  const build = useMutation({ mutationFn: () => createCancelIntent(proposalId) });
  const { mutate, reset } = build;

  React.useEffect(() => {
    if (open) mutate();
    else reset();
  }, [open, mutate, reset]);

  const intent = build.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent showCloseButton>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Get the cancel signed</SheetTitle>
          <SheetDescription>
            The penalty is cancelled in Assay, but its record still holds the provider&rsquo;s stake on chain. Only the
            arbiter&rsquo;s key can retire it, {deadlineText}; after that anyone can execute the penalty.
          </SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-4">
          {build.isPending || build.isIdle ? (
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
            <ContractCallAction
              call={evmCancelCall(intent, penaltyAsset)}
              signLabel="Sign and send the cancel"
              successTitle="Cancel sent"
              successDescription="The penalty shows as cancelled once the chain watcher reads it back, usually within a minute."
              afterExport="Import the file in the Safe that holds the arbiter key and sign it there. The penalty shows as cancelled once it lands."
              onSigned={onSigned}
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
