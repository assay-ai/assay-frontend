"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Waypoints } from "lucide-react";
import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { OperatorRole, StoppedChannel } from "@/interfaces/operator";
import { shortAddress } from "@/libs/chains/format";
import { listStoppedChannels } from "@/services/operator.service";

import {
  ChannelActionSheet,
  channelActionCopy,
  isChannelRowId,
  mayRunChannelActions,
  type ChannelActionKind,
  type ChannelActionOutcome,
} from "./channel-actions";
import { ResultCard } from "./result-card";
import { rolesPhrase } from "./roles";

/** The roles `GET /operator/channels/stopped` serves (read only). */
const LIST_ROLES: readonly OperatorRole[] = ["SRE", "TRE", "OPS_ADMIN"];

export const STOPPED_CHANNELS_KEY = ["operator", "channels", "stopped"] as const;

/** Whether these roles may read the list of stopped channels. Pure. */
export function mayListStoppedChannels(roles: readonly OperatorRole[]): boolean {
  return roles.some((role) => LIST_ROLES.includes(role));
}

/** "0x0c0c…0c0c" for a channel key or an id, so a row stays one line. Pure. */
function shortId(value: string, edge = 6): string {
  return value.length <= edge * 2 + 1 ? value : `${value.slice(0, edge)}…${value.slice(-4)}`;
}

/** The payer's address, short, from its CAIP-10 account. Pure. */
export function stoppedChannelPayer(channel: Pick<StoppedChannel, "chainId" | "payer">): string {
  const address = channel.payer.split(":").at(-1) ?? channel.payer;
  return shortAddress(channel.chainId, address);
}

/**
 * The platform's payment-channel overrides, on the Contracts page next to
 * Pause (BUG-R2-OPS-01): drain (`M-2`), claim unpaid (`M-3`) and clear a
 * reconciler stop (`M-4`). An incident does not come with a penalty case, so
 * these live here as well as under a provider's payout runs. Same sheets,
 * same role gate (`SRE` or `TRE`), same 20-character note.
 *
 * The stopped channels come from `GET /operator/channels/stopped` (`SRE`,
 * `TRE`, `OPS_ADMIN`), each with its own clear. Only when that list cannot be
 * read does the clear fall back to a row id typed from the reconciliation
 * finding (`channelRowId`).
 */
export function PlatformChannelsCard({ roles }: { roles: readonly OperatorRole[] }) {
  const allowed = mayRunChannelActions(roles);
  const mayList = mayListStoppedChannels(roles);
  const queryClient = useQueryClient();
  const stopped = useQuery({ queryKey: STOPPED_CHANNELS_KEY, queryFn: listStoppedChannels, enabled: mayList, retry: 0 });
  const [open, setOpen] = React.useState<{ kind: ChannelActionKind; rowId?: string } | null>(null);
  const [rowId, setRowId] = React.useState("");
  const rowIdOk = isChannelRowId(rowId);
  const [outcome, setOutcome] = React.useState<ChannelActionOutcome | null>(null);
  const done = (kind: ChannelActionKind) => (next: ChannelActionOutcome) => {
    setOutcome(next);
    if (kind === "clear") void queryClient.invalidateQueries({ queryKey: STOPPED_CHANNELS_KEY });
  };

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
          <div className="flex flex-wrap gap-2">
            {(["drain", "claim"] as const).map((kind) => (
              <Button key={kind} size="sm" variant="secondary" onClick={() => setOpen({ kind })}>
                {channelActionCopy(kind, "platform").button}
              </Button>
            ))}
          </div>
        ) : null}
        {outcome ? <ResultCard title={outcome.title} next={outcome.next} onDismiss={() => setOutcome(null)} /> : null}
        {mayList ? (
          <div className="flex w-full flex-col gap-2 border-t border-01 pt-3" data-testid="stopped-channels">
            <h3 className="text-label-13 text-01">Stopped channels</h3>
            {stopped.isPending ? (
              <p className="text-body-13 text-03">Loading the stopped channels&hellip;</p>
            ) : stopped.isError ? (
              <>
                <p className="text-body-13 text-warning-700" role="alert">
                  The list of stopped channels could not be read.
                  {allowed
                    ? " To clear one now, take its row id (channelRowId) from the reconciliation alert (“CHANNEL … stops admitting”), after the investigation."
                    : ""}
                </p>
                {allowed ? (
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
                    <Button size="sm" variant="secondary" disabled={!rowIdOk} onClick={() => setOpen({ kind: "clear", rowId: rowId.trim() })}>
                      {channelActionCopy("clear").button}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : stopped.data.length === 0 ? (
              <p className="text-body-13 text-03">No stopped channels.</p>
            ) : (
              <ul className="flex w-full flex-col">
                {stopped.data.map((channel) => (
                  <li
                    key={channel.channelRowId}
                    data-testid="stopped-channel"
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 border-t border-01 py-2.5 first:border-t-0"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-mono text-mono-xs text-01" title={channel.channelKey}>
                        Channel {shortId(channel.channelKey, 10)}
                      </span>
                      <span className="text-body-xs text-03">
                        Provider <span title={channel.providerId}>{shortId(channel.providerId, 8)}</span> · payer{" "}
                        <span title={channel.payer}>{stoppedChannelPayer(channel)}</span> · stopped{" "}
                        <UtcTime value={channel.stoppedAt} alwaysDay midSentence /> · {channel.reason}
                      </span>
                    </span>
                    {allowed ? (
                      <Button size="sm" variant="secondary" onClick={() => setOpen({ kind: "clear", rowId: channel.channelRowId })}>
                        {channelActionCopy("clear").button}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
        {!allowed ? <p className="text-body-13 text-03">The overrides need the {rolesPhrase(["SRE", "TRE"])} role.</p> : null}
      </div>
      {open ? (
        <ChannelActionSheet
          kind={open.kind}
          scope="platform"
          assetId={null}
          payoutAddress={null}
          channelRowId={open.kind === "clear" ? (open.rowId ?? "") : ""}
          open
          onOpenChange={(next) => (next ? undefined : setOpen(null))}
          onDone={done(open.kind)}
        />
      ) : null}
    </section>
  );
}
