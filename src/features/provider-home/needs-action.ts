import type { BindingStatus, Money, SlaWindow } from "@/interfaces";
import type { PenaltyNotice } from "@/features/provider-penalties/use-penalty-summary";
import { routes } from "@/libs/routes";
import { formatMoney } from "@/utils/money";

/**
 * Home's "Needs action" strip: only things with a deadline or a decision,
 * most urgent first, each with the one thing to do about it.
 *
 *   penalty      a pending penalty you can still dispute (countdown to executableAt)
 *   sla          an open window already past half of your promised failure rate
 *   stake        your stake no longer covers your paid tools
 *   paused       a tool that stopped taking calls without you asking
 */

export type NeedsActionKind = "penalty" | "sla" | "stake" | "paused";

export interface NeedsActionItem {
  id: string;
  kind: NeedsActionKind;
  tone: "danger" | "warning";
  title: string;
  detail: string;
  /** A deadline to count down to. */
  deadline?: string | null;
  /** A link, or "stake" to open the Stake sheet in place. */
  action: { label: string; href: string } | { label: string; opens: "stake" };
}

export interface NeedsActionInput {
  penalties: readonly PenaltyNotice[];
  openWindows: readonly SlaWindow[];
  bindings: readonly { id: string; toolId: string; status: BindingStatus; endpoint: string }[];
  stake: { enough: boolean | null; shortfall: Money | null };
  label: (binding: { toolId: string; endpoint?: string | null }) => string;
  /** Clock for "is this window still open"; injectable for tests. */
  now?: number;
}

/** "1.6%" — one decimal under 10%, none above. */
export function percent(rate: number): string {
  const value = rate * 100;
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)}%`;
}

/** Warn once a window has used half of the promised failure rate. */
export const SLA_WARNING_SHARE = 0.5;

export function needsActionItems(input: NeedsActionInput): NeedsActionItem[] {
  const items: NeedsActionItem[] = [];

  for (const penalty of input.penalties) {
    items.push({
      id: `penalty:${penalty.id}`,
      kind: "penalty",
      tone: "danger",
      title: `Penalty${penalty.toolName ? ` on ${penalty.toolName}` : ""}${penalty.amount ? `: ${formatMoney(penalty.amount, { decimals: 2 })}` : ""}`,
      detail: "Dispute it before the deadline if you think it is wrong. After that it can be taken from your stake.",
      deadline: penalty.executableAt,
      action: { label: "Review", href: penalty.href },
    });
  }

  if (input.stake.enough === false) {
    items.push({
      id: "stake",
      kind: "stake",
      tone: "danger",
      title: input.stake.shortfall
        ? `Your stake is ${formatMoney(input.stake.shortfall, { decimals: 2 })} short`
        : "Your stake does not cover your paid tools",
      detail: "Paid calls go only to tools with enough stake behind them. Add stake to keep earning.",
      action: { label: "Add stake", opens: "stake" },
    });
  }

  // One row per tool: the window still open now. A window past its deadline is
  // closed; whatever it decided shows up as a penalty, not as a warning.
  const now = input.now ?? Date.now();
  const latestOpen = new Map<string, SlaWindow>();
  for (const window of input.openWindows) {
    if (window.deadlineAt && Date.parse(window.deadlineAt) <= now) continue;
    const seen = latestOpen.get(window.bindingId);
    if (!seen || (window.deadlineAt ?? "") > (seen.deadlineAt ?? "")) latestOpen.set(window.bindingId, window);
  }
  for (const window of latestOpen.values()) {
    if (window.observedFailureRate === null || window.declaredFailureRate <= 0) continue;
    const share = window.observedFailureRate / window.declaredFailureRate;
    if (share < SLA_WARNING_SHARE && !window.warningLevel) continue;
    const binding = input.bindings.find((b) => b.id === window.bindingId);
    const name = input.label(binding ?? { toolId: window.toolId });
    const over = share >= 1;
    items.push({
      id: `sla:${window.windowId}`,
      kind: "sla",
      tone: over || window.warningLevel === "CRITICAL" ? "danger" : "warning",
      title: over
        ? `${name}: ${percent(window.observedFailureRate)} of calls failed, over your ${percent(window.declaredFailureRate)} promise`
        : `${name}: ${percent(window.observedFailureRate)} of calls failed, near your ${percent(window.declaredFailureRate)} promise`,
      detail: over
        ? "If it is still over when this window closes, a penalty is proposed. Fix your API now to bring it back down."
        : "Failures are building up in this window. Check your API before it closes.",
      deadline: window.deadlineAt,
      action: { label: "See quality", href: routes.binding(window.bindingId, "quality") },
    });
  }

  for (const binding of input.bindings) {
    if (binding.status !== "SUSPENDED") continue;
    items.push({
      id: `paused:${binding.id}`,
      kind: "paused",
      tone: "warning",
      title: `${input.label(binding)} is not taking calls`,
      detail: "Assay stopped routing to it. Open it to see why and what to do.",
      action: { label: "Open", href: routes.binding(binding.id) },
    });
  }

  const rank: Record<NeedsActionKind, number> = { penalty: 0, stake: 1, sla: 2, paused: 3 };
  return items.sort((a, b) => {
    if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
    return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
  });
}
