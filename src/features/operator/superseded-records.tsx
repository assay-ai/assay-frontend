"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock, PenLine, Undo2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { shortId } from "@/components/patterns/copy-chip";
import { PageState } from "@/components/patterns/page-state";
import { ReasonChips } from "@/components/patterns/reason-chips";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ArbiterSupersededRecord } from "@/interfaces/operator";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { createSupersededCancelIntent, getArbiterTerms, listSupersededRecords } from "@/services/operator.service";
import { formatMoney } from "@/utils/money";

import {
  ARBITER_NOTE_MIN,
  SUPERSEDED_REASONS,
  arbiterErrorMessage,
  disputeAmount,
  possessive,
  validateSupersededCancelForm,
} from "./arbiter";
import { BLOCK_NOTE_MAX } from "./blocks";
import { chainDisplayName } from "./call-summary";
import { ContractCallAction } from "./contract-call-action";
import { Deadline } from "./deadline";
import { WhatHappens } from "./what-happens";

/**
 * Review R2-6: records of an EARLIER proposal of their case that landed on
 * chain late and still stand. Each covers the same calls as the case's
 * current records, so executing it would charge them twice. Assay never
 * executes it; the arbiter cancels it before its `executableAt`, after
 * which anyone could execute it.
 *
 * Drawn like the disputes above it (operator review 2026-10-16b, P1-7): the
 * provider and amount, the chain by name and the time left to cancel as a
 * deadline; the cancel opens a sheet with what happens, reason chips and a
 * note. The section shows only when there is a record (or the list failed).
 *
 * The cancel is guarded twice: the backend builds it only for an id that is
 * a superseded record standing on that chain (409 otherwise), and the call
 * panel checks the decoded calldata is `cancelSlashBatch([that id])` before
 * it offers to sign.
 */
export function SupersededRecords({
  canCancel,
  providerName,
  onSent,
}: {
  canCancel: boolean;
  providerName: (providerId: string) => string;
  onSent?: () => void;
}) {
  const records = useQuery({
    queryKey: ["operator", "arbiter", "superseded"],
    queryFn: listSupersededRecords,
    retry: 0,
  });
  const [cancelling, setCancelling] = React.useState<ArbiterSupersededRecord | null>(null);

  if (records.isLoading) return null;
  const rows = records.data ?? [];
  if (!records.isError && rows.length === 0) return null;

  return (
    <section aria-labelledby="superseded-records" className="flex w-full flex-col gap-2">
      <h2 id="superseded-records" className="text-label-13 text-02">
        Earlier penalties to cancel{rows.length > 0 ? <span className="tabular-nums text-03"> · {rows.length}</span> : null}
      </h2>
      {records.isError ? (
        <PageState
          kind="error"
          title="Earlier penalties could not be read"
          description="The list of earlier penalties that still stand on chain could not be loaded. The disputes above are not affected."
          onRetry={() => void records.refetch()}
          code={records.error instanceof ApiError ? records.error.code : null}
          details={records.error instanceof Error ? records.error.message : null}
        />
      ) : (
        <>
          <p className="text-body-xs text-03">
            A case was proposed again, but its earlier penalty also landed on chain. Both cover the same calls, so the
            arbiter cancels the earlier one before anyone can execute it.
          </p>
          <ul className="flex w-full flex-col divide-y divide-01 overflow-hidden rounded-xl border border-01 bg-01">
            {rows.map((row) => (
              <SupersededRow
                key={row.requestId}
                row={row}
                providerName={providerName(row.providerId)}
                canCancel={canCancel}
                onCancel={() => setCancelling(row)}
              />
            ))}
          </ul>
        </>
      )}
      {canCancel ? (
        <SupersededCancelSheet
          record={cancelling}
          providerName={cancelling ? providerName(cancelling.providerId) : ""}
          onClose={() => setCancelling(null)}
          onSent={onSent}
        />
      ) : null}
    </section>
  );
}

function SupersededRow({
  row,
  providerName,
  canCancel,
  onCancel,
}: {
  row: ArbiterSupersededRecord;
  providerName: string;
  canCancel: boolean;
  onCancel: () => void;
}) {
  const amount = disputeAmount(row.chainId, row.penaltyAmount);
  return (
    <li className="flex w-full min-w-0 flex-col gap-2 px-4 py-3 tablet:flex-row tablet:items-start tablet:gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-01">
          <Link href={routes.operatorCase(row.proposalId)} className="hit-area min-w-0 font-medium hover:underline">
            {providerName}
            <span className="text-03"> · </span>
            <span className="tabular-nums">{amount ? formatMoney(amount) : "penalty"}</span>
          </Link>
          <Deadline kind="execute" until={row.executableAt} />
        </p>
        <p className="text-body-xs text-03">
          {chainDisplayName(row.chainId)} · an earlier penalty for the same calls: executing it would charge them twice
          {row.chainStatus === "DISPUTED" ? " · disputed by the provider" : ""}
        </p>
      </div>
      {canCancel ? (
        <Button size="sm" variant="secondary" className="touch-target shrink-0 self-start" onClick={onCancel}>
          Cancel it
        </Button>
      ) : null}
    </li>
  );
}

function SupersededCancelSheet({
  record,
  providerName,
  onClose,
  onSent,
}: {
  record: ArbiterSupersededRecord | null;
  providerName: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [ticket, setTicket] = React.useState("");
  const [call, setCall] = React.useState<SlashContractCall | null>(null);
  const [busy, setBusy] = React.useState(false);
  const prepare = useMutation({ mutationFn: createSupersededCancelIntent, onSuccess: setCall });
  // The arbiter of the record's own chain, so the sheet names the key that signs (as rulings do).
  const terms = useQuery({
    queryKey: ["operator", "arbiter", "terms", record?.chainId ?? ""],
    queryFn: () => getArbiterTerms(record!.chainId),
    enabled: record !== null,
    retry: 0,
  });
  const arbiter = terms.data?.arbiter ?? null;

  const id = record?.requestId ?? "";
  React.useEffect(() => {
    setReason("");
    setNote("");
    setTicket("");
    setCall(null);
    prepare.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset per record
  }, [id]);
  // Editing the form after the call was built builds it again with the new reason.
  React.useEffect(() => setCall(null), [reason, note, ticket]);

  const validated = record
    ? validateSupersededCancelForm({ reasonCode: reason, note, ticketRef: ticket }, record)
    : null;
  const missing = !validated || validated.ok ? null : reason === "" ? "Pick a reason." : (Object.values(validated.errors)[0] ?? null);
  const amount = record ? disputeAmount(record.chainId, record.penaltyAmount) : null;

  return (
    <Sheet open={record !== null} onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <SheetContent showCloseButton={!busy} aria-describedby={undefined}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">{`Cancel the earlier ${possessive(providerName)} penalty?`}</SheetTitle>
        </SheetHeader>
        {record ? (
          <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-3">
            <WhatHappens
              lines={[
                {
                  icon: Undo2,
                  text: `${amount ? formatMoney(amount) : "Its amount"} is never taken for these calls a second time: the earlier record is cancelled on ${chainDisplayName(record.chainId)}`,
                },
                { icon: Lock, text: "The case's current penalty is not touched. A cancel can't be undone" },
                {
                  icon: PenLine,
                  text: `Signed by the arbiter key${arbiter ? ` ${shortId(arbiter)}` : ""}, here or as a file for its multi-signer wallet`,
                },
              ]}
            />
            <p className="text-body-13 text-02">
              <Deadline kind="execute" until={record.executableAt} className="text-body-13" />
            </p>
            <ReasonChips
              label="Why"
              options={SUPERSEDED_REASONS}
              value={reason}
              onChange={setReason}
              note={note}
              onNoteChange={setNote}
              noteMin={ARBITER_NOTE_MIN}
              noteMax={BLOCK_NOTE_MAX}
              notePlaceholder="Why this record is cancelled. It is recorded in Activity."
            />
            <Field label="Ticket (optional)" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="INC-123" maxLength={128} />
            {call ? (
              <ContractCallAction
                call={call}
                // Exactly this one id, never the server's label.
                expected={{ contract: "stake", functionName: "cancelSlashBatch", args: [[record.requestId.toLowerCase()]] }}
                signLabel="Sign and send the cancel"
                successTitle="Cancel sent"
                successDescription="The record leaves this list once the chain watcher sees it cancelled."
                afterExport="Open the file in the arbiter's multi-signer wallet and sign it there. The record leaves this list once it lands."
                trackIds={[record.requestId]}
                onBusyChange={setBusy}
                onRetry={() => validated?.ok && prepare.mutate(validated.body)}
                onSigned={() => onSent?.()}
              />
            ) : (
              <div className="flex w-full flex-col gap-1.5">
                <Button
                  type="button"
                  className="self-start"
                  loading={prepare.isPending}
                  disabled={!validated?.ok}
                  onClick={() => validated?.ok && prepare.mutate(validated.body)}
                >
                  Build the cancel to sign
                </Button>
                {missing ? <p className="text-body-xs text-03">{missing}</p> : null}
                {prepare.isError ? (
                  <p className="text-body-13 text-danger-600" role="alert">
                    {arbiterErrorMessage(prepare.error, "ruling").replace(/\s*\([A-Z_]+\)$/, "")}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
