import Link from "next/link";
import * as React from "react";

import type { ApprovalQueued } from "@/interfaces/operator";

import { approvalHref } from "./two-person";

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * What a two-person form shows on a 202: the action is queued, not done.
 * Drawn in place of a result, with a link to the inbox entry.
 */
export function QueuedNotice({
  approval,
  onDismiss,
}: {
  approval: ApprovalQueued;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      className="flex w-full flex-col gap-1.5 rounded-md border border-primary-20 bg-primary-10 p-3"
    >
      <p className="text-label-13 text-01">
        Sent for approval (id <span className="font-mono text-mono-12">{approval.approvalId}</span>)
      </p>
      <p className="text-body-xs text-02">
        Waiting for a second operator&apos;s approval. Nothing has happened yet. A second operator must approve it in the approvals inbox before
        it runs. It expires at {when(approval.expiresAt)} if nobody does.
      </p>
      <span className="flex flex-wrap items-center gap-3">
        <Link
          href={approvalHref(approval.approvalId)}
          className="text-label-13 text-primary-600 hover:underline"
        >
          Open in the approvals inbox
        </Link>
        {onDismiss ? (
          <button type="button" onClick={onDismiss} className="text-label-13 text-03 hover:text-01">
            Dismiss
          </button>
        ) : null}
      </span>
    </div>
  );
}
