"use client";

import * as React from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { OPTIONAL_INPUT_HINT, OPTIONAL_OUTPUT_HINT } from "@/features/contracts/text";
import { cn } from "@/utils";

import {
  majorNote,
  moveNotice,
  offeredFields,
  TERMS_CHANGED_NOTICE,
  termsProblem,
  toggleField,
  toggleMajor,
  type ContractTerms,
  type MajorChoice,
} from "./contract-terms";

/**
 * "Contract versions you serve", "Extra fields you return" and "Extra inputs
 * you accept" (design spec §7.5, T3) — one block in Connect & test, because
 * every change here needs a new test before it can go live.
 *
 * A tool with one version and no optional fields shows nothing at all: there
 * is no choice to make, so there is no noise.
 */
export function ContractTermsPanel({
  choices,
  terms,
  changed,
  disabled,
  onChange,
}: {
  choices: readonly MajorChoice[];
  terms: ContractTerms;
  /** The terms differ from the stored listing's. */
  changed: boolean;
  disabled?: boolean;
  onChange: (next: ContractTerms) => void;
}) {
  const offered = offeredFields(choices, terms.majors);
  const pickMajor = choices.length > 1 || choices.some((c) => c.status !== "ACTIVE");
  if (!pickMajor && offered.outputs.length === 0 && offered.inputs.length === 0) return null;

  const problem = termsProblem(terms, choices);
  const move = moveNotice(terms, choices);

  return (
    <section aria-labelledby="contract-terms-title" className="flex w-full flex-col gap-4 rounded-lg border border-01 bg-01 p-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 id="contract-terms-title" className="text-label-sm text-01">
          What you serve
        </h3>
        <p className="text-body-xs text-03">
          The contract is what agents send and get back for this tool. A new version number (v2) means it changed in a way your
          mapping must follow. Each version you tick gets its own test before you can publish.
        </p>
      </div>

      {move ? (
        <p role="status" className="rounded-md border border-warning-20 bg-warning-10 px-3 py-2 text-body-13 text-warning-700">
          {move}
        </p>
      ) : null}

      {pickMajor ? (
        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className="pb-1 text-label-13 text-01">Contract versions you serve</legend>
          {choices.map((choice) => {
            const note = majorNote(choice);
            return (
              <Checkbox
                key={choice.major}
                checked={terms.majors.includes(choice.major)}
                disabled={disabled || (choice.status === "RETIRED" && !terms.majors.includes(choice.major))}
                onChange={() => onChange(toggleMajor(terms, choices, choice.major))}
                className="min-h-10 items-center"
                label={
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="text-01">
                      v{choice.major} <span className="font-mono text-body-xs text-03">({choice.semver})</span>
                    </span>
                    {note ? (
                      <span
                        className={cn(
                          "text-body-xs",
                          choice.status === "ACTIVE" ? "text-03" : choice.status === "RETIRED" ? "text-danger-600" : "text-warning-700",
                        )}
                      >
                        {note}
                      </span>
                    ) : null}
                  </span>
                }
              />
            );
          })}
        </fieldset>
      ) : null}

      {offered.outputs.length > 0 ? (
        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className="text-label-13 text-01">Extra fields you return</legend>
          <p className="pb-1 text-body-xs text-03">{OPTIONAL_OUTPUT_HINT} Tick only what your API always returns.</p>
          <div className="flex flex-wrap gap-x-4">
            {offered.outputs.map((field) => (
              <Checkbox
                key={field}
                checked={terms.provides.includes(field)}
                disabled={disabled}
                onChange={() => onChange(toggleField(terms, "provides", field))}
                className="min-h-10"
                label={<span className="break-all font-mono text-body-13">{field}</span>}
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      {offered.inputs.length > 0 ? (
        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className="text-label-13 text-01">Extra inputs you accept</legend>
          <p className="pb-1 text-body-xs text-03">{OPTIONAL_INPUT_HINT}</p>
          <div className="flex flex-wrap gap-x-4">
            {offered.inputs.map((field) => (
              <Checkbox
                key={field}
                checked={terms.supports.includes(field)}
                disabled={disabled}
                onChange={() => onChange(toggleField(terms, "supports", field))}
                className="min-h-10"
                label={<span className="break-all font-mono text-body-13">{field}</span>}
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      {problem ? (
        <p role="alert" className="text-body-13 text-danger-600">
          {problem}
        </p>
      ) : changed ? (
        <p role="status" className="text-body-13 text-02">
          {TERMS_CHANGED_NOTICE}
        </p>
      ) : null}
    </section>
  );
}
