"use client";

import * as React from "react";

import type { SchemaField } from "../mapping-editor";
import type { ToolMapping } from "@/interfaces";
import { cn } from "@/utils";

import { answerNodes, pickedPath } from "./response-pick";

/**
 * "Click a value to use it": the real answer of the last test call, with each
 * value a button that fills the chosen output field. The path is written for
 * the provider (`response-pick.ts`); Advanced mapping stays for experts.
 */
export function ResponsePicker({
  answer,
  fields,
  mapping,
  disabled,
  onPick,
}: {
  /** The parsed JSON answer of the latest test call. */
  answer: unknown;
  /** The tool's output fields. */
  fields: readonly SchemaField[];
  mapping: ToolMapping;
  disabled?: boolean;
  onPick: (field: string, path: string) => void;
}) {
  const nodes = React.useMemo(() => answerNodes(answer), [answer]);
  const [active, setActive] = React.useState<string | null>(() => fields[0]?.name ?? null);
  const [picked, setPicked] = React.useState(false);
  if (fields.length === 0 || nodes.length === 0) return null;
  const used = new Map(fields.map((field) => [pickedPath(mapping, field.name), field.name] as const));

  const pick = (path: string) => {
    if (!active || disabled) return;
    onPick(active, path);
    setPicked(true);
    // On to the next output field, so a provider can click their way down the list.
    const index = fields.findIndex((field) => field.name === active);
    setActive(fields[index + 1]?.name ?? active);
  };

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border border-01 bg-02 p-3.5" data-testid="response-picker">
      <div className="flex flex-col gap-0.5">
        <h4 className="text-label-13 text-01">Pick your output fields from the answer</h4>
        <p className="text-body-xs text-03">
          Choose an output field, then click the value in your API&apos;s answer that fills it. We write the path for you.
        </p>
      </div>

      <div role="group" aria-label="Output field to fill" className="flex flex-wrap gap-2">
        {fields.map((field) => {
          const path = pickedPath(mapping, field.name);
          const on = field.name === active;
          return (
            <button
              key={field.name}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => setActive(field.name)}
              className={cn(
                "flex min-h-9 flex-col items-start rounded-md border px-2.5 py-1 text-left",
                on ? "border-primary-500 bg-primary-5" : "border-02 bg-01 hover:border-03",
              )}
            >
              <span className="text-label-13 text-01">{field.name}</span>
              <span className="break-all font-mono text-mono-xs text-03">{path ?? "not set"}</span>
            </button>
          );
        })}
      </div>

      <ul aria-label="Your API's answer" className="flex max-h-80 flex-col overflow-auto rounded-md border border-01 bg-01 py-1 font-mono text-mono-xs">
        {nodes.map((node) => {
          const owner = node.path ? used.get(node.path) : undefined;
          return (
            <li key={node.path ?? node.steps.join("\u0000")}>
              <button
                type="button"
                disabled={disabled || !node.path || !active}
                onClick={() => node.path && pick(node.path)}
                style={{ paddingLeft: `${0.75 + node.depth * 1}rem` }}
                aria-label={node.path ? `Use ${node.path} (${node.preview}) for ${active ?? "a field"}` : undefined}
                className={cn(
                  "flex w-full min-w-0 items-baseline gap-2 py-1 pr-3 text-left hover:bg-02 disabled:cursor-default disabled:hover:bg-transparent",
                  owner && "bg-primary-5",
                )}
              >
                <span className="shrink-0 text-02">{node.label}</span>
                <span className={cn("min-w-0 truncate", node.leaf ? "text-01" : "text-03")}>{node.preview}</span>
                {owner ? <span className="ml-auto shrink-0 font-sans text-label-xs text-primary-600">→ {owner}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>

      {picked ? (
        <p aria-live="polite" className="text-body-xs text-03">
          Run the test again to check your choices.
        </p>
      ) : null}
    </div>
  );
}
