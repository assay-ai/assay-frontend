"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

import { agentLabel } from "./breakdown";

/**
 * `payment_intents.agent_id` is an opaque UUID with no short-ref form on the
 * wire (see `shortAgentId`). The brief requires shortening it for display
 * while keeping the full value copyable — there is no shared "copy to
 * clipboard" primitive beyond the one baked into `CodeBlock`, so this repeats
 * that component's clipboard handling at table-row scale rather than
 * stretching `CodeBlock` (a dark code-panel chrome) over a single inline
 * value. Promote this to `@/components/ui/` if another screen needs the same
 * shape.
 */
export function AgentIdCell({ agentId, className }: { agentId: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  React.useEffect(() => () => clearTimeout(resetTimer.current), []);

  const handleCopy = React.useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(agentId);
        setCopied(true);
        clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => setCopied(false), 1500);
      } catch {
        // Clipboard API unavailable (insecure context, permissions, …) — no-op.
      }
    },
    [agentId]
  );

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={agentId}>
      <span className="truncate">{agentLabel(agentId)}</span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied agent id to clipboard" : "Copy full agent id to clipboard"}
        className="shrink-0 rounded-sm p-0.5 text-03 transition-colors hover:bg-02 hover:text-01"
      >
        {copied ? <Check width={12} height={12} /> : <Copy width={12} height={12} />}
      </button>
    </span>
  );
}
