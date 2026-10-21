"use client";

import * as React from "react";

import { cn } from "@/utils";

/**
 * A reason picked from a fixed vocabulary, plus a written note with a live
 * counter — instead of a free-text reason code.
 *
 *   <ReasonChips
 *     label="Why"
 *     options={[
 *       { value: "LEAKED_KEY", label: "Leaked key" },
 *       { value: "FRAUD", label: "Fraud" },
 *       { value: "OTHER", label: "Other" },
 *     ]}
 *     value={reason} onChange={setReason}
 *     note={note} onNoteChange={setNote} noteMin={20}
 *     errors={{ reason: errors.reasonCode, note: errors.note }}
 *   />
 *
 * `value` is the code that is sent (the backend's reason code); the person
 * only ever sees the label. The note counter reads "12 / 20 minimum" until the
 * minimum is met. The line under the chips (the picked reason's hint, or the
 * error) takes no space until it has something to say.
 *
 * An error clears itself as soon as its field is valid: the reason error once
 * a chip is picked, the note error once the note is between `noteMin` and
 * `noteMax` — the caller does not have to reset its error state on every
 * keystroke (see `shownErrors`).
 */
export interface ReasonOption {
  /** The code sent to the API, e.g. `LEAKED_KEY`. */
  value: string;
  /** What the person reads: "Leaked key". */
  label: string;
  /** Shown under the chips when this one is picked. */
  hint?: string;
}

export interface ReasonChipsProps {
  label: string;
  options: readonly ReasonOption[];
  value: string;
  onChange: (value: string) => void;
  note: string;
  onNoteChange: (note: string) => void;
  noteLabel?: string;
  notePlaceholder?: string;
  noteMin: number;
  noteMax?: number;
  errors?: { reason?: string | null; note?: string | null };
  disabled?: boolean;
  className?: string;
}

/** "12 / 20 minimum", "34 characters", or "4,100 / 4,096 maximum". Pure. */
export function noteCounter(length: number, min: number, max?: number): { text: string; short: boolean; long: boolean } {
  if (max !== undefined && length > max) {
    return { text: `${length.toLocaleString("en-US")} / ${max.toLocaleString("en-US")} maximum`, short: false, long: true };
  }
  if (length < min) return { text: `${length} / ${min} minimum`, short: true, long: false };
  return { text: `${length.toLocaleString("en-US")} characters`, short: false, long: false };
}

/** The errors still worth showing for the current value and note. Pure. */
export function shownErrors(
  errors: ReasonChipsProps["errors"],
  value: string,
  note: string,
  noteMin: number,
  noteMax?: number,
): { reason: string | null; note: string | null } {
  const length = note.trim().length;
  const noteValid = length >= noteMin && (noteMax === undefined || length <= noteMax);
  return {
    reason: errors?.reason && !value ? errors.reason : null,
    note: errors?.note && !noteValid ? errors.note : null,
  };
}

export function ReasonChips({
  label,
  options,
  value,
  onChange,
  note,
  onNoteChange,
  noteLabel = "Note",
  notePlaceholder,
  noteMin,
  noteMax,
  errors,
  disabled,
  className,
}: ReasonChipsProps) {
  const id = React.useId();
  const counter = noteCounter(note.trim().length, noteMin, noteMax);
  const live = shownErrors(errors, value, note, noteMin, noteMax);
  const picked = options.find((option) => option.value === value);

  const onArrow = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const radios = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? [],
    );
    const at = radios.indexOf(event.currentTarget);
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    event.preventDefault();
    const next = radios[(at + step + radios.length) % radios.length];
    next?.click();
    next?.focus();
  };

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <div className="flex w-full flex-col gap-1.5">
        <span id={`${id}-label`} className="text-label-13 text-01">
          {label}
        </span>
        <div role="radiogroup" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-2">
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected || (!picked && option === options[0]) ? 0 : -1}
                disabled={disabled}
                onClick={() => onChange(option.value)}
                onKeyDown={onArrow}
                className={cn(
                  "inline-flex min-h-10 items-center rounded-full border px-3.5 py-1 text-label-13 transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40",
                  selected ? "border-primary-500 bg-primary-10 text-01" : "border-02 bg-01 text-02 hover:bg-02 hover:text-01",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {/* The hint for the picked reason, or the error — no space is held for it until there is one. */}
        <p className={cn("text-body-xs empty:hidden", live.reason ? "text-danger-600" : "text-03")} aria-live="polite">
          {live.reason ?? picked?.hint ?? ""}
        </p>
      </div>

      <div className="flex w-full flex-col gap-1.5">
        <label htmlFor={`${id}-note`} className="text-label-13 text-01">
          {noteLabel}
        </label>
        <textarea
          id={`${id}-note`}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={3}
          disabled={disabled}
          placeholder={notePlaceholder}
          aria-invalid={live.note ? true : undefined}
          aria-describedby={`${id}-count`}
          className={cn(
            "w-full rounded-md border bg-01 px-3 py-2.5 text-body-sm text-01 outline-none placeholder:text-03",
            live.note ? "border-[1.5px] border-danger-500" : "border-02 focus:border-[1.5px] focus:border-primary-500",
          )}
        />
        <p
          id={`${id}-count`}
          className={cn(
            "flex min-h-[18px] w-full justify-between gap-3 text-body-xs",
            live.note || counter.long ? "text-danger-600" : "text-03",
          )}
        >
          <span>{live.note ?? ""}</span>
          <span className="shrink-0 tabular-nums">{counter.text}</span>
        </p>
      </div>
    </div>
  );
}
