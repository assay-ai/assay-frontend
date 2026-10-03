"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import { Timeline } from "@/components/ui/timeline";
import { DASH, stampUtc } from "@/features/g34a/stats";
import { claimTypeLabel } from "@/features/provider-disputes/claim-types";
import {
  disputeBadgeVariant,
  disputeOutcomeLine,
  providerDeadlineLine,
} from "@/features/provider-disputes/state";
import { buildDisputeOnlyTimeline, buildRichTimeline } from "@/features/provider-disputes/timeline";
import type { SlashRestorationRow } from "@/interfaces/provider-disputes";
import {
  getDispute,
  getSlashProposalCase,
  getSlashProposalTimeline,
} from "@/services/provider-disputes.service";
import { formatMoney } from "@/utils/money";

/**
 * the dispute case screen — dispute case state, design, route
 * `/provider/disputes/[disputeId]`.
 *
 * ## Two renderings behind one route
 *
 * `GET /disputes/:id` never exposes a platform-side clock or an itemised
 * restoration record for ANY dispute — see `@/interfaces/provider-disputes`'s
 * file header for the confirmed reason (`DisputeService`'s `toDto` mapper is
 * an explicit whitelist that omits `platformDueAt`/`outcome`/`resolutionKind`
 * entirely). The frame's full content — both clocks, the six-row restoration
 * table, the de-minimis banner — only exists for a dispute whose
 * `subjectType` is `SLASH_PROPOSAL` (a value the public `DisputeSubjectType`
 * enum omits but the column actually holds), because only then can this page
 * also read `GET /providers/me/slash-proposals/{subjectId}` and `.../timeline`
 * off the linked proposal.
 *
 * The one real seed dispute is the OTHER shape — a `VERDICT` dispute with no
 * linked proposal — so the reduced rendering below is not a fallback nobody
 * exercises; it is the path this screen's only real data takes. Both paths
 * render only fields the wire actually returned. See
 * `@/features/provider-disputes/timeline` for exactly which fields feed
 * which row.
 *
 * ## The polarity
 *
 * `disputeBadgeVariant`/`disputeOutcomeLine` (`@/features/provider-disputes/
 * state`) state which way `disputes.state` cuts explicitly — `UPHELD` here is
 * a provider WIN, the opposite of the same word on a `slash_proposals` row. This screen never reads a `slash_proposals.status`
 * directly, so that inversion cannot leak in, but the copy says the direction
 * anyway rather than relying on that.
 */

interface RestorationTableRow extends TableRowData {
  label: string;
  value: string;
  status: string;
}

const RESTORATION_STATUS_LABEL: Record<SlashRestorationRow["status"], string> = {
  ON_DECISION: "on decision",
  RESTORED: "restored",
  NOT_APPLICABLE: "not applicable",
};

function RestorationTable({ rows }: { rows: SlashRestorationRow[] }) {
  const columns: TableColumn<RestorationTableRow>[] = [
    { key: "label", header: "What is restored", cell: (r) => r.label, noTruncate: true },
    { key: "value", header: "Value", width: 220, mono: true, noTruncate: true, cell: (r) => r.value },
    { key: "status", header: "Status", width: 120, cell: (r) => r.status },
  ];
  const tableRows: RestorationTableRow[] = rows.map((row, index) => ({
    id: `${row.label}-${index}`,
    label: row.label,
    value: row.value,
    status: RESTORATION_STATUS_LABEL[row.status],
  }));
  return <Table columns={columns} rows={tableRows} caption="Restoration record" />;
}

export default function DisputeCaseStatePage() {
  const params = useParams<{ disputeId: string }>();
  const disputeId = params.disputeId;

  const disputeQuery = useQuery({
    queryKey: ["provider", "disputes", "detail", disputeId],
    queryFn: () => getDispute(disputeId),
    retry: 0,
  });
  const dispute = disputeQuery.data;
  const isSlashProposal = dispute?.subjectType === "SLASH_PROPOSAL";
  const proposalId = isSlashProposal ? dispute!.subjectId : null;

  const caseQuery = useQuery({
    queryKey: ["provider", "slash-proposal-case", proposalId],
    queryFn: () => getSlashProposalCase(proposalId!),
    enabled: proposalId !== null,
    retry: 0,
  });

  const timelineQuery = useQuery({
    queryKey: ["provider", "slash-proposal-timeline", proposalId],
    queryFn: () => getSlashProposalTimeline(proposalId!),
    enabled: proposalId !== null,
    retry: 0,
  });

  if (disputeQuery.isError) {
    return (
      <p className="text-body-13 text-03">
        This dispute could not be loaded. It may belong to another organisation, or the id may not
        exist.
      </p>
    );
  }

  if (!dispute) {
    return <p className="text-body-13 text-03">Loading…</p>;
  }

  const rich = isSlashProposal && caseQuery.data && timelineQuery.data ? caseQuery.data : null;
  const richTimeline = rich && timelineQuery.data ? timelineQuery.data : null;

  const caseLabel = rich
    ? (rich.proposal.windowLabel ?? rich.proposal.bindingLabel)
    : `${dispute.subjectType.toLowerCase().replace(/_/g, " ")} ${dispute.subjectId.slice(0, 8)}…`;

  const timelineEvents =
    rich && richTimeline
      ? buildRichTimeline(richTimeline.events, rich.proposal)
      : buildDisputeOnlyTimeline(dispute);

  const clockNote =
    isSlashProposal && rich
      ? "both clocks are visible, including ours"
      : isSlashProposal
        ? "loading the linked case…"
        : "this dispute has no linked slash-proposal case, so only your own deadline is available";

  return (
    <>
      <header className="flex w-full flex-col items-start gap-2">
        <Button variant="ghost" size="sm" icon={<ArrowLeft aria-hidden="true" />} asChild>
          <Link href="/provider/disputes">Back to disputes</Link>
        </Button>
        <div className="flex w-full flex-wrap items-center gap-2.5">
          <h1 className="truncate text-heading-md text-01">Dispute · {caseLabel}</h1>
          <Badge variant={disputeBadgeVariant(dispute.state)} />
        </div>
        <p className="font-mono text-mono-12 text-03">
          filed {stampUtc(dispute.createdAt)} UTC · {clockNote}
        </p>
        <p className="text-body-sm text-02">
          {claimTypeLabel(dispute.claimType)} — {disputeOutcomeLine(dispute)}
        </p>
        {!isSlashProposal ? (
          <p className="font-mono text-mono-12 text-03">{providerDeadlineLine(dispute)}</p>
        ) : null}
      </header>

      {isSlashProposal && caseQuery.isError ? (
        <Banner
          tone="warning"
          title="The linked slash-proposal case could not be loaded."
          description="Only this dispute's own record is shown below."
        />
      ) : null}

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Case timeline</PanelTitle>
            <PanelDescription>
              {rich
                ? "execution is timelocked until the dispute window closes"
                : "built from this dispute's own record"}
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          <Timeline events={timelineEvents} />
        </PanelBody>
      </Panel>

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>
              {rich ? "If this is overturned — the restoration record" : "Restoration"}
            </PanelTitle>
            <PanelDescription>
              {rich
                ? "an overturn that does not visibly undo the damage is a loss you paid for twice"
                : "what this dispute has restored, if anything"}
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          {rich && richTimeline ? (
            <RestorationTable rows={richTimeline.restoration} />
          ) : (
            <p className="text-body-13 text-02">
              {dispute.restoredAmount
                ? `Restored: ${formatMoney(dispute.restoredAmount)}.`
                : dispute.state === "UPHELD" || dispute.state === "PARTIALLY_UPHELD"
                  ? `Upheld, but no amount was restored — ${DASH}.`
                  : "Nothing restored yet."}
            </p>
          )}
        </PanelBody>
      </Panel>

      {rich ? (
        <Banner
          tone="warning"
          title="A $5 penalty that requires a case view, an evidence browser, a dispute form and a human reviewer costs both sides two orders of magnitude more than its subject."
          description="The screens are correct and the policy is wrong: a de-minimis floor below $25 — record the breach, raise sampling to 100%, do not execute — removes most traffic from this flow permanently."
        />
      ) : null}
    </>
  );
}
