/**
 * Pure helpers for the traffic-by-agent view (per-agent traffic), shared by
 * `src/app/(console)/provider/agent-traffic/page.tsx`.
 *
 * ## Why "Settled" / "Refunded" / "Other", not "Failures" / "Fail rate"
 *
 * The design draws `Failures` and `Fail rate` columns.
 * `GET /providers/me/traffic` carries no verdict at all — only
 * `PaymentIntentStatus` (`payment_intents.status`), a lifecycle state, not a
 * verification outcome. The one status that IS a real, attributable failure
 * is `REFUNDED`: in the payment-intent lifecycle, `REFUNDED` is the one outcome where "verification failed, the agent
 * was made whole" and it is the only one of the eight that counts toward an
 * SLA window. `VOIDED` and `EXPIRED` are not attributable the same way (no
 * charge, no strike), and the in-flight states (`CREATED`, `FUNDS_SECURED`,
 * `PROVIDER_EXECUTING`, `VERIFYING`) are not outcomes yet.
 *
 * So this screen reports `Settled` and `Refunded` by their real names rather
 * than relaborating them as "pass"/"fail" — `verdict` (PASS/FAIL) is a
 * different field on a different endpoint (`calls/export`), and reusing that
 * language here for a same-looking-but-different quantity would make the two
 * screens disagree about what "fail rate" means. `Other` folds the remaining
 * five statuses (`VOIDED`, `EXPIRED`, and the three in-flight states) into
 * one bucket — none of them is a provider-attributable failure, and none is
 * common enough after a 30-day window to earn its own column.
 *
 * ## What is deliberately NOT here
 *
 * - **"Excluded".** Columns for per-agent failures-excluded and earnings are
 *   not rendered because no endpoint returns them. Not rendered as a dash
 *   column (a dash column implies "tracked, not known here") — omitted, and
 *   said so on screen.
 * - **"Net to you" (per-agent money).** No endpoint groups earned money by
 *   `agentId` — `earnings` groups by day or by tool only. Omitted for the
 *   same reason.
 */

import type { ProviderStatusCount, ProviderTraffic } from "@/interfaces";

/** The one status this window can call a real, attributable failure. See above. */
const REFUNDED = "REFUNDED";
const SETTLED = "SETTLED";

export interface StatusSplit {
  calls: number;
  settled: number;
  refunded: number;
  /** Every status other than `SETTLED`/`REFUNDED` — see the module doc. */
  other: number;
}

function countOf(byStatus: readonly ProviderStatusCount[], status: string): number {
  return byStatus.find((entry) => entry.status === status)?.calls ?? 0;
}

export function splitByStatus(byStatus: readonly ProviderStatusCount[]): StatusSplit {
  const calls = byStatus.reduce((total, entry) => total + entry.calls, 0);
  const settled = countOf(byStatus, SETTLED);
  const refunded = countOf(byStatus, REFUNDED);
  return { calls, settled, refunded, other: Math.max(0, calls - settled - refunded) };
}

/** `refunded / calls`, or `null` when there were no calls to divide by. */
export function refundedRate(split: StatusSplit): number | null {
  return split.calls > 0 ? split.refunded / split.calls : null;
}

export interface OtherAgentsRow {
  /** Calls from every agent not in the top-10 breakdown. Zero means none. */
  calls: number;
  split: StatusSplit;
}

/**
 * Everyone the top-10 `agentBreakdown` does not name, folded into one row —
 * the same shape the design's "87 others" row draws, minus the count of
 * distinct agents (this response does not say how many there are, only how
 * many calls they made).
 *
 * Derived entirely from two real totals already on the wire:
 * `traffic.totalCalls` (every call in the window) and the per-day `buckets`
 * (also every call, folded by status) minus what the top-10 rows already
 * account for. Not an estimate — a subtraction of two exhaustive sums.
 *
 * When `agentId` was passed on the request, `agentBreakdown` holds at most
 * that one agent and `totalCalls` is already narrowed to it, so this
 * subtraction correctly comes out to zero rather than needing a separate
 * branch.
 */
export function otherAgentsRow(traffic: ProviderTraffic): OtherAgentsRow | null {
  const topCalls = traffic.agentBreakdown.reduce((total, agent) => total + agent.calls, 0);
  const calls = Math.max(0, traffic.totalCalls - topCalls);
  if (calls === 0) return null;

  const totalByStatus = new Map<string, number>();
  for (const bucket of traffic.buckets) {
    for (const entry of bucket.byStatus) {
      totalByStatus.set(entry.status, (totalByStatus.get(entry.status) ?? 0) + entry.calls);
    }
  }
  for (const agent of traffic.agentBreakdown) {
    for (const entry of agent.byStatus) {
      totalByStatus.set(
        entry.status,
        Math.max(0, (totalByStatus.get(entry.status) ?? 0) - entry.calls)
      );
    }
  }

  const byStatus: ProviderStatusCount[] = [...totalByStatus.entries()].map(([status, n]) => ({
    status,
    calls: n,
  }));

  return { calls, split: splitByStatus(byStatus) };
}

/**
 * `payment_intents.agent_id`, shortened for display — there is no `ag_7K2`
 * short-ref form on the wire (the design's is a placeholder, same situation
 * `shortBindingId` documents for bindings). Always pair with the full id.
 */
export function shortAgentId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `agentId` is `@IsUUID()` server-side; checked here so a typo reads as "not a valid id" rather than a round trip to a 400. */
export function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** "Agent a1b2" — a buyer's agent as a provider sees it: no name is shared, so a short tag of its id. */
export function agentLabel(id: string): string {
  return `Agent ${id.replace(/[^0-9a-z]/gi, "").slice(0, 4).toLowerCase()}`;
}
