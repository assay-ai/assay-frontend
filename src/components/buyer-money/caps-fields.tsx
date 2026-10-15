"use client";

import * as React from "react";

import { PresetChips } from "@/components/patterns/preset-chips";
import { Field } from "@/components/ui/field";
import {
  CAP_PRESETS,
  capsSentence,
  presetDescription,
  presetFor,
  type CapsChoice,
  type ParsedCaps,
} from "@/features/buyer-money/caps";

/**
 * Light / Standard / Custom, and the two numbers behind them. Shared by the
 * safety-caps drawer and the "let your agent pay" drawer, so both read alike.
 */
export interface CapsValue {
  perCall: string;
  perDay: string;
}

export function CapsFields({
  value,
  onChange,
  parsed,
  idPrefix,
  label = "Caps",
}: {
  value: CapsValue;
  onChange: (next: CapsValue) => void;
  parsed: ParsedCaps;
  idPrefix: string;
  label?: string;
}) {
  const derived = presetFor(value.perCall, value.perDay);
  const [customOpen, setCustomOpen] = React.useState(derived === "custom" && value.perCall !== "");
  const choice: CapsChoice | "" = customOpen ? "custom" : value.perCall === "" && value.perDay === "" ? "" : derived;
  const sentence = capsSentence(value.perCall, value.perDay);

  return (
    <div className="flex flex-col gap-3">
      <PresetChips
        label={label}
        allowCustom={false}
        value={choice}
        onChange={() => undefined}
        presets={[
          ...CAP_PRESETS.map((preset) => ({
            value: preset.id,
            label: preset.label,
            description: presetDescription(preset),
            onPick: () => {
              setCustomOpen(false);
              onChange({ perCall: preset.perCall, perDay: preset.perDay });
            },
          })),
          {
            value: "custom",
            label: "Custom",
            description: "your own numbers",
            onPick: () => setCustomOpen(true),
          },
        ]}
      />
      {choice === "custom" ? (
        <div className="flex flex-col gap-3 tablet:flex-row">
          <Field
            id={`${idPrefix}-per-call`}
            label="Most per call"
            inputMode="decimal"
            suffix="USD"
            placeholder="1.00"
            value={value.perCall}
            error={value.perCall ? (parsed.perCall.error ?? undefined) : undefined}
            onChange={(e) => onChange({ ...value, perCall: e.target.value })}
            wrapperClassName="tablet:flex-1"
          />
          <Field
            id={`${idPrefix}-per-day`}
            label="Most per 24 hours"
            inputMode="decimal"
            suffix="USD"
            placeholder="20.00"
            value={value.perDay}
            error={value.perDay ? (parsed.perDay.error ?? undefined) : undefined}
            onChange={(e) => onChange({ ...value, perDay: e.target.value })}
            wrapperClassName="tablet:flex-1"
          />
        </div>
      ) : null}
      {sentence && parsed.ok ? <p className="text-body-13 text-02">{sentence}</p> : null}
    </div>
  );
}
