"use client";

import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2, Zap } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { tryProviderTool, type ProviderToolTryResult } from "@/services/provider-tools.service";
import { cn } from "@/utils";

import { providerToolErrorView } from "./model";
import { FIELD_TYPE_LABEL, FIELD_TYPES, fieldProblems, type FieldRow, type FieldType } from "./schema-fields";

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

/** A try run's warnings, in words. */
const WARNING_TEXT: Readonly<Record<string, string>> = {
  CREDENTIAL_DETECTED: "A key or token was in what you pasted. It was used for this one test only, never stored, and not put in the schemas: add it to the listing's Authentication later.",
  OPTION_IGNORED: "Some curl options were ignored; only the method, the URL, headers and a JSON body are used.",
  MISSING_TEST_VALUES: "Some inputs had no example or default, so the test filled them with placeholders. Check the answer makes sense.",
  AUTH_REQUIRED: "Your endpoint asked for authentication. Paste the curl with its header, or add the key under Authentication in step 3.",
  NOT_SUPPORTED: "Part of the document can't be used yet (only GET or POST with a JSON body).",
  NO_JSON_RESPONSE: "The answer was not JSON, so what it returns could not be worked out. Describe the outputs below.",
  EXAMPLE_TOO_LARGE: "The answer was too large to keep as an example; the schema was still worked out from it.",
};

export interface TryOutcome {
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  examples: Record<string, unknown>[];
}

/** "Paste a curl or OpenAPI and try it": one real call; nothing is stored. */
export function TryPanel({ onUse, disabled = false, compact = false }: { onUse: (outcome: TryOutcome) => void; disabled?: boolean; compact?: boolean }) {
  const [text, setText] = React.useState("");
  const [result, setResult] = React.useState<ProviderToolTryResult | null>(null);
  const run = useMutation({
    mutationFn: () => {
      const value = text.trim();
      return tryProviderTool(/^curl\s/i.test(value) ? { curl: value } : { openapi: value });
    },
    onSuccess: setResult,
  });
  const upstream = result?.upstream ?? null;
  return (
    <section className={cn("flex w-full flex-col gap-2 rounded-lg border border-primary-20 bg-primary-10 p-3.5", compact && "bg-02")} data-testid="try-panel">
      <p className="text-label-13 text-01">Fill this in from your endpoint</p>
      <p className="text-body-13 text-02">Paste a curl command or an OpenAPI document and try it: one real call, and its answer fills the inputs, the outputs and an example. Nothing is stored.</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={compact ? 3 : 4} disabled={disabled} spellCheck={false} placeholder={"curl 'https://api.example.com/v1/search?q=rain'"} aria-label="A curl command or an OpenAPI document" className="font-mono text-mono-12" />
      <Button className="self-start" variant="secondary" icon={<Zap aria-hidden="true" />} loading={run.isPending} disabled={disabled || text.trim().length < 8} onClick={() => run.mutate()}>
        Try it
      </Button>
      {run.isError ? (
        <p role="alert" className="text-body-13 text-danger-700">
          {providerToolErrorView(run.error).text}
        </p>
      ) : null}
      {result ? (
        <div className="flex flex-col gap-1.5 rounded-md bg-01 p-3" data-testid="try-result">
          <p className={cn("text-label-13", result.passed ? "text-success-700" : "text-warning-700")}>
            {!result.ran
              ? "It could not be called."
              : upstream?.transportError
                ? `No answer: ${upstream.transportError.kind.toLowerCase().replace(/_/g, " ")}.`
                : `${result.request.method} ${result.request.url} answered ${upstream?.status ?? "?"} in ${upstream?.latencyMs ?? "?"} ms.`}
          </p>
          {result.warnings.length > 0 ? (
            <ul className="list-disc pl-4 text-body-13 text-02">
              {result.warnings.map((w) => (
                <li key={w.code}>{WARNING_TEXT[w.code] ?? w.detail}</li>
              ))}
            </ul>
          ) : null}
          <Button className="self-start" disabled={disabled} onClick={() => onUse({ inputSchema: result.inferred.inputSchema, outputSchema: result.inferred.outputSchema, examples: result.inferred.examples })}>
            Use these inputs, outputs and example
          </Button>
        </div>
      ) : null}
    </section>
  );
}
