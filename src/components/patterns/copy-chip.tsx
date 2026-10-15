"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * An id (uuid, address, tx hash, intent id) as a small copyable chip.
 *
 * The rule this exists for: **an id is never the label.** A row is named by
 * what a person recognises (a tool name, an agent's label) and the id rides
 * along as one of these, short, with the full value on hover and one click
 * from the clipboard.
 *
 *   <CopyChip value={call.intentId} label="call id" />
 */

/** `06399979-f8b8-…` → `06399979…`; a long hash keeps both ends; a short id stays whole. */
export function shortId(value: string): string {
  if (value.length <= 12) return value;
  const uuidHead = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.exec(value);
  if (uuidHead) return `${value.slice(0, 8)}…`;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export interface CopyChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value" | "children"> {
  /** The full value that is copied. */
  value: string;
  /** What is shown. Defaults to `shortId(value)`. */
  display?: string;
  /** What the value is, for screen readers and the tooltip: "call id", "wallet address". */
  label?: string;
}

const RESET_MS = 1500;

export const CopyChip = React.forwardRef<HTMLButtonElement, CopyChipProps>(
  ({ value, display, label = "id", className, onClick, ...props }, ref) => {
    const [copied, setCopied] = React.useState(false);
    const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    React.useEffect(() => () => clearTimeout(timer.current), []);

    const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      // A chip inside a clickable row or link must not also open it. Prefer
      // `EntityName copyable={false}` inside links: a button in an <a> is invalid HTML.
      event.preventDefault();
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), RESET_MS);
      } catch {
        // Clipboard refused (insecure context, denied permission): the full
        // value stays in the title, so it can still be selected by hand.
      }
    };

    return (
      <button
        ref={ref}
        type="button"
        title={value}
        onClick={(event) => void copy(event)}
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-sm border border-01 bg-02 px-1.5 py-px font-mono text-mono-xs text-02 transition-colors",
          "hover:border-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
          className,
        )}
        {...props}
      >
        <span className="truncate">{copied ? "Copied" : (display ?? shortId(value))}</span>
        {copied ? (
          <Check aria-hidden="true" className="size-3 shrink-0 text-success-500" />
        ) : (
          <Copy aria-hidden="true" className="size-3 shrink-0 text-03" />
        )}
        <span className="sr-only">{copied ? `${label} copied` : `Copy ${label} ${value}`}</span>
        <span aria-live="polite" className="sr-only">
          {copied ? "Copied" : ""}
        </span>
      </button>
    );
  },
);
CopyChip.displayName = "CopyChip";
