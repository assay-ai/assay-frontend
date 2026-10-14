"use client";

import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { DASH, stampUtc } from "@/features/g34a/stats";
import { holdChainName } from "@/features/slash-hold/model";
import type { SlashHoldHealth } from "@/interfaces/operator";
import { operatorHoldReasonText } from "@/libs/slash-hold";

/** Oldest hold first: the one stuck longest is the one to look at. */
export function sortHoldsOldestFirst(holds: readonly SlashHoldHealth[]): SlashHoldHealth[] {
  return [...holds].sort(
    (a, b) =>
      Date.parse(a.heldSince) - Date.parse(b.heldSince)
      || a.providerId.localeCompare(b.providerId)
      || a.chainId.localeCompare(b.chainId),
  );
}

/**
 * `GET /operator/health` → `slashHolds`: providers whose paid calls are not
 * routed on a chain while their penalties cannot be collected. Read-only: a
 * hold lifts by itself once two checks in a row find it clear. `undefined`
 * (an older backend) says so rather than claiming there are none.
 */
export function SlashHoldsPanel({ holds, loading }: { holds: readonly SlashHoldHealth[] | undefined; loading: boolean }) {
  const rows = holds ? sortHoldsOldestFirst(holds) : [];
  return (
    <Panel className="w-full">
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>Slash holds</PanelTitle>
          <PanelDescription>
            providers not routed on a chain while their penalties cannot be collected · lifts by itself
          </PanelDescription>
        </PanelTitles>
      </PanelHeader>
      <PanelBody className="p-4 tablet:p-5">
        {loading ? (
          <p className="text-body-13 text-03">Loading…</p>
        ) : holds === undefined ? (
          <p className="text-body-13 text-03">This backend does not report slash holds.</p>
        ) : rows.length === 0 ? (
          <p className="text-body-13 text-02">No provider is on a slash hold.</p>
        ) : (
          <ul className="flex w-full min-w-0 flex-col gap-2">
            {rows.map((hold) => (
              <li
                key={`${hold.providerId}:${hold.chainId}`}
                className="flex w-full min-w-0 flex-col gap-1.5 rounded-lg border border-warning-20 bg-warning-10 p-3"
              >
                <dl className="grid w-full grid-cols-1 gap-x-5 gap-y-1.5 tablet:grid-cols-2 desktop:grid-cols-4">
                  <Fact label="Provider">{hold.providerId}</Fact>
                  <Fact label="Chain">{`${holdChainName(hold.chainId)} (${hold.chainId})`}</Fact>
                  <Fact label="Held since">{`${stampUtc(hold.heldSince)} UTC`}</Fact>
                  <Fact label="Last checked">{hold.checkedAt ? `${stampUtc(hold.checkedAt)} UTC` : DASH}</Fact>
                </dl>
                <ul className="flex flex-col gap-0.5">
                  {hold.reasons.map((reason) => (
                    <li key={reason} className="text-body-13 text-warning-700">
                      {operatorHoldReasonText(reason)}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-body-xs text-03">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-mono-12 text-01">{children}</dd>
    </div>
  );
}
