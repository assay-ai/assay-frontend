"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { Panel, PanelBody, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/libs/ApiClient";
import { plainApiError } from "@/libs/plain-language";
import { getReceiptPrivacy, updateReceiptPrivacy, type ReceiptPrivacy } from "@/services/receipt-privacy.service";
import { toast } from "@/utils/toast";

const KEY = ["receipt-privacy"] as const;

/** Settings › Receipts: whether a receipt's public link (`/explorer/call/<id>`) opens for anyone. */
export function ReceiptPrivacySetting() {
  const queryClient = useQueryClient();
  const query = useQuery<ReceiptPrivacy, ApiError>({
    queryKey: KEY,
    queryFn: getReceiptPrivacy,
    retry: 0,
    networkMode: "always" as const,
  });
  const mutation = useMutation<ReceiptPrivacy, unknown, boolean>({
    mutationFn: updateReceiptPrivacy,
    onSuccess: (next) => {
      queryClient.setQueryData(KEY, next);
      toast.success(next.receiptsPublic ? "Your receipts open for anyone with the link." : "Your receipts no longer open from a public link.");
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? plainApiError(error) : "That did not save. Try again in a moment.");
    },
  });
  const on = mutation.isPending ? mutation.variables === true : query.data?.receiptsPublic === true;

  return (
    <Panel>
      <PanelHeader>
        <PanelTitles>
          <PanelTitle as="h2">Receipts</PanelTitle>
        </PanelTitles>
      </PanelHeader>
      <PanelBody className="gap-2 px-5 pb-[18px] pt-2">
        <div className="flex w-full items-center justify-between gap-4 py-2.5">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body-13 text-01" id="receipts-public-label">
              Show my receipts to anyone with the link
            </span>
            <span className="text-body-xs text-03">
              They see only the price, the tool and the check results. Changes can take up to 30 seconds to apply.
            </span>
          </div>
          {query.isError ? null : (
            <Switch
              aria-labelledby="receipts-public-label"
              checked={on}
              disabled={query.isPending || mutation.isPending}
              onChange={(e) => mutation.mutate(e.currentTarget.checked)}
            />
          )}
        </div>
        {query.isError ? (
          <p className="text-body-13 text-02" role="status">
            This setting could not be loaded.{" "}
            <button type="button" className="text-primary-600 hover:underline" onClick={() => void query.refetch()}>
              Try again
            </button>
          </p>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
