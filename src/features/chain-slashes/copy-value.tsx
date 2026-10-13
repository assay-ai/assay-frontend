"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * A shortened value with a copy button for the full one. The same clipboard
 * handling as `features/provider-traffic/agent-id-cell.tsx`, which bakes in
 * the agent-id shortener; this one takes the display text.
 */
export function CopyValue({
  value,
  display,
  label,
  className,
}: {
  value: string;
  display: string;
  /** What is copied, for the button's accessible name: "request id", "beneficiary". */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => () => clearTimeout(resetTimer.current), []);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (insecure context, permissions, …) — no-op.
    }
  }, [value]);

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={value}>
      <span className="truncate font-mono">{display}</span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? `Copied ${label}` : `Copy full ${label}`}
        className="shrink-0 rounded-sm p-0.5 text-03 transition-colors hover:bg-02 hover:text-01"
      >
        {copied ? <Check width={12} height={12} /> : <Copy width={12} height={12} />}
      </button>
    </span>
  );
}
