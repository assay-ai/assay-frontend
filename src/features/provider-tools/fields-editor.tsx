"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Zap } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { tryProviderTool, type ProviderToolTryResult } from "@/services/provider-tools.service";
import { cn } from "@/utils";

import { FIELD_TYPE_LABEL, FIELD_TYPES, fieldProblems, schemaFieldNames, type FieldRow, type FieldType } from "./schema-fields";
import { headerNamesLine, isCurl, looksLikeCredential, resultLine, tryBody, tryErrorView, warningText } from "./try-run";

/**
 * Two helpers of "Inputs & outputs" (and of step 1): the field editor — one
 * row per field, name, type, required and what it means — and "Paste a curl
 * or OpenAPI and try it", one real call whose answer fills the schemas and an
 * example. The JSON of both schemas stays one click away for anything the
 * rows can't express.
 */

export function FieldsEditor({
  label,
  rows,
  onChange,
  disabled,
  requiredHint,
}: {
  label: string;
  rows: FieldRow[];
  onChange: (rows: FieldRow[]) => void;
  disabled: boolean;
  requiredHint: string;
}) {
  const id = React.useId();
  const problems = fieldProblems(rows);
  const set = (i: number, patch: Partial<FieldRow>) => onChange(rows.map((row, at) => (at === i ? { ...row, ...patch } : row)));
  return (
    <fieldset className="flex w-full flex-col gap-2" data-testid="fields-editor">
      <legend className="pb-1 text-label-13 text-01">{label}</legend>
      {rows.length === 0 ? <p className="text-body-13 text-03">No fields yet.</p> : null}
      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <li key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-01 p-2.5 tablet:grid-cols-[minmax(0,1fr)_150px_auto_minmax(0,1.6fr)_auto] tablet:items-center">
            <input
              aria-label={`Field ${i + 1} name`}
              value={row.name}
              onChange={(e) => set(i, { name: e.target.value })}
              disabled={disabled}
              placeholder="name"
              spellCheck={false}
              className="min-h-10 rounded-md border border-02 bg-01 px-3 font-mono text-mono-12 text-01"
            />
            <select
              aria-label={`Field ${i + 1} type`}
              value={row.type}
              onChange={(e) => set(i, { type: e.target.value as FieldType })}
              disabled={disabled}
              className="min-h-10 rounded-md border border-02 bg-01 px-2 text-body-13 text-01"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {FIELD_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <label className="flex min-h-10 items-center gap-2 text-body-13 text-01">
              <input type="checkbox" checked={row.required} disabled={disabled} onChange={(e) => set(i, { required: e.target.checked })} className="accent-primary-500" />
              Required
            </label>
            <input
              aria-label={`Field ${i + 1} description`}
              value={row.description}
              onChange={(e) => set(i, { description: e.target.value })}
              disabled={disabled}
              placeholder="What it means, for the agent"
              className="min-h-10 rounded-md border border-02 bg-01 px-3 text-body-13 text-01"
            />
            <Button variant="ghost" size="sm" className="touch-target self-start tablet:self-auto" disabled={disabled} onClick={() => onChange(rows.filter((_, at) => at !== i))} aria-label={`Remove field ${row.name || i + 1}`}>
              <Trash2 aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      <p id={`${id}-hint`} className="text-body-xs text-03">
        {requiredHint}
      </p>
      {problems.length > 0 ? (
        <ul className="list-disc pl-4 text-body-xs text-danger-600">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      <Button variant="secondary" size="sm" className="touch-target self-start" disabled={disabled} icon={<Plus aria-hidden="true" />} onClick={() => onChange([...rows, { name: "", type: "string", required: true, description: "" }])}>
        Add a field
      </Button>
    </fieldset>
  );
}

export interface TryOutcome {
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  examples: Record<string, unknown>[];
}

/** "Paste a curl or OpenAPI and try it": one real call; nothing is stored. */
export function TryPanel({ onUse, disabled = false, compact = false }: { onUse: (outcome: TryOutcome) => void; disabled?: boolean; compact?: boolean }) {
  const [text, setText] = React.useState("");
  const [operationId, setOperationId] = React.useState("");
  const [headers, setHeaders] = React.useState("");
  const [result, setResult] = React.useState<ProviderToolTryResult | null>(null);
  const [applied, setApplied] = React.useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => tryProviderTool(tryBody(text, { operationId: operationId || null, headers })),
    onSuccess: (r) => {
      setResult(r);
      setApplied(null);
    },
  });
  const error = run.isError ? tryErrorView(run.error) : null;
  const openapi = text.trim() !== "" && !isCurl(text);
  const authAsked = Boolean(result?.warnings.some((w) => w.code === "AUTH_REQUIRED"));
  const showHeaders = openapi && (authAsked || headers !== "");
  return (
    <section className={cn("flex w-full flex-col gap-2 rounded-lg border border-primary-20 bg-primary-10 p-3.5", compact && "bg-02")} data-testid="try-panel">
      <p className="text-label-13 text-01">Fill this in from your endpoint</p>
      <p className="text-body-13 text-02">Paste a curl command or an OpenAPI document and try it: one real call, and its answer fills the inputs, the outputs and an example. Nothing is stored.</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={compact ? 3 : 4} disabled={disabled} spellCheck={false} placeholder={"curl 'https://api.example.com/v1/search?q=rain'"} aria-label="A curl command or an OpenAPI document" className="font-mono text-mono-12" />
      {showHeaders ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-label-13 text-01">Headers for this test (one per line, “Name: value”)</span>
          <Textarea value={headers} onChange={(e) => setHeaders(e.target.value)} rows={2} disabled={disabled} spellCheck={false} autoComplete="off" placeholder="Authorization: Bearer …" className="font-mono text-mono-12" data-testid="try-headers" />
          <span className="text-body-xs text-03">Sent with this one test only, never stored or shown back. Add the credential to the listing&apos;s Authentication later.</span>
        </label>
      ) : null}
      <Button className="self-start" variant="secondary" icon={<Zap aria-hidden="true" />} loading={run.isPending} disabled={disabled || text.trim().length < 8} onClick={() => run.mutate()}>
        Try it
      </Button>
      {error ? (
        <div role="alert" className="flex flex-col gap-1.5 text-body-13 text-danger-700" data-testid="try-error">
          <p>{error.text}</p>
          {error.problems.length > 0 ? (
            <ul className="list-disc pl-4">
              {error.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ) : null}
          {error.operations.length > 0 ? (
            <div className="flex flex-col gap-2 text-01 tablet:flex-row tablet:items-center">
              <select aria-label="The operation to try" value={operationId} onChange={(e) => setOperationId(e.target.value)} className="min-h-10 rounded-md border border-02 bg-01 px-2 font-mono text-mono-12" data-testid="try-operations">
                <option value="">Pick an operation</option>
                {error.operations.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <Button variant="secondary" size="sm" className="touch-target self-start" loading={run.isPending} disabled={!operationId} onClick={() => run.mutate()}>
                Try this operation
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {result ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-01 p-3" data-testid="try-result">
          <p className={cn("text-label-13", result.passed ? "text-success-700" : "text-warning-700")}>{resultLine(result)}</p>
          {headerNamesLine(result) ? <p className="text-body-xs text-03">{headerNamesLine(result)}</p> : null}
          {result.warnings.length > 0 ? (
            <ul className="list-disc pl-4 text-body-13 text-02">
              {result.warnings.map((w, i) => (
                <li key={i}>{warningText(w)}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-body-13 text-02" data-testid="try-found">
            Found inputs: {schemaFieldNames(result.inferred.inputSchema).join(", ") || "none"} · outputs: {result.inferred.outputSchema ? schemaFieldNames(result.inferred.outputSchema).join(", ") || "none" : "not worked out"} · {result.inferred.examples.length} example{result.inferred.examples.length === 1 ? "" : "s"}
          </p>
          {applied ? (
            <p role="status" className="text-label-13 text-success-700" data-testid="try-applied">
              {applied}
            </p>
          ) : (
            <Button
              className="self-start"
              disabled={disabled}
              onClick={() => {
                onUse({ inputSchema: result.inferred.inputSchema, outputSchema: result.inferred.outputSchema, examples: result.inferred.examples });
                // A pasted credential is not kept on the page once its test is done.
                const cleared = looksLikeCredential(text) || headers !== "";
                if (cleared) {
                  setText("");
                  setHeaders("");
                }
                setApplied(`Applied. Fields the answer did not always have are marked optional; check the descriptions below.${cleared ? " What you pasted was cleared, as it held a credential." : ""}`);
              }}
            >
              Use these inputs, outputs and example
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
