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
 */
export function CredentialHeadersForm({
  bindingId,
  origin,
  onSaved,
  onCancel,
}: {
  bindingId: string;
  origin: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const nextKey = React.useRef(1);
  const [rows, setRows] = React.useState<Row[]>(() => [{ key: 0, name: "", value: "" }]);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const problems = credentialHeaderProblems(rows.map(({ name, value }) => ({ name, value })));
  // Every row past the limit carries the same message: say it once, above the rows.
  const countProblem = rows.length > MAX_ROWS ? problems.get(MAX_ROWS) : undefined;
  const rowProblem = (index: number) => (index >= MAX_ROWS ? undefined : problems.get(index));
  const empty = rows.every((row) => row.name.trim() === "" && row.value === "");

  const patch = (key: number, next: Partial<CredentialHeaderInput>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...next } : row)));

  const save = async () => {
    if (saving || origin === "") return;
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
      setError(caught instanceof ApiError ? plainError(caught.code) : "The headers could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-01 bg-01 p-3">
      <p className="text-body-xs text-03">Values are encrypted and never shown again. Saving replaces all headers.</p>
      {countProblem ? (
        <p role="alert" className="text-body-xs text-danger-600">
          {countProblem}
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const problem = rowProblem(index);
          const invalid = Boolean(problem) || index >= MAX_ROWS;
          return (
            <div key={row.key} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
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
                  autoComplete="off"
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
        <Button type="button" size="sm" onClick={() => void save()} loading={saving} disabled={saving || empty || problems.size > 0}>
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
