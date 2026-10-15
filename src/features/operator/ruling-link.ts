import * as React from "react";

import type { ArbiterRuling } from "@/interfaces/operator";

/**
 * "Cancel" or "Uphold" on a penalty page opens the Arbiter with that
 * dispute's ruling sheet already open: `/operator/arbiter?case=<id>&rule=cancel`.
 * The ruling sheet lives on the Arbiter (one sheet, one place that signs), so
 * the penalty page links to it rather than drawing a second one.
 */

export function rulingHref(proposalId: string, kind: ArbiterRuling): string {
  return `/operator/arbiter?case=${encodeURIComponent(proposalId)}&rule=${kind === "UPHOLD" ? "uphold" : "cancel"}`;
}

/** The ruling a link asks for, or null. Pure. */
export function rulingFromLink(param: string | null | undefined): ArbiterRuling | null {
  const value = param?.trim().toLowerCase();
  return value === "uphold" ? "UPHOLD" : value === "cancel" ? "CANCEL" : null;
}

/**
 * On the Arbiter: once the linked dispute is in the list, open its ruling
 * sheet — once per link, and only for someone who may rule.
 */
export function useRulingFromLink<Row extends { requestId: string; proposalId: string }>({
  rows,
  proposalId,
  rule,
  canRule,
  open,
}: {
  rows: readonly Row[];
  proposalId: string | null;
  rule: string | null;
  canRule: boolean;
  open: (kind: ArbiterRuling, ids: string[]) => void;
}): void {
  const opened = React.useRef<string | null>(null);
  const kind = rulingFromLink(rule);
  React.useEffect(() => {
    if (!canRule || !kind || !proposalId) return;
    const key = `${proposalId}:${kind}`;
    if (opened.current === key) return;
    const row = rows.find((r) => r.proposalId === proposalId);
    if (!row) return;
    opened.current = key;
    open(kind, [row.requestId.toLowerCase()]);
  }, [canRule, kind, proposalId, rows, open]);
}
