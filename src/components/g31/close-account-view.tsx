"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleX, Download, TriangleAlert } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { chainBalances } from "@/features/g30/balance";
import type { Money } from "@/interfaces";
import { getBalances, getHolds } from "@/services/balances.service";
import { chainLabel } from "@/utils/chain";
import { formatMoney } from "@/utils/money";

import { MicroLabel, PageHeader } from "./chrome";
import { timestamp } from "./format";

/**
 * Close account.
 *
 * The design's rule is in the panel subtitle and it is the reason this screen
 * exists at all: blockers are **enumerated with intent ids and expiry** —
 * never a bare "you have open holds". Somebody who cannot close their account
 * is owed the list, not the verdict.
 *
 * Two of the design's three blocker rows are real. Open holds come from
 * `GET /holds` with their intent ids and expiry, and the withdrawable balance
 * from `GET /balances`. The challenge-window and promotional-credit rows have
 * no endpoint — there is no disputes-window-per-receipt count on the buyer
 * surface, and `balances` has no promotional split (available is withdrawable
 * in full today) — so they are not fabricated.
 *
 * Nothing here can actually close an account: no deactivation endpoint exists.
 * The button is disabled rather than absent, because the order of operations
 * below is the useful part of the screen and it needs its terminal step shown.
 */

interface Hold {
  id?: string;
  intentId?: string;
  amount?: Money;
  status?: string;
  expiresAt?: string | null;
  createdAt?: string;
}

const STEPS = [
  "Export receipts, statements and the activity log — required, not optional",
  "Wait for the open holds to settle or expire (max 24h)",
  "Withdraw the withdrawable balance to an allowlisted destination",
  "Revoke all credentials and browser sessions",
  "Revoke the session signer",
  "Deactivate the account",
];

export function CloseAccountView() {
  const balances = useQuery({ queryKey: ["balances"], retry: false, queryFn: getBalances });
  const holds = useQuery({
    queryKey: ["holds"],
    retry: false,
    queryFn: () => getHolds() as Promise<{ items?: Hold[] } | Hold[]>,
  });

  const holdItems: Hold[] = React.useMemo(() => {
    const data = holds.data;
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  }, [holds.data]);

  /*
    Every chain's row, never `balances[0]`.

    This is the one screen where that defect could cost real money: a buyer
    with funds on a second chain reads "Withdrawable balance —" or one chain's
    smaller figure, concludes there is nothing left, and closes over a funded
    account. So this view shows every row and refuses to summarise — one
    blocker line per chain, each naming its chain, and no total.
  */
  const rows = chainBalances(balances.data?.balances);
  // Only an account that really holds money blocks closure; a $0.00 hold is noise.
  const heldRows = rows.filter((row) => BigInt(row.held.amount) > 0n);
  const multiChain = rows.length > 1;
  const suffix = (chainId: string) => (multiChain ? ` · ${chainLabel(chainId)}` : "");

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Close account"
        subtitle="Phase 2 · export is forced before deactivation; credentials and the signer are revoked last"
        actions={
          <Button variant="secondary" icon={<Download />} type="button" disabled>
            Export everything
          </Button>
        }
      />

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>What is blocking closure</PanelTitle>
            <PanelDescription className="whitespace-normal">
              enumerated with intent ids and expiry — never a bare “you have open holds”
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          <div className="w-full overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="flex items-center gap-3 border-b border-02 px-3 pb-2.5">
                <div className="min-w-0 flex-1">
                  <MicroLabel>Blocker</MicroLabel>
                </div>
                <div className="w-[140px] text-right">
                  <MicroLabel>Amount</MicroLabel>
                </div>
                <div className="w-[220px] text-right">
                  <MicroLabel>Expires</MicroLabel>
                </div>
                <div className="w-[240px] text-right">
                  <MicroLabel>Reference</MicroLabel>
                </div>
              </div>

              {holds.isPending ? (
                <p className="px-3 py-3 font-mono text-mono-13 text-03">Loading holds…</p>
              ) : holds.isError ? (
                <p className="px-3 py-3 text-body-13 text-danger-600">
                  Open holds could not be read. This list is not a statement that nothing is
                  blocking closure.
                </p>
              ) : holdItems.length === 0 ? (
                /* `.length`, not the array — an array is always truthy, and a
                   zero-row response must read as "could not be read", not as a
                   held figure of $0.00 on an account that may hold money. */
                heldRows.length === 0 ? (
                  <div className="flex items-center gap-3 border-b border-01 px-3 py-2.5">
                    <div className="min-w-0 flex-1 font-mono text-mono-12 font-semibold text-01">
                      No call in flight
                    </div>
                    <div className="w-[140px] text-right font-mono text-mono-12 text-02">—</div>
                    <div className="w-[220px] text-right font-mono text-mono-12 text-02">—</div>
                    <div className="w-[240px] text-right font-mono text-mono-12 text-02">—</div>
                  </div>
                ) : (
                  heldRows.map((row) => (
                    <div
                      key={`held-${row.accountId}`}
                      className="flex items-center gap-3 border-b border-01 px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1 truncate font-mono text-mono-12 font-semibold text-01">
                        Funds held{suffix(row.chainId)}
                      </div>
                      <div className="w-[140px] text-right font-mono text-mono-12 text-02">
                        {formatMoney(row.held, { decimals: 2 })}
                      </div>
                      <div className="w-[220px] text-right font-mono text-mono-12 text-02">—</div>
                      <div className="w-[240px] truncate text-right font-mono text-mono-12 text-02">
                        {chainLabel(row.chainId)}
                      </div>
                    </div>
                  ))
                )
              ) : (
                holdItems.map((hold, index) => (
                  <div
                    key={hold.id ?? hold.intentId ?? index}
                    className="flex items-center gap-3 border-b border-01 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1 truncate font-mono text-mono-12 font-semibold text-01">
                      Call in flight{hold.status ? ` · ${hold.status}` : ""}
                    </div>
                    <div className="w-[140px] text-right font-mono text-mono-12 text-02">
                      {hold.amount ? formatMoney(hold.amount, { decimals: 4 }) : "—"}
                    </div>
                    <div className="w-[220px] text-right font-mono text-mono-12 text-02">
                      {hold.expiresAt ? timestamp(hold.expiresAt) : "within 24h"}
                    </div>
                    <div className="w-[240px] truncate text-right font-mono text-mono-12 text-02">
                      {hold.intentId ?? hold.id ?? "—"}
                    </div>
                  </div>
                ))
              )}

              {/* One line per chain, and no total. Two chains means two
                  withdrawals — a single figure here would be a promise
                  that one of them empties the account. */}
              {rows.length === 0 ? (
                <div className="flex items-center gap-3 border-b border-01 px-3 py-2.5">
                  <div className="min-w-0 flex-1 font-mono text-mono-12 font-semibold text-01">
                    Withdrawable balance
                  </div>
                  <div className="w-[140px] text-right font-mono text-mono-12 text-02">—</div>
                  <div className="w-[220px] text-right font-mono text-mono-12 text-02">
                    must be withdrawn first
                  </div>
                  <div className="w-[240px] text-right font-mono text-mono-12 text-02">balances</div>
                </div>
              ) : (
                rows.map((row) => (
                  <div
                    key={`withdrawable-${row.accountId}`}
                    className="flex items-center gap-3 border-b border-01 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1 truncate font-mono text-mono-12 font-semibold text-01">
                      Withdrawable balance{suffix(row.chainId)}
                    </div>
                    <div className="w-[140px] text-right font-mono text-mono-12 text-02">
                      {formatMoney(row.withdrawable ?? row.available, { decimals: 2 })}
                    </div>
                    <div className="w-[220px] text-right font-mono text-mono-12 text-02">
                      must be withdrawn first
                    </div>
                    <div className="w-[240px] truncate text-right font-mono text-mono-12 text-02">
                      {chainLabel(row.chainId)}
                    </div>
                  </div>
                ))
              )}

              <div className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1 font-mono text-mono-12 font-semibold text-01">
                  Challenge windows and promotional credit
                </div>
                <div className="w-[140px] text-right font-mono text-mono-12 text-03">—</div>
                <div className="w-[220px] text-right font-mono text-mono-12 text-03">
                  no endpoint
                </div>
                <div className="w-[240px] text-right font-mono text-mono-12 text-03">—</div>
              </div>
            </div>
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Order of operations</PanelTitle>
            <PanelDescription className="whitespace-normal">
              the sequence matters: revoking authority first would strand the holds
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-3 p-5">
          {STEPS.map((step, index) => (
            <div key={step} className="flex w-full items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-03 font-mono text-mono-xs font-semibold text-02">
                {index + 1}
              </span>
              <span className="text-body-13 text-01">{step}</span>
            </div>
          ))}
        </PanelBody>
      </Panel>

      <div className="flex w-full items-start gap-2.5 rounded-lg border border-warning-20 bg-warning-10 p-3.5 tablet:p-[15px]">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-warning-600" />
        <p className="text-body-13 text-warning-700">
          Promotional credit is not withdrawable and is forfeited when the account closes. The API
          does not yet split promotional from withdrawable balance, so if any is held on this
          account it is not shown above — that is a gap to close before this screen can be trusted
          at closure time.
        </p>
      </div>

      <div className="flex w-full gap-2.5">
        <Button variant="danger" icon={<CircleX />} type="button" disabled>
          Close this account
        </Button>
      </div>
      <p className="text-body-xs text-03">
        No deactivation endpoint exists yet, so nothing on this screen can close an account.
      </p>
    </div>
  );
}
