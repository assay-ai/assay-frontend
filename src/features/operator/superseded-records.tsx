"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { shortRequestId } from "@/features/chain-slashes/format";
import { DASH, stampUtc } from "@/features/g34a/stats";
import type { ArbiterSupersededRecord } from "@/interfaces/operator";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { routes } from "@/libs/routes";
import { createSupersededCancelIntent, listSupersededRecords } from "@/services/operator.service";

import {
  ARBITER_NOTE_MIN,
  SUPERSEDED_REASON_SUGGESTIONS,
  arbiterErrorMessage,
  validateSupersededCancelForm,
  type ArbiterFormErrors,
  type SupersededCancelFormInput,
} from "./arbiter";
import { ContractCallAction } from "./contract-call-action";

const EMPTY: SupersededCancelFormInput = {
  reasonCode: SUPERSEDED_REASON_SUGGESTIONS[0],
  note: "",
  ticketRef: "",
};

/**
 * Review R2-6: records of an EARLIER proposal of their case that landed on
 * chain late and still stand. Each covers the same calls as the case's
 * current records, so executing it would charge them twice. Assay never
 * executes it; the arbiter cancels it here before its `executableAt`, after
 * which anyone could execute it.
 *
 * The cancel is guarded twice: the backend builds it only for an id that is
 * a superseded record standing on that chain (409 otherwise), and the call
 * panel checks the decoded calldata is `cancelSlashBatch([that id])` before
 * it offers to sign.
 */
export function SupersededRecords({ canCancel, onSent }: { canCancel: boolean; onSent?: () => void }) {
  const records = useQuery({
    queryKey: ["operator", "arbiter", "superseded"],
    queryFn: listSupersededRecords,
    retry: 0,
  });

  if (records.isLoading) return <p className="text-body-xs text-03">Reading superseded records…</p>;
  if (records.isError) {
    return (
      <p className="text-body-13 text-danger-600" role="alert">
        {arbiterErrorMessage(records.error, "disputes")}
      </p>
    );
  }
  const rows = records.data ?? [];
  if (rows.length === 0) {
    return <p className="text-body-13 text-02">No record of an earlier proposal stands on chain.</p>;
  }
  return (
    <ul className="flex w-full flex-col gap-3">
      {rows.map((row) => (
        <SupersededRow key={row.requestId} row={row} canCancel={canCancel} onSent={onSent} />
      ))}
    </ul>
  );
}

function SupersededRow({
  row,
  canCancel,
  onSent,
}: {
  row: ArbiterSupersededRecord;
  canCancel: boolean;
  onSent?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<SupersededCancelFormInput>(EMPTY);
  const [errors, setErrors] = React.useState<ArbiterFormErrors<keyof SupersededCancelFormInput>>({});
  const [call, setCall] = React.useState<SlashContractCall | null>(null);
  const prepare = useMutation({
    mutationFn: createSupersededCancelIntent,
    onSuccess: (built) => setCall(built),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setCall(null);
    const result = validateSupersededCancelForm(form, row);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    prepare.mutate(result.body);
  }

  return (
    <li className="flex w-full min-w-0 flex-col gap-2 rounded-lg border border-warning-20 bg-warning-10 p-3">
      <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="font-mono text-mono-13 text-01" title={row.requestId}>
          {shortRequestId(row.requestId)}
        </span>
        <span className="text-body-xs text-warning-700">
          {`superseded: epoch ${row.recordEpoch}, the case is at epoch ${row.caseEpoch} · ${row.chainStatus.toLowerCase()} on chain`}
        </span>
        <Link href={routes.operatorCase(row.proposalId)} className="ml-auto text-label-13 text-primary-600 hover:underline">
          Open case
        </Link>
      </div>
      <p className="text-body-13 text-02">
        {`Executable by anyone from ${row.executableAt ? `${stampUtc(row.executableAt)} UTC` : DASH}. Provider ${row.providerId} · ${row.chainId}.`}
      </p>
      {canCancel && !open ? (
        <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => setOpen(true)}>
          Prepare the arbiter&apos;s cancel
        </Button>
      ) : null}
      {canCancel && open ? (
        <form onSubmit={submit} className="flex w-full max-w-[720px] flex-col gap-3" noValidate>
          <Field
            label="Reason code"
            value={form.reasonCode}
            onChange={(e) => setForm((f) => ({ ...f, reasonCode: e.target.value }))}
            autoComplete="off"
            spellCheck={false}
            error={errors.reasonCode}
            hint={`e.g. ${SUPERSEDED_REASON_SUGGESTIONS.join(", ")}.`}
          />
          <Field
            label="Internal note"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Why this record is cancelled. Written to the override register."
            autoComplete="off"
            error={errors.note}
            hint={`At least ${ARBITER_NOTE_MIN} characters.`}
          />
          <Field
            label="Ticket (optional)"
            value={form.ticketRef}
            onChange={(e) => setForm((f) => ({ ...f, ticketRef: e.target.value }))}
            placeholder="INC-123"
            autoComplete="off"
            error={errors.ticketRef}
          />
          {prepare.isError ? (
            <p className="text-body-13 text-danger-600" role="alert">
              {arbiterErrorMessage(prepare.error, "ruling")}
            </p>
          ) : null}
          <Button type="submit" className="self-start" loading={prepare.isPending}>
            Prepare cancel of this record
          </Button>
        </form>
      ) : null}
      {call ? (
        <ContractCallAction
          call={call}
          // Exactly this one id, never the server's label.
          expected={{ contract: "stake", functionName: "cancelSlashBatch", args: [[row.requestId.toLowerCase()]] }}
          signLabel="Sign and send the cancel"
          successTitle="Cancel sent"
          successDescription="The record leaves this list once the chain watcher sees it cancelled."
          afterExport="Open the file in the arbiter's multi-signer wallet and sign it there. The record leaves this list once it lands."
          onSigned={() => onSent?.()}
        />
      ) : null}
    </li>
  );
}
