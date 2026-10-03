"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

export interface CodeBlockProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "onCopy"> {
  /** Head label, e.g. "mcp.json" or "tools/call". */
  title: string;
  code: string;
  /** Renders the copy affordance the design draws. Default true. */
  copyable?: boolean;
  /** Fired after the copy button successfully writes `code` to the clipboard. */
  onCopyCode?: (code: string) => void;
}

/**
 * Plain preformatted code display — no syntax-highlighting package is
 * installed, so this renders mono text as-is with horizontal scroll for
 * lines that don't wrap cleanly (long tokens, URLs), matching the design's
 * dark "Code Block" chrome.
 */
export const CodeBlock = React.forwardRef<HTMLDivElement, CodeBlockProps>(
  ({ title, code, copyable = true, onCopyCode, className, ...props }, ref) => {
    const [copied, setCopied] = React.useState(false);
    const resetTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    React.useEffect(() => () => clearTimeout(resetTimer.current), []);

    const handleCopy = React.useCallback(async () => {
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        onCopyCode?.(code);
        clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setCopied(false), 1500);
      } catch {
        // Clipboard API unavailable (insecure context, permissions, …) — no-op.
      }
    }, [code, onCopyCode]);

    return (
      <div
        ref={ref}
        className={cn("w-full overflow-hidden rounded-lg bg-inverse", className)}
        {...props}
      >
        <div className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5">
          <span className="text-mono-12 font-mono text-inverse">{title}</span>
          {copyable ? (
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? `Copied ${title} to clipboard` : `Copy ${title} to clipboard`}
              className="flex items-center gap-1.5 rounded-sm bg-overlay-light px-2 py-1 text-label-xs text-inverse dark:bg-overlay-dark"
            >
              {copied ? <Check width={13} height={13} /> : <Copy width={13} height={13} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          ) : null}
        </div>
        <div className="w-full overflow-x-auto px-3.5 pb-4">
          <pre className="w-full whitespace-pre text-mono-12 font-mono text-inverse">{code}</pre>
        </div>
      </div>
    );
  }
);
CodeBlock.displayName = "CodeBlock";
