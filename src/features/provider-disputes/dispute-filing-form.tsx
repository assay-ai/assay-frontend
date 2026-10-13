"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import Link from "next/link";
import * as React from "react";

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
import { Radio } from "@/components/ui/radio";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { DASH, count, percent, stampUtc } from "@/features/g34a/stats";
import { CLAIM_TYPE_ORDER, CLAIM_TYPE_SENTENCE } from "@/features/provider-disputes/claim-types";
import type {
  SlashAttributionRow,
  SlashDisputeClaimType,
  SlashProposalCase,
} from "@/interfaces/provider-disputes";
import { ApiError } from "@/libs/ApiClient";
import { fileSlashDispute, getSlashProposalCase } from "@/services/provider-disputes.service";
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";

/**
 * Dispute filing.
 *
 * Exported as a standalone component (not just the route at
 * `/provider/disputes/new`) so the slash-proposal case screen can
 * mount it inline instead of navigating away. Every claim type pre-populates
 * from the evidence.
 *
 * ## What this form does NOT do, and why
 *
 * - **No pre-filing platform deadline.** The design's header shows "we respond
 *   by 2026-08-12 09:14 UTC, before the penalty could execute" — but
 *   `SlashProposalClocksDto.platformDecisionDueAt` is null until AFTER a
 *   dispute is filed (`ArbitrationService.fileDispute` sets it at file time;
 *   `computeClocks` before that reads a null column). Computing a projected
 *   value client-side would mean hard-coding the platform's response-window
 *   constant here, which is not exposed by any endpoint this screen reads.
 *   This form shows only the provider's own running deadline
 *   (`clocks.respondByAt`), which is real before filing, and omits the
 *   platform-side promise until it exists.
 * - **No attachment upload, and the design's own footer sentence is trimmed.**
 *   The design draws `[+ file]` and the caption "Attachments are supported.
 *   Filing does not affect routing or tier." — but `FileSlashDisputeBodyDto`
 *   has no field for a file of any kind. Rendering a button with nowhere to
 *   send its payload, or a sentence promising a capability that does not
 *   exist, would be the exact "MVP UI must not promise cut features" failure
 *   this app has hit before. Only the true half of that
 *   sentence — "Filing does not affect routing or tier", also asserted by the
 *   controller's own docstring — is rendered; where the design and the
 *   backend disagree, the backend wins.
 * - **No per-call "review selection" picker.** The design's "Affected calls
 *   selected 71 [review selection]" implies a checklist of individual call
 *   ids. The real ids exist (`GET /providers/me/sla-windows/{id}/evidence`'s
 *   `SlaWindowEvidenceCall.intentId`), but joining that fetch to this form
 *   could not be exercised against a real fixture — the seed database has
 *   zero `slash_proposals` rows, so there is no window to fetch evidence for
 *   and verify the join against. This form submits `selectedCallIds: []`
 *   (the DTO's own default) and shows the real *count* wherever the case data
 *   has one, never a fabricated id list. Wiring the picker is left until a real
 *   proposal fixture exists to verify it against.
 *
 * ## The claim list
 *
 * The seven options and their sentences are hardcoded copy — verbatim from
 * both the design and assay-backend `src/modules/slash/domain/arbitration.ts`'s
 * `DisputeClaimType` docstrings, which that file's own comment says ARE the
 * copy. `suggestedClaim` (evidence-derived, never provider-derived per the
 * doc's own "we would rather find our own defect than win a dispute about
 * it") pre-selects a radio but never locks it — an adjudicator, not this
 * form, decides what a claim is worth.
 */

export interface DisputeFilingFormProps {
  proposalId: string;
  /** Called with the updated case (its `proposal.disputeId` is now set) once filing succeeds. */
  onFiled?: (result: SlashProposalCase) => void;
  onCancel?: () => void;
  className?: string;
}

function shareLine(row: SlashAttributionRow): string {
  return row.share !== null ? `${row.key} = ${percent(row.share, 0)} of failures` : `${row.key} = ${count(row.count)} failures`;
}

/** The subtext under each radio — real fields only, nothing computed that the case data cannot support. */
function claimHint(claim: SlashDisputeClaimType, data: SlashProposalCase): string | null {
  switch (claim) {
    case "PLATFORM_MAPPING_CHANGE": {
      const overlay = data.changeOverlay;
      if (!overlay) return null;
      const total = overlay.failuresBefore + overlay.failuresAfter;
      return `${count(overlay.failuresAfter)} of ${count(total)} occurred after binding ${overlay.fromVersion} → ${overlay.toVersion}`;
    }
    case "AGENT_GRIEFING": {
      const top = data.failuresByAgent[0];
      return top ? shareLine(top) : null;
    }
    case "INSUFFICIENT_SAMPLE":
      return data.evidenceVerdictCount > 0
        ? `${count(data.evidenceVerdictCount)} verified calls in the evidence pack`
        : null;
    default:
      return null;
  }
}

interface ChangeOverlayRow extends TableRowData {
  label: string;
  verified: string;
  failures: string;
  rate: string;
}

function ChangeOverlayPanel({ data }: { data: SlashProposalCase }) {
  const overlay = data.changeOverlay;
  if (!overlay) return null;

  const columns: TableColumn<ChangeOverlayRow>[] = [
    { key: "label", header: "", cell: (r) => r.label },
    { key: "verified", header: "Verified calls", width: 130, mono: true, cell: (r) => r.verified },
    { key: "failures", header: "Failures", width: 100, mono: true, cell: (r) => r.failures },
    { key: "rate", header: "Rate", width: 90, mono: true, cell: (r) => r.rate },
  ];

  const rows: ChangeOverlayRow[] = [
    {
      id: "before",
      label: `Before ${overlay.fromVersion} → ${overlay.toVersion} at ${stampUtc(overlay.changedAt)}`,
      verified: count(overlay.verifiedBefore),
      failures: count(overlay.failuresBefore),
      rate: percent(overlay.rateBefore, 1),
    },
    {
      id: "after",
      label: "After the change",
      verified: count(overlay.verifiedAfter),
      failures: count(overlay.failuresAfter),
      rate: percent(overlay.rateAfter, 1),
    },
  ];

  return (
    <Panel className="w-full">
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>Platform mapping change — we prefilled the evidence</PanelTitle>
          <PanelDescription>
            we would rather find our own defect than win a dispute about it
          </PanelDescription>
        </PanelTitles>
      </PanelHeader>
      <PanelBody className="gap-3 p-4 tablet:p-5">
        <Table columns={columns} rows={rows} caption="Failures before and after the binding change" />
        <p className="text-body-xs text-03">
          Affected calls identified: {count(overlay.failuresAfter)}. Selecting individual calls is not available yet — the
          full list is in the report.
        </p>
      </PanelBody>
    </Panel>
  );
}

interface AgentRow extends TableRowData {
  agent: string;
  failures: string;
  share: string;
}

function AgentConcentrationPanel({ data }: { data: SlashProposalCase }) {
  if (data.failuresByAgent.length === 0) return null;

  const columns: TableColumn<AgentRow>[] = [
    { key: "agent", header: "Agent", cell: (r) => r.agent },
    { key: "failures", header: "Failures", width: 100, mono: true, cell: (r) => r.failures },
    { key: "share", header: "Share", width: 90, mono: true, cell: (r) => r.share },
  ];
  const rows: AgentRow[] = data.failuresByAgent.map((row) => ({
    id: row.key,
    agent: row.key,
    failures: count(row.count),
    share: row.share !== null ? percent(row.share, 0) : DASH,
  }));

  return (
    <Panel className="w-full">
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>Agent concentration — we prefilled the evidence</PanelTitle>
          <PanelDescription>failures by agent, this window</PanelDescription>
        </PanelTitles>
      </PanelHeader>
      <PanelBody className="p-4 tablet:p-5">
        <Table columns={columns} rows={rows} caption="Failures by agent" />
      </PanelBody>
    </Panel>
  );
}

export function DisputeFilingForm({
  proposalId,
  onFiled,
  onCancel,
  className,
}: DisputeFilingFormProps) {
  const [claim, setClaim] = React.useState<SlashDisputeClaimType | null>(null);
  const [claimTouched, setClaimTouched] = React.useState(false);
  const [reason, setReason] = React.useState("");

  const caseQuery = useQuery({
    queryKey: ["provider", "slash-proposal-case", proposalId],
    queryFn: () => getSlashProposalCase(proposalId),
    retry: 0,
  });
  const data = caseQuery.data;

  React.useEffect(() => {
    if (data?.suggestedClaim && !claimTouched) {
      setClaim(data.suggestedClaim);
    }
  }, [data?.suggestedClaim, claimTouched]);

  const file = useMutation({
    mutationFn: () => {
      if (!claim) throw new Error("no claim selected");
      const trimmedReason = reason.trim();
      // The wire requires 1–2048 chars; the design's own label calls this
      // field optional. Rather than block filing on a technicality the UI
      // never told the provider about, an empty box submits the claim's own
      // sentence — which is exactly what the provider asserted by picking
      // the radio, and is never blank.
      const finalReason = trimmedReason.length > 0 ? trimmedReason : CLAIM_TYPE_SENTENCE[claim];
      return fileSlashDispute(proposalId, {
        claimType: claim,
        reason: finalReason,
        selectedCallIds: [],
      });
    },
    onSuccess: (result) => {
      toast.success("Dispute filed. Filing does not affect your routing or tier.");
      onFiled?.(result);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? `${e.code} · ${e.message}` : "The dispute could not be filed.");
    },
  });

  if (caseQuery.isLoading) {
    return <p className="text-body-13 text-03">Loading…</p>;
  }

  if (caseQuery.isError || !data) {
    return (
      <Banner
        tone="danger"
        title="This proposal could not be loaded."
        description="It may belong to another organisation, may not exist, or may already have a dispute on file."
      />
    );
  }

  const { proposal } = data;

  // A proposal that already carries a dispute cannot take a second one; point at the one on file.
  if (proposal.status === "DISPUTED" || proposal.disputeId) {
    return (
      <Banner
        tone="warning"
        title="This proposal already has a dispute on file."
        description={
          proposal.disputeId ? (
            <>
              A second dispute cannot be filed.{" "}
              <Link href={`/provider/disputes/${proposal.disputeId}`} className="underline">
                Open the existing dispute
              </Link>
              .
            </>
          ) : (
            "A second dispute cannot be filed. Find it under Disputes."
          )
        }
      />
    );
  }

  const respondBy = proposal.clocks.respondByAt;

  return (
    <div className={className ?? "flex w-full flex-col gap-4"}>
      <header className="flex w-full flex-col items-stretch gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="truncate text-heading-md text-01">
            Dispute · {proposal.windowLabel ?? proposal.bindingLabel} · proposed penalty{" "}
            {formatMoney(proposal.penaltyAmount)}
          </h1>
          <p className="text-body-xs text-03">
            Filing is free and does not affect your routing or tier.
            {respondBy ? ` You must respond by ${stampUtc(respondBy)} UTC.` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 tablet:shrink-0">
          <Button variant="secondary" onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button
            icon={<Send aria-hidden="true" />}
            loading={file.isPending}
            disabled={!claim}
            onClick={() => file.mutate()}
            type="button"
          >
            File dispute
          </Button>
        </div>
      </header>

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>What are you claiming?</PanelTitle>
            <PanelDescription>
              a structured claim, not an essay — each type pre-populates from the evidence
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-0 p-4 tablet:p-5">
          {CLAIM_TYPE_ORDER.map((option, index) => {
            const hint = claimHint(option, data);
            return (
              // A plain `<div>`, not a second `<label>` — `Radio` already
              // renders its own internal `<label>` around the dot and its
              // text, and nesting labels is invalid HTML (and double-fires
              // the click). The hint line below sits outside that inner
              // label on purpose: it is not itself clickable.
              <div
                key={option}
                className={`flex w-full flex-col gap-1 py-3.5 ${
                  index > 0 ? "border-t border-01" : ""
                }`}
              >
                <Radio
                  name="claimType"
                  checked={claim === option}
                  onChange={() => {
                    setClaim(option);
                    setClaimTouched(true);
                  }}
                  label={
                    <span className="text-body-sm font-medium text-01">
                      {CLAIM_TYPE_SENTENCE[option]}
                    </span>
                  }
                />
                {hint ? <span className="pl-[26px] text-mono-12 font-mono text-03">{hint}</span> : null}
              </div>
            );
          })}
        </PanelBody>
      </Panel>

      {claim === "PLATFORM_MAPPING_CHANGE" ? <ChangeOverlayPanel data={data} /> : null}
      {claim === "AGENT_GRIEFING" ? <AgentConcentrationPanel data={data} /> : null}

      <Panel className="w-full">
        <PanelBody className="gap-2 p-4 tablet:p-5">
          <label className="flex w-full flex-col gap-1.5">
            <span className="text-label-13 text-01">Anything to add (optional)</span>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="What happened, in your own words."
            />
          </label>
          <p className="text-body-xs text-03">
            Filing does not affect routing or tier.
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}
