"use client";

import { useQuery } from "@tanstack/react-query";

import type { OperatorProviderSettlement, OperatorRole } from "@/interfaces/operator";
import { formatDateTime, formatRelative } from "@/libs/utc-time";
import { getOperatorProviderSettlement } from "@/services/operator.service";
import { formatMoney } from "@/utils/money";

import { ChannelActions } from "./channel-actions";

const CADENCE_TEXT: Record<OperatorProviderSettlement["payoutCadence"], string> = {
  HOURLY: "Hourly, once at least $25 is ready",
  EVERY_6_HOURS: "Every 6 hours (default)",
};

/** The rows the operator reads, pure so a test can pin the words (round-2 SPEC-W2 §11). */
export function providerSettlementRows(
  settlement: OperatorProviderSettlement,
  now: number,
): { label: string; value: string }[] {
  return [
    { label: "Payout cadence", value: CADENCE_TEXT[settlement.payoutCadence] ?? settlement.payoutCadence },
    {
      label: "Next payout",
      value: settlement.nextPayoutAt ? `about ${formatDateTime(settlement.nextPayoutAt, { now, midSentence: true })}` : "None planned",
    },
    { label: "Last settle", value: settlement.lastSettleAt ? formatRelative(settlement.lastSettleAt, { now }) : "None yet" },
    { label: "Last collect", value: settlement.lastCollectAt ? formatRelative(settlement.lastCollectAt, { now }) : "None yet" },
    {
      label: "Pending settlement",
      value: `${settlement.pendingSettlement ? formatMoney(settlement.pendingSettlement) : "—"} · ${settlement.openChannels} open ${settlement.openChannels === 1 ? "channel" : "channels"}`,
    },
  ];
}

/**
 * A provider's payout runs for the operator: cadence and next run, and the
 * last confirmed settle and collect. Hidden on a server without the route.
 * `SRE` and `TRE` also get the channel overrides (drain, claim unpaid) under it.
 */
export function ProviderSettlementFacts({
  providerId,
  now,
  roles = [],
}: {
  providerId: string;
  now: number;
  roles?: readonly OperatorRole[];
}) {
  const query = useQuery({
    queryKey: ["operator", "provider-settlement", providerId],
    queryFn: () => getOperatorProviderSettlement(providerId),
    retry: 0,
    refetchInterval: 60_000,
  });
  if (!query.data) return null;
  return (
    <section aria-label="Payout runs" className="w-full rounded-xl border border-01 bg-01" data-testid="operator-provider-settlement">
      <h2 className="border-b border-01 px-4 py-2.5 text-label-13 text-01">Payout runs</h2>
      <dl className="text-body-13">
        {providerSettlementRows(query.data, now).map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3 border-b border-01 px-4 py-2.5 last:border-b-0">
            <dt className="text-03">{row.label}</dt>
            <dd className="text-right tabular-nums text-01">{row.value}</dd>
          </div>
        ))}
      </dl>
      <ChannelActions
        roles={roles}
        assetId={query.data.pendingSettlement?.asset ?? null}
        payoutAddress={query.data.payoutAddress ?? null}
      />
    </section>
  );
}
