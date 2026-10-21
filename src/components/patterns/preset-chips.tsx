"use client";

import * as React from "react";

import { cn } from "@/utils";

/**
 * An amount picked from presets, with Custom for anything else.
 *
 *   const [amount, setAmount] = React.useState("");   // never prefilled
 *   <PresetChips label="Amount" presets={["5", "20", "50"]} value={amount} onChange={setAmount} />
 *
 * `value` is a decimal string in major units ("20", "0.50"), `""` for
 * nothing chosen. Validate with `parseAmountInput(value, { decimals, min, max })`
 * from `utils/money.ts` and pass its `error` back as `error`; it also gives
 * the minor units for the API. Choosing Custom focuses the field.
 *
 * A preset can set more than one field (escrow caps: "Light" = $0.50 a call
 * and $5 a day): give each option a `label`, a `description` and `onPick`,
 * and keep `value` as the option's key.
 *
 *   <PresetChips label="Safety caps" value={preset} onChange={setPreset}
 *     presets={[
 *       { value: "light", label: "Light", description: "$0.50 a call · $5 a day", onPick: () => setCaps("0.5", "5") },
 *       { value: "standard", label: "Standard", description: "$1 a call · $20 a day", onPick: () => setCaps("1", "20") },
 *     ]}
 *     allowCustom={false} />
 */
export interface PresetOption {
  value: string;
  /** Default: "$" + value. */
  label?: string;
  /** A second line on the chip, e.g. "$1 a call · $20 a day". */
  description?: string;
  /** Extra effect when picked (set other fields). */
  onPick?: () => void;
}

export interface PresetChipsProps {
  /** Accessible name for the group: "Deposit amount". */
  label: string;
  presets: (string | PresetOption)[];
  value: string;
  onChange: (value: string) => void;
  /** Default true. */
  allowCustom?: boolean;
  customLabel?: string;
  /** Prefix in the custom field. Default "$". */
  prefix?: string;
  placeholder?: string;
  /** Error under the field. */
  error?: React.ReactNode;
  /** Helper line under the field, e.g. "Minimum $1.00". */
  hint?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  /**
   * "chips" (default) wraps compact chips on one line. "cards" lays options
   * with a sentence-long description out as a grid of equal-width cards,
   * one column on a phone and two from 480px, left-aligned.
   */
  layout?: "chips" | "cards";
}

function normalise(option: string | PresetOption): PresetOption & { label: string } {
  if (typeof option === "string") return { value: option, label: `$${option}` };
  return { ...option, label: option.label ?? `$${option.value}` };
}

/** Whether `value` is one of the presets (numerically: "20" = "20.00"). */
export function matchesPreset(value: string, presets: readonly string[]): boolean {
  if (value.trim() === "") return false;
  const n = Number(value);
  return presets.some((preset) => preset === value || (Number.isFinite(n) && Number(preset) === n));
}

export function PresetChips({
  label,
  presets,
  value,
  onChange,
  allowCustom = true,
  customLabel = "Custom",
  prefix = "$",
  placeholder = "0.00",
  error,
  hint,
  disabled,
  className,
  layout = "chips",
}: PresetChipsProps) {
  const cards = layout === "cards";
  const options = presets.map(normalise);
  const id = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isPreset = options.some((o) => o.value === value) || matchesPreset(value, options.map((o) => o.value));

  // Arrow keys move between chips, as in any radio group.
  const onArrow = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const radios = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? [],
    );
    const at = radios.indexOf(event.currentTarget);
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    event.preventDefault();
    radios[(at + step + radios.length) % radios.length]?.click();
    radios[(at + step + radios.length) % radios.length]?.focus();
  };
  const [customMode, setCustomMode] = React.useState(() => value !== "" && !isPreset);
  const custom = allowCustom && (customMode || (value !== "" && !isPreset));
  const isSelected = (option: PresetOption) =>
    !custom && (option.value === value || (isPreset && Number(option.value) === Number(value)));
  const anySelected = custom || options.some(isSelected);

  const chip = (selected: boolean) =>
    cn(
      "inline-flex min-h-9 flex-col items-center justify-center rounded-md border px-3.5 py-1 text-label-13 tabular-nums transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40",
      selected ? "border-primary-500 bg-primary-10 text-01" : "border-02 bg-01 text-02 hover:bg-02 hover:text-01",
    );

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <div
        role="radiogroup"
        aria-label={label}
        className={cards ? "grid w-full grid-cols-1 gap-2 min-[480px]:grid-cols-2" : "flex flex-wrap gap-2"}
      >
        {options.map((option, index) => {
          const selected = isSelected(option);
          // Roving tab stop, as in any radio group: only the selected chip (or
          // the first, when none is) takes focus, so a drawer's auto-focus never
          // rings a chip that is not the chosen one.
          const tabStop = anySelected ? selected : index === 0;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={tabStop ? 0 : -1}
              disabled={disabled}
              onClick={() => {
                setCustomMode(false);
                onChange(option.value);
                option.onPick?.();
              }}
              onKeyDown={onArrow}
              className={cn(
                chip(selected),
                option.description && "items-start",
                cards && "h-full w-full justify-start gap-0.5 py-2.5 text-left",
              )}
            >
              {option.label}
              {option.description ? (
                <span className="text-body-xs font-normal text-03">
                  {option.description}
                </span>
              ) : null}
            </button>
          );
        })}
        {allowCustom ? (
          <button
            type="button"
            role="radio"
            aria-checked={custom}
            tabIndex={custom ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              setCustomMode(true);
              if (isPreset) onChange("");
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            onKeyDown={onArrow}
            className={chip(custom)}
          >
            {customLabel}
          </button>
        ) : null}
      </div>

      {custom ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-custom`} className="sr-only">
            {label}, custom amount
          </label>
          <div
            className={cn(
              "flex w-full max-w-[240px] items-center gap-1.5 rounded-md border bg-01 px-3 py-2 focus-within:ring-2 focus-within:ring-primary-500",
              error ? "border-danger-500" : "border-02",
            )}
          >
            <span aria-hidden="true" className="text-body-sm text-03">
              {prefix}
            </span>
            <input
              ref={inputRef}
              id={`${id}-custom`}
              inputMode="decimal"
              autoComplete="off"
              placeholder={placeholder}
              value={value}
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              aria-describedby={error || hint ? `${id}-help` : undefined}
              // The text as typed: never rewritten ("-5" must not become 5,
              // "1,5" must not become 15). parseAmountInput says what is wrong.
              onChange={(event) => onChange(event.target.value)}
              className="w-full min-w-0 bg-transparent font-mono text-mono-sm text-01 outline-none placeholder:text-03"
            />
          </div>
        </div>
      ) : null}

      {error || hint ? (
        <p id={`${id}-help`} className={cn("text-body-xs", error ? "text-danger-600" : "text-03")}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}
