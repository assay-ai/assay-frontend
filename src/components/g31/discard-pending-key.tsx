"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { plainApiError } from "@/libs/plain-language";
import { discardPendingDelegate } from "@/services/account.service";
import { toast } from "@/utils/toast";

export const DISCARD_PENDING_STRINGS = {
  confirm: "Discard this new payment key? The current key keeps paying. Your app must ask again to replace it.",
  done: "New payment key discarded",
} as const;

/**
 * "Discard" beside a payment key waiting for approval
 * (`DELETE /agents/:agentId/credentials/:id/pending-delegate`, person only,
 * idempotent). One short confirm in place, then the list is read again. The
 * bound key is untouched.
 */
export function DiscardPendingKey({
  agentId,
  credentialId,
  onDiscarded,
}: {
  agentId: string;
  credentialId: string;
  onDiscarded: () => void;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const discard = useMutation({
    mutationFn: () => discardPendingDelegate(agentId, credentialId),
    onSuccess: () => {
      setConfirming(false);
      toast.success(DISCARD_PENDING_STRINGS.done);
      onDiscarded();
    },
  });

  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="secondary"
        type="button"
        className="self-start"
        data-testid="discard-pending-key"
        onClick={() => setConfirming(true)}
      >
        Discard
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 pt-1" data-testid="discard-pending-confirm">
      <span className="text-body-xs text-01">{DISCARD_PENDING_STRINGS.confirm}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          type="button"
          className="text-danger-600"
          loading={discard.isPending}
          onClick={() => discard.mutate()}
        >
          {discard.isPending ? "Discarding…" : "Discard key"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={discard.isPending}
          onClick={() => {
            discard.reset();
            setConfirming(false);
          }}
        >
          Keep it
        </Button>
      </div>
      {discard.error ? (
        <span role="alert" className="text-body-xs text-danger-600">
          {plainApiError(discard.error as { code?: string; status?: number })}
        </span>
      ) : null}
    </div>
  );
}
