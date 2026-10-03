"use client";

import * as React from "react";

import { cn } from "@/utils";

export interface SliderProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "type" | "value" | "defaultValue" | "onChange"
  > {
  /** Mono parameter name shown above the track, e.g. "slaFailureRate". */
  label: React.ReactNode;
  min: number;
  max: number;
  step?: number;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  /** Formats the live value shown top-right. Defaults to String(value). */
  formatValue?: (value: number) => string;
  /** Formats the min/max readouts under the track. Defaults to String(min|max). */
  formatBound?: (value: number) => string;
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  (
    {
      className,
      label,
      min,
      max,
      step = 1,
      value,
      defaultValue,
      onValueChange,
      onChange,
      formatValue = (v) => String(v),
      formatBound = (v) => String(v),
      disabled,
      ...props
    },
    ref
  ) => {
    const isControlled = value !== undefined;
    const [internal, setInternal] = React.useState(defaultValue ?? min);
    const current = isControlled ? value : internal;
    const percent = max === min ? 0 : ((current - min) / (max - min)) * 100;

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number(event.target.value);
      if (!isControlled) setInternal(next);
      onValueChange?.(next);
      onChange?.(event);
    };

    return (
      <div
        className={cn(
          "flex w-full flex-col gap-2",
          disabled && "opacity-40",
          className
        )}
      >
        <div className="flex w-full items-center justify-between">
          <span className="font-mono text-mono-13 text-02">{label}</span>
          <span className="font-mono text-mono-sm font-semibold text-01">
            {formatValue(current)}
          </span>
        </div>
        <div className="relative flex h-4 w-full items-center">
          <div className="pointer-events-none absolute inset-x-0 h-1.5 rounded-full bg-04" />
          <div
            className="pointer-events-none absolute h-1.5 rounded-full bg-primary-500"
            style={{ width: `${percent}%` }}
          />
          <input
            ref={ref}
            type="range"
            min={min}
            max={max}
            step={step}
            value={current}
            disabled={disabled}
            onChange={handleChange}
            aria-label={typeof label === "string" ? label : undefined}
            className={cn(
              "relative z-10 h-4 w-full cursor-pointer appearance-none bg-transparent disabled:cursor-not-allowed",
              "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent",
              "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent",
              "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:mt-[-5px] [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-primary-500 [&::-webkit-slider-thumb]:bg-01",
              "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-primary-500 [&::-moz-range-thumb]:bg-01",
              "focus-visible:outline-none",
              "focus-visible:[&::-webkit-slider-thumb]:outline focus-visible:[&::-webkit-slider-thumb]:outline-2 focus-visible:[&::-webkit-slider-thumb]:outline-offset-2 focus-visible:[&::-webkit-slider-thumb]:outline-primary-500",
              "focus-visible:[&::-moz-range-thumb]:outline focus-visible:[&::-moz-range-thumb]:outline-2 focus-visible:[&::-moz-range-thumb]:outline-offset-2 focus-visible:[&::-moz-range-thumb]:outline-primary-500"
            )}
            {...props}
          />
        </div>
        <div className="flex w-full items-center justify-between">
          <span className="font-mono text-mono-xs text-03">
            {formatBound(min)}
          </span>
          <span className="font-mono text-mono-xs text-03">
            {formatBound(max)}
          </span>
        </div>
      </div>
    );
  }
);
Slider.displayName = "Slider";

export { Slider };
