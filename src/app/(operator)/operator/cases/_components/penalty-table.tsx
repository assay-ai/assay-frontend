"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { LocalTime } from "@/components/patterns/local-time";
import { StatusChip } from "@/components/patterns/status-chip";
import { penaltyChip, penaltyNext, type PenaltyRow } from "@/features/operator/penalty-list";
import { routes } from "@/libs/routes";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

import { Deadline } from "./deadline";

/**
 * The Penalties table: provider, amount, status, what happens next, proposed.
 * The whole row is the link (no buttons in rows). From `tablet` a real
 * table, amounts right-aligned on the decimal; below it each row is a
 * two-line card.
 */
export function PenaltyTable({
  rows,
  waitingBy,
  now,
}: {
  rows: readonly PenaltyRow[];
  /** A request waiting for approval on a penalty, by penalty id: it is what happens next. */
  waitingBy: ReadonlyMap<string, string>;
  now: number;
}) {
  return (
    <>
      <div className="hidden w-full overflow-hidden rounded-xl border border-01 bg-01 tablet:block">
        <table className="w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="border-b border-01 text-label-13 text-03">
              <th scope="col" className="px-4 py-2.5 font-normal">
                Provider
              </th>
              <th scope="col" className="w-[112px] px-4 py-2.5 text-right font-normal">
                Amount
              </th>
              <th scope="col" className="w-[200px] px-4 py-2.5 font-normal">
                Status
              </th>
              <th scope="col" className="w-[30%] px-4 py-2.5 font-normal">
                Next
              </th>
              <th scope="col" className="w-[132px] px-4 py-2.5 font-normal">
                Proposed
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="relative border-b border-01 last:border-b-0 hover:bg-02 has-[a:focus-visible]:bg-02">
                <td className="px-4 py-2.5 align-middle">
                  <Link
                    href={routes.operatorCase(row.id)}
                    className="flex min-w-0 flex-col outline-none after:absolute after:inset-0 after:content-['']"
                  >
                    <span className="truncate text-label-13 text-01">{row.providerName}</span>
                    {row.toolName ? <span className="truncate text-body-xs text-03">{row.toolName}</span> : null}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-right align-middle text-body-13 font-medium tabular-nums text-01">
                  {row.amount ? formatMoney(row.amount) : "—"}
                </td>
                <td className="px-4 py-2.5 align-middle">
                  <Chip row={row} now={now} />
                </td>
                <td className="px-4 py-2.5 align-middle">
                  <Next row={row} waiting={waitingBy.get(row.id) ?? null} now={now} />
                </td>
                <td className="px-4 py-2.5 align-middle text-body-13 text-02">
                  {row.proposedAt ? <LocalTime value={row.proposedAt} dateOnly /> : <span className="text-03">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex w-full flex-col overflow-hidden rounded-xl border border-01 bg-01 tablet:hidden">
        {rows.map((row) => (
          <li key={row.id} className="border-b border-01 last:border-b-0">
            <Link href={routes.operatorCase(row.id)} className="flex w-full min-w-0 items-center gap-3 px-4 py-3 hover:bg-02">
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="truncate text-label-13 text-01">{row.providerName}</span>
                  <span className="shrink-0 text-body-13 font-medium tabular-nums text-01">{row.amount ? formatMoney(row.amount) : "—"}</span>
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <Chip row={row} now={now} />
                  <Next row={row} waiting={waitingBy.get(row.id) ?? null} now={now} hideNone />
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function Chip({ row, now }: { row: PenaltyRow; now: number }) {
  const chip = penaltyChip(row, now);
  return <StatusChip status={chip.status} detail={chip.detail} />;
}

function Next({ row, waiting, now, hideNone = false }: { row: PenaltyRow; waiting: string | null; now: number; hideNone?: boolean }) {
  if (waiting) return <span className="text-body-xs text-02">{waiting}</span>;
  const next = penaltyNext(row, now);
  if (next.kind === "dispute") return <Deadline kind="dispute" until={next.until} from={next.from} />;
  if (next.kind === "none") return hideNone ? null : <span className="text-body-xs text-03">—</span>;
  return (
    <span
      title={next.until ? new Date(next.until).toISOString().slice(0, 16).replace("T", " ") + " UTC" : undefined}
      className={cn("text-body-xs tabular-nums", next.urgent ? "text-danger-600" : "text-02")}
    >
      {next.text}
    </span>
  );
}
