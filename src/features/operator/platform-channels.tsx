"use client";

import { Waypoints } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { OperatorRole } from "@/interfaces/operator";

import { ChannelActionSheet, channelActionCopy, isChannelRowId, mayRunChannelActions, type ChannelActionKind } from "./channel-actions";
import { rolesPhrase } from "./roles";

/**
 * The platform's payment-channel overrides, on the Contracts page next to
 * Pause (BUG-R2-OPS-01): drain (`M-2`), claim unpaid (`M-3`) and clear a
 * reconciler stop (`M-4`). An incident does not come with a penalty case, so
 * these live here as well as under a provider's payout runs. Same sheets,
 * same role gate (`SRE` or `TRE`), same 20-character note.
 *
 * The backend lists no stopped channel, so the clear takes the channel's row
 * id from the reconciliation finding (or the database) and stays disabled
 * until one is entered.
 */
export function PlatformChannelsCard({ roles }: { roles: readonly OperatorRole[] }) {
  const allowed = mayRunChannelActions(roles);
  const [open, setOpen] = React.useState<ChannelActionKind | null>(null);
  const [rowId, setRowId] = React.useState("");
  const rowIdOk = isChannelRowId(rowId);

  return (
    <section
      aria-label="Payment channels"
      data-testid="operator-platform-channels"
      className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 p-4"
    >
      <div className="flex w-full items-start gap-3">
        <Waypoints aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-03" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="text-label-sm text-01">Payment channels</h2>
          <p className="text-body-13 text-03">
            Platform-wide: settle every provider&rsquo;s pending channels before a pause or an upgrade, claim payouts the token refused,
            or clear a channel the reconciler stopped. The scheduler acts on its next tick.
          </p>
        </div>
      </div>
      <div className="flex w-full flex-col gap-3 pl-7">
        {allowed ? (
          <>
            <div className="flex flex-wrap gap-2">
              {(["drain", "claim"] as const).map((kind) => (
                <Button key={kind} size="sm" variant="secondary" onClick={() => setOpen(kind)}>
                  {channelActionCopy(kind, "platform").button}
                </Button>
              ))}
            </div>
            <div className="flex w-full flex-col gap-2 border-t border-01 pt-3">
              <p className="text-body-13 text-02">
                Clear a reconciler stop: there is no list of stopped channels yet. Take the channel&rsquo;s row id from the reconciliation
                alert (&ldquo;CHANNEL &hellip; stops admitting&rdquo;) or the database, after the investigation.
              </p>
              <div className="flex w-full flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field
                    label="Channel row id"
                    value={rowId}
                    onChange={(event) => setRowId(event.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    maxLength={36}
                    className="font-mono text-mono-xs"
                  />
                </div>
                <Button size="sm" variant="secondary" disabled={!rowIdOk} onClick={() => setOpen("clear")}>
                  {channelActionCopy("clear").button}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <p className="text-body-13 text-03">These need the {rolesPhrase(["SRE", "TRE"])} role.</p>
        )}
      </div>
      {open ? (
        <ChannelActionSheet
          kind={open}
          scope="platform"
          assetId={null}
          payoutAddress={null}
          channelRowId={open === "clear" ? rowId.trim() : ""}
          open
          onOpenChange={(next) => (next ? undefined : setOpen(null))}
        />
      ) : null}
    </section>
  );
}
