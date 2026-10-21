"use client";

import { Plus, X } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CredentialHeaderInput } from "@/interfaces/provider-bindings";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { putBindingCredentials } from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";

import { credentialHeaderProblems, splitHeaderLine } from "./rules";

const MAX_ROWS = 10;

interface Row extends CredentialHeaderInput {
  key: number;
}

/**
 * Write-only: the values live in this component's state and nowhere else (not
 * in the query cache, not in a mutation), and are dropped after a save.
 *
 * A row's problem shows once focus has left that row (blur) or they tried to
 * save, never on fields they have not touched yet.
 */
export function CredentialHeadersForm({
  bindingId,
  origin,
  initialHeaders = null,
  onSaved,
  onCancel,
}: {
  bindingId: string;
  origin: string;
  /** Prefilled rows (moved out of the address); kept in this form's state only. */
  initialHeaders?: readonly CredentialHeaderInput[] | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const nextKey = React.useRef((initialHeaders?.length ?? 0) + 1);
  const [rows, setRows] = React.useState<Row[]>(() =>
    initialHeaders && initialHeaders.length > 0
      ? initialHeaders.map((header, key) => ({ key, name: header.name, value: header.value }))
      : [{ key: 0, name: "", value: "" }],
  );
  const [touched, setTouched] = React.useState<ReadonlySet<number>>(() => new Set());
  const [attempted, setAttempted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const problems = credentialHeaderProblems(rows.map(({ name, value }) => ({ name, value })));
  // Every row past the limit carries the same message: say it once, above the rows.
  const countProblem = rows.length > MAX_ROWS ? problems.get(MAX_ROWS) : undefined;
  const shown = (row: Row) => attempted || touched.has(row.key);
  const rowProblem = (index: number) => (index >= MAX_ROWS || !shown(rows[index]!) ? undefined : problems.get(index));
  const empty = rows.every((row) => row.name.trim() === "" && row.value === "");
  const touch = (key: number) => setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));

  const patch = (key: number, next: Partial<CredentialHeaderInput>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...next } : row)));

  const save = async () => {
    if (saving || origin === "") return;
    setAttempted(true);
    if (problems.size > 0) return;
    setSaving(true);
    setError(null);
    try {
      await putBindingCredentials(
        bindingId,
        origin,
        rows.map(({ name, value }) => ({ name: name.trim(), value })),
      );
      setRows([{ key: nextKey.current++, name: "", value: "" }]);
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? plainError(caught.code, caught.status) : "The headers could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-01 bg-01 p-3">
      <p className="text-body-xs text-03">Values are encrypted and never shown again. Saving replaces all headers.</p>
      {initialHeaders && initialHeaders.length > 0 ? (
        <p className="text-body-xs text-03">
          Moved from your address. Check the header name your API reads: it may differ from the URL parameter.
        </p>
      ) : null}
      {countProblem ? (
        <p role="alert" className="text-body-xs text-danger-600">
          {countProblem}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const problem = rowProblem(index);
          const invalid = Boolean(problem) || (index >= MAX_ROWS && Boolean(countProblem));
          return (
            <div key={row.key} className="flex flex-col gap-1">
              <div
                className="flex items-center gap-2"
                // Checked once focus leaves the row, not when moving from its name to its value.
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) touch(row.key);
                }}
              >
                <Input
                  aria-label="Header name"
                  aria-invalid={invalid || undefined}
                  placeholder="X-Api-Key"
                  autoComplete="off"
                  spellCheck={false}
                  value={row.name}
                  className={cn("h-10 flex-1 font-mono text-mono-13", invalid && "border-danger-500")}
                  onChange={(event) => patch(row.key, { name: event.target.value })}
                  onPaste={(event) => {
                    const split = splitHeaderLine(event.clipboardData.getData("text"));
                    if (!split || split.name === "") return;
                    event.preventDefault();
                    patch(row.key, split);
                  }}
                />
                <Input
                  type="password"
                  aria-label="Header value"
                  aria-invalid={invalid || undefined}
                  placeholder="Value"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={row.value}
                  className={cn("h-10 flex-1 font-mono text-mono-13", invalid && "border-danger-500")}
                  onChange={(event) => patch(row.key, { value: event.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Remove header"
                  disabled={rows.length === 1}
                  onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
              {problem ? <p className="text-body-xs text-danger-600">{problem}</p> : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={<Plus aria-hidden="true" />}
          disabled={rows.length >= MAX_ROWS}
          onClick={() => setRows((current) => [...current, { key: nextKey.current++, name: "", value: "" }])}
        >
          Add header
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} loading={saving} disabled={saving || empty || Boolean(countProblem)}>
          Save headers
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-body-13 text-danger-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
