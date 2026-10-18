"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { schemaFields } from "@/features/contracts/diff";
import { BUMP_LABEL, bumpEffect, bumpTitle, changeText } from "@/features/contracts/text";
import type { ContractChange, ContractSchema, VersionBump } from "@/interfaces/contracts";
import { cn } from "@/utils";

/**
 * The fields of a contract draft, shared by the operator's standard-tool
 * editor and the provider's "Publish your own API": a labelled text block,
 * a JSON Schema block with its optional-field ticks, and the live preview of
 * what publishing would do (the semver bump and the problems to fix).
 */

const BUMP_TONE: Record<VersionBump, string> = {
  PATCH: "bg-03 text-02",
  MINOR: "bg-primary-10 text-primary-700",
  MAJOR: "bg-warning-10 text-warning-700",
};

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-label-xs", className)}>{children}</span>;
}

/** What `PreviewPanel` draws; the operator editor's `LivePreview` has this shape. */
export interface ContractPreview {
  baseSemver: string | null;
  bump: VersionBump | null;
  nextSemver: string;
  changes: readonly ContractChange[];
  problems: string[];
  firstVersion: boolean;
}

export function TextBlock({
  label,
  value,
  onChange,
  disabled,
  rows,
  hint,
  error,
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  rows: number;
  hint?: string;
  error?: string;
  mono?: boolean;
}) {
  const id = React.useId();
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-label-13 text-01">
        {label}
      </label>
      <Textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={rows}
        spellCheck={!mono}
        wrap={mono ? "off" : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        className={cn(
          "rounded-md border border-02 bg-01",
          // Grows with its content (up to most of the screen), so scrolling the page is not trapped inside it.
          mono && "max-h-[70vh] overflow-x-auto font-mono text-mono-12 [field-sizing:content]",
          error && "border-danger-500",
        )}
      />
      <p id={`${id}-hint`} role={error ? "alert" : undefined} className={cn("text-body-xs", error ? "text-danger-600" : "text-03")}>
        {error ?? hint}
      </p>
    </div>
  );
}

export function SchemaBlock({
  side,
  label,
  hint,
  text,
  onText,
  error,
  optional,
  onToggle,
  optionalHint,
  disabled,
}: {
  side: "input" | "output";
  label: string;
  hint: string;
  text: string;
  onText: (value: string) => void;
  error?: string;
  optional: readonly string[];
  onToggle: (name: string, on: boolean) => void;
  optionalHint: string;
  disabled: boolean;
}) {
  let schema: ContractSchema | null = null;
  try {
    schema = JSON.parse(text) as ContractSchema;
  } catch {
    schema = null;
  }
  const fields = schemaFields(schema);
  const required = new Set(Array.isArray(schema?.required) ? schema!.required : []);
  return (
    <div className="flex w-full flex-col gap-3">
      <TextBlock label={label} value={text} onChange={onText} disabled={disabled} rows={10} mono hint={hint} error={error} />
      {fields.length > 0 ? (
        <fieldset className="flex w-full flex-col gap-1.5">
          <legend className="text-label-13 text-01">Optional {side === "input" ? "inputs" : "outputs"}</legend>
          <p className="text-body-xs text-03">{optionalHint}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {fields.map((name) =>
              required.has(name) ? (
                <span key={name} className="inline-flex min-h-10 items-center gap-1.5 font-mono text-mono-12 text-03">
                  {name} <span className="font-sans text-body-xs">(required)</span>
                </span>
              ) : (
                <Checkbox
                  key={name}
                  label={<span className="font-mono text-mono-12">{name}</span>}
                  checked={optional.includes(name)}
                  disabled={disabled}
                  onChange={(e) => onToggle(name, e.target.checked)}
                />
              ),
            )}
          </div>
          {side === "output"
            ? fields
                .filter((name) => !required.has(name) && !optional.includes(name))
                .map((name) => (
                  <div key={name} role="status" className="flex w-full flex-col gap-2 rounded-lg border border-warning-20 bg-warning-10 px-3 py-2.5 tablet:flex-row tablet:items-center tablet:justify-between">
                    <p className="text-body-13 text-02">
                      You unticked <span className="font-mono text-mono-12 text-01">{name}</span>, so it is now neither an extra field nor returned by every provider. Pick one:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onToggle(name, true)}>
                        Keep as extra field
                      </Button>
                      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => schema && onText(withRequired(schema, name))}>
                        Make it required
                      </Button>
                    </div>
                  </div>
                ))
            : null}
        </fieldset>
      ) : null}
    </div>
  );
}

/** The schema text with `name` added to "required": what "Make it required" writes. */
function withRequired(schema: ContractSchema, name: string): string {
  const required = Array.isArray(schema.required) ? schema.required : [];
  return JSON.stringify({ ...schema, required: [...new Set([...required, name])] }, null, 2);
}

export function PreviewPanel({ preview }: { preview: ContractPreview }) {
  const effect = bumpEffect(preview.bump, preview.nextSemver, { firstVersion: preview.firstVersion });
  return (
    <section aria-label="What publishing this would do" aria-live="polite" className="flex w-full flex-col gap-2 rounded-lg bg-02 px-3.5 py-3">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-label-sm text-01">{preview.firstVersion ? "First version → v1.0.0" : bumpTitle(preview.bump, preview.nextSemver)}</span>
        {preview.baseSemver ? <span className="text-body-xs text-03">changes from v{preview.baseSemver}</span> : null}
      </p>
      <p className="text-body-13 text-02">{effect}</p>
      {preview.changes.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {preview.changes.map((change, i) => (
            <li key={i} className="flex items-start gap-2 text-body-13 text-02">
              <Chip className={cn("mt-px", BUMP_TONE[change.bump])}>{BUMP_LABEL[change.bump]}</Chip>
              <span className="min-w-0 [overflow-wrap:anywhere]">{changeText(change)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {preview.problems.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-label-13 text-danger-700">Fix before publishing</p>
          <ul className="list-disc pl-4 text-body-13 text-danger-700">
            {preview.problems.map((p) => (
              <li key={p} className="[overflow-wrap:anywhere]">
                {p}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-body-xs text-03">Worked out as you type. The server checks it again when you save and publish.</p>
    </section>
  );
}
