import type { BindingStatus, Money, SlaWindow } from "@/interfaces";
import type { PenaltyNotice } from "@/features/provider-penalties/use-penalty-summary";
import { checkWindowScope, slaReading } from "@/features/provider-sla/reading";
import { penaltyMoney } from "@/features/provider-penalties/money";
import { stakeStatus } from "@/features/provider-stake/stake-status";
import type { CallDispute } from "@/services/call-disputes.service";
import { routes } from "@/libs/routes";
import { formatMoney } from "@/utils/money";

/**
 * Home's "Needs action" strip: only things with a deadline or a decision,
 * most urgent first, each with the one thing to do about it.
 *
 *   penalty      a pending penalty you can still dispute (countdown to executableAt)
 *   report       a buyer's bad-result report you can still reply to (countdown to replyDueAt)
 *   stake        your stake no longer covers your paid tools
 *   sla          an open window already past half of your promised failure rate,
 *                with enough checked calls for a penalty to be possible (D20)
 *   paused       a tool that stopped taking calls without you asking
 *
 * A window over (or near) the promise but still short of its minimum sample
 * cannot lead to a penalty, so it is not an action: `slaWatchItems` returns it
 * as a warning notice with the Quality tab's own sentence, and the two pages
 * never disagree.
 */

export type NeedsActionKind = "penalty" | "report" | "sla" | "stake" | "paused";

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
  /** Open bad-result reports on the provider's calls. */
  reports?: readonly Pick<CallDispute, "id" | "bindingId" | "canRespond" | "replyDueAt" | "autoUpholdAt" | "reasonLabel">[];
  openWindows: readonly SlaWindow[];
  bindings: readonly { id: string; toolId: string; status: BindingStatus; endpoint: string }[];
  stake: { enough: boolean | null; shortfall: Money | null; required?: Money | null; staked?: Money | null };
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
      title: `Penalty${penalty.toolName ? ` on ${penalty.toolName}` : ""}${penalty.amount ? `: ${penaltyMoney(penalty.amount)}` : ""}`,
      detail: "Dispute it before the deadline if you think it is wrong. After that it can be taken from your stake.",
      deadline: penalty.executableAt,
      action: { label: "Review", href: penalty.href },
    });
  }

  const now = input.now ?? Date.now();
  for (const report of input.reports ?? []) {
    if (!report.canRespond || Date.parse(report.replyDueAt) <= now) continue; // same rule as `repliableReports`
    const binding = report.bindingId ? input.bindings.find((b) => b.id === report.bindingId) : undefined;
    const name = binding ? input.label(binding) : null;
    items.push({
      id: `report:${report.id}`,
      kind: "report",
      tone: "danger",
      title: `A buyer reported a bad result${name ? ` on ${name}` : ""}: reply needed`,
      detail: report.autoUpholdAt
        ? "Reply before the deadline, or the buyer wins: a report with no reply is upheld automatically."
        : "Reply before the deadline, or an operator decides it without your side.",
      deadline: report.replyDueAt,
      action: { label: "Reply", href: routes.providerCallDispute(report.id) },
    });
  }

  if (input.stake.enough === false) {
    const health = input.stake.required
      ? stakeStatus({ required: input.stake.required, staked: input.stake.staked ?? null, enough: false })
      : null;
    items.push({
      id: "stake",
      kind: "stake",
      tone: "danger",
      title: input.stake.shortfall
        ? `Your stake is ${formatMoney(input.stake.shortfall, { decimals: 2 })} short`
        : "Your stake does not cover your paid tools",
      detail: health?.sentence ?? "Paid calls go only to tools with enough stake behind them. Add stake to keep earning.",
      action: { label: "Add stake", opens: "stake" },
    });
  }

  for (const window of openWindowsByTool(input.openWindows, now)) {
    if (window.observedFailureRate === null || window.declaredFailureRate <= 0) continue;
    const share = window.observedFailureRate / window.declaredFailureRate;
    if (share < SLA_WARNING_SHARE && !window.warningLevel) continue;
    // D20: under the minimum sample no penalty is possible; that is a notice, not an action.
    if (window.verifiedCalls < window.minVerifiedCalls) continue;
    const binding = input.bindings.find((b) => b.id === window.bindingId);
    const name = input.label(binding ?? { toolId: window.toolId });
    const over = share >= 1;
    const span = ` in ${checkWindowScope(window, now)}`;
    items.push({
      id: `sla:${window.windowId}`,
      kind: "sla",
      tone: over || window.warningLevel === "CRITICAL" ? "danger" : "warning",
      title: over
        ? `${name}: ${percent(window.observedFailureRate)} of calls failed${span}, over your ${percent(window.declaredFailureRate)} promise`
        : `${name}: ${percent(window.observedFailureRate)} of calls failed${span}, near your ${percent(window.declaredFailureRate)} promise`,
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

  const rank: Record<NeedsActionKind, number> = { penalty: 0, report: 1, stake: 2, sla: 3, paused: 4 };
  return items.sort((a, b) => {
    if (rank[a.kind] !== rank[b.kind]) return rank[a.kind] - rank[b.kind];
    return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
  });
}

/**
 * One window per tool: the one still open now. A window past its deadline is
 * closed; whatever it decided shows up as a penalty, not as a warning.
 */
function openWindowsByTool(windows: readonly SlaWindow[], now: number): SlaWindow[] {
  const latestOpen = new Map<string, SlaWindow>();
  for (const window of windows) {
    if (window.deadlineAt && Date.parse(window.deadlineAt) <= now) continue;
    const seen = latestOpen.get(window.bindingId);
    if (!seen || (window.deadlineAt ?? "") > (seen.deadlineAt ?? "")) latestOpen.set(window.bindingId, window);
  }
  return [...latestOpen.values()];
}

/** A warning that needs no action yet: shown among the Inbox notices and on Home, not counted. */
export interface WatchItem {
  id: string;
  title: string;
  /** The Quality tab's own sentence, with its sample ("Not enough calls yet (13 of 400)"). */
  detail: string;
  href: string;
}

/**
 * D20: windows at or over the warning share whose sample is still below the
 * minimum. No penalty is possible yet, so they say exactly what the Quality
 * tab says, as a warning rather than a "Needs action" item.
 */
export function slaWatchItems(input: Pick<NeedsActionInput, "openWindows" | "bindings" | "label" | "now">): WatchItem[] {
  const now = input.now ?? Date.now();
  const items: WatchItem[] = [];
  for (const window of openWindowsByTool(input.openWindows, now)) {
    if (window.observedFailureRate === null || window.declaredFailureRate <= 0) continue;
    if (window.verifiedCalls >= window.minVerifiedCalls) continue;
    const share = window.observedFailureRate / window.declaredFailureRate;
    if (share < SLA_WARNING_SHARE && !window.warningLevel) continue;
    const binding = input.bindings.find((b) => b.id === window.bindingId);
    const name = input.label(binding ?? { toolId: window.toolId });
    const reading = slaReading(window, window.declaredFailureRate, { now });
    items.push({
      id: `sla-watch:${window.windowId}`,
      title: `${name}: ${percent(window.observedFailureRate)} of calls failed in ${checkWindowScope(window, now)}, ${share > 1 ? "over" : "near"} your ${percent(window.declaredFailureRate)} promise`,
      detail: [reading.advice, reading.sample ? `${reading.sample}.` : null].filter(Boolean).join(" "),
      href: routes.binding(window.bindingId, "quality"),
    });
  }
  return items;
}
