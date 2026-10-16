"use client";

import * as React from "react";

import { UtcTime } from "@/components/patterns/utc-time";

import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import { DASH } from "@/features/g34a/stats";
import type {
  PolicyChange,
  PolicyChangeBinding,
  PolicyDiffChangeType,
  PolicyDiffEntry,
} from "@/interfaces/provider-policy-changes";
import { cn } from "@/utils";
import { shortBindingId } from "@/utils/provider-label";

import { formatDiffValue } from "./format-diff-value";
import { overallImpact, plainImpact } from "./plain-impact";

const bindingStatusTone: Record<string, string> = {
  ACTIVE: "bg-success-10 text-success-700",
  PAUSED: "bg-03 text-02",
  DRAFT: "bg-03 text-02",
  SUSPENDED: "bg-danger-10 text-danger-700",
};

const bindingStatusWord: Record<string, string> = {
  ACTIVE: "Live",
  PAUSED: "Paused",
  DRAFT: "Draft",
  SUSPENDED: "Suspended",
};

function BindingChip({ binding }: { binding: PolicyChangeBinding }) {
  return (
    <span
      title={binding.bindingId}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-01 bg-01 px-[9px] py-1 font-mono text-mono-xs text-02"
    >
      <span
        className={cn(
          "rounded-full px-1.5 py-px text-label-xs font-semibold",
          bindingStatusTone[binding.status] ?? "bg-03 text-02"
        )}
      >
        {bindingStatusWord[binding.status] ?? "Unknown"}
      </span>
      {shortBindingId(binding.bindingId)}
    </span>
  );
}

const changeTypeTone: Record<PolicyDiffChangeType, string> = {
  added: "bg-success-10 text-success-700",
  removed: "bg-danger-10 text-danger-700",
  changed: "bg-warning-10 text-warning-700",
};

interface DiffRow extends TableRowData, PolicyDiffEntry {}

function diffColumns(inForceLabel: string): TableColumn<DiffRow>[] {
  return [
    {
      key: "path",
      header: "PATH",
      cell: (row) => row.path,
      mono: true,
      noTruncate: true,
    },
    {
      key: "changeType",
      header: "CHANGE",
      width: 100,
      cell: (row) => (
        <span
          className={cn(
            "inline-flex items-center rounded-full px-[9px] py-0.5 font-mono text-mono-2xs font-semibold uppercase tracking-[0.5px]",
            changeTypeTone[row.changeType]
          )}
        >
          {row.changeType}
        </span>
      ),
    },
    {
      key: "before",
      header: inForceLabel,
      width: 220,
      mono: true,
      cell: (row) => formatDiffValue(row.before),
    },
    {
      key: "after",
      header: "PENDING",
      width: 220,
      mono: true,
      cell: (row) => formatDiffValue(row.after),
    },
  ];
}

export interface PolicyChangeCardProps {
  change: PolicyChange;
  /** The tool's endpoint host when this provider's binding for it is known, else a fallback built from `toolId`. */
  toolLabel: string;
}

/**
 * One pending `SHADOW` version affecting this provider (the policy change notice, MVP notice
 * slice).
 *
 * Deliberately does not draw: a "run golden set" action, an "auto-pause on
 * version change" toggle, a divergence banner computed on this provider's own
 * traffic ("14 of your last 1,000 verified calls change verdict"), or an
 * objection form. All four are later-phase features, and none has a producer on `GET /providers/me/policy-changes`
 * — see `@/interfaces/provider-policy-changes.ts`.
 *
 * `effectiveDate` is always `null` on the wire (no scheduled-promotion column
 * exists — promotion is an immediate operator action) and is rendered as
 * `DASH` with that reason stated, never derived from `policyId`'s own
 * creation time.
 */
export function PolicyChangeCard({ change, toolLabel }: PolicyChangeCardProps) {
  const inForceLabel =
    change.inForceVersion === null ? "IN FORCE" : `V${change.inForceVersion} (IN FORCE)`;

  const rows: DiffRow[] = change.diff.map((entry, index) => ({
    id: `${entry.path}-${index}`,
    ...entry,
  }));
  const impacts = change.diff.map((entry) => plainImpact(entry).text);
  const uniqueImpacts = impacts.filter((text, index) => impacts.indexOf(text) === index);
  const live = change.bindings.filter((binding) => binding.status === "ACTIVE").length;

  return (
    <Panel className="w-full">
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>{`The checks on ${toolLabel} are changing`}</PanelTitle>
          <PanelDescription className="whitespace-normal">
            {change.effectiveDate ? (
              <>
                Takes effect <UtcTime value={change.effectiveDate} />
              </>
            ) : (
              "No date set yet. It runs in test mode now and changes nothing until Assay switches it on."
            )}
          </PanelDescription>
        </PanelTitles>
      </PanelHeader>

      <PanelBody className="gap-4 p-4 tablet:p-5">
        <p className="text-body-13 text-01">{overallImpact(change.diff)}</p>

        {uniqueImpacts.length > 0 ? (
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body-13 text-02">
            {uniqueImpacts.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        ) : null}

        <p className="text-body-13 text-02">
          {live > 0
            ? `It applies to your live listing${live === 1 ? "" : "s"} of this tool once it takes effect.`
            : "None of your listings of this tool is live, so nothing changes for you yet."}{" "}
          Your price and promise do not change. Watch the Quality tab of the tool after it takes effect.
        </p>

        <details className="group w-full rounded-lg border border-01 bg-02">
          <summary className="cursor-pointer select-none px-3.5 py-2.5 text-label-13 text-02">Technical details</summary>
          <div className="flex w-full flex-col gap-3 border-t border-01 px-3.5 py-3">
            <p className="font-mono text-mono-12 text-03">
              {`Version ${change.pendingVersion} (${change.pendingLifecycle.toLowerCase()}) replaces ${
                change.inForceVersion === null ? "no version in force" : `version ${change.inForceVersion}`
              } · effective date ${change.effectiveDate ?? DASH}`}
            </p>
            <div className="flex w-full flex-wrap items-center gap-2">
              {change.bindings.map((binding) => (
                <BindingChip key={binding.bindingId} binding={binding} />
              ))}
            </div>
            {rows.length > 0 ? (
              <div className="w-full overflow-x-auto">
                <Table
                  columns={diffColumns(inForceLabel)}
                  rows={rows}
                  caption={`Structural diff, in force to pending, ${toolLabel}`}
                />
              </div>
            ) : (
              <p className="text-body-13 text-03">No structural difference between the in-force and pending decision documents.</p>
            )}
          </div>
        </details>
      </PanelBody>
    </Panel>
  );
}
