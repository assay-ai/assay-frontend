"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { ApprovalItem, type ApprovalResult } from "@/features/operator/approval-item";
import { ResultCard } from "@/features/operator/result-card";
import { approvalErrorMessage, describeApproval } from "@/features/operator/approvals";
import { DisputeLine } from "@/features/operator/dispute-line";
import { HealthStrip } from "@/features/operator/health-strip";
import { checkedAgo, groupApprovals, needsYouCount, sortDisputesByDaysLeft } from "@/features/operator/inbox";
import { approverNames, expiryReading } from "@/components/patterns/approval-footer";
import { RoleIntro, useRoleIntro } from "@/features/operator/role-intro";
import { capabilitiesFor } from "@/features/operator/roles";
import { useOperatorSession } from "@/features/operator/session-context";
import { approvalHref } from "@/features/operator/two-person";
import { sortHoldsOldestFirst } from "@/features/operator/slash-holds-panel";
import { useApprovalContext } from "@/features/operator/use-approval-context";
import { useProviderNames } from "@/features/operator/use-operator-lookups";
import { holdChainName } from "@/features/slash-hold/model";
import { ApiError } from "@/libs/ApiClient";
import { operatorHoldReasonText } from "@/libs/slash-hold";
import { getPlatformHealth, listAccountBlocks, listApprovals, listArbiterDisputes } from "@/services/operator.service";

/**
 * Home, route `/operator`: the "Needs you" inbox.
 *
 * Everything this operator can act on, on one page, in the order it can be
 * lost: approvals their roles can decide (closest to expiring first), and —
 * for whoever can rule — on-chain disputes by days left, red from day 20.
 * Then what is worth watching but needs nobody: slash holds and active
 * blocks. Platform health is one line that opens only when something is red.
 *
 * Not here, on purpose:
 *  - Penalties waiting for a cancel signature (CANCEL_REQUESTED). The backend
 *    has no endpoint that lists them; each one shows on its penalty page with
 *    its deadline. [backend] a list endpoint, then a group here.
 *  - The retired off-chain objection queue (claim / decide / second).
 *
 * j / k move between rows and Enter takes a row's main action.
 */

const PENDING_PAGE = 100;

function useNow(intervalMs: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** j/k/Enter over `[data-inbox-row]`, ignored while typing or with a dialog open. */
function useKeyboardTriage(): void {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest("input, textarea, select, [contenteditable=true]") || target.closest("[role=dialog]"))) return;
      if (event.key !== "j" && event.key !== "k" && event.key !== "Enter") return;
      const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-inbox-row]"));
      if (rows.length === 0) return;
      const at = rows.findIndex((row) => row === document.activeElement);
      if (event.key === "Enter") {
        if (at === -1) return;
        event.preventDefault();
        rows[at]!.querySelector<HTMLElement>("[data-primary]")?.click();
        return;
      }
      event.preventDefault();
      const next = event.key === "j" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at === -1 ? 0 : at - 1);
      rows[next]!.focus();
      rows[next]!.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export default function OperatorHome() {
  const me = useOperatorSession();
  const caps = capabilitiesFor(me.roles);
  const queryClient = useQueryClient();
  const now = useNow(10_000);
  const intro = useRoleIntro(me.id);
  const providers = useProviderNames();
  useKeyboardTriage();

  // Same key as the shell's badge, so the two never disagree.
  const pending = useQuery({
    queryKey: ["operator", "approvals", "pending-count"],
    queryFn: () => listApprovals({ status: "PENDING", limit: PENDING_PAGE }),
    refetchInterval: 30_000,
    retry: 0,
  });
  const disputes = useQuery({
    queryKey: ["operator", "arbiter", "disputes"],
    queryFn: listArbiterDisputes,
    enabled: caps.rule,
    refetchInterval: 60_000,
    retry: 0,
  });
  const health = useQuery({
    queryKey: ["operator", "health"],
    queryFn: getPlatformHealth,
    refetchInterval: 60_000,
    retry: 0,
  });
  const activeBlocks = useQuery({
    queryKey: ["operator", "blocks", "active-count"],
    queryFn: () => listAccountBlocks({ active: true, limit: 100 }),
    retry: 0,
  });

  const groups = React.useMemo(() => groupApprovals(pending.data?.items ?? [], me, now), [pending.data, me, now]);
  const { context, approversFor, nameOf } = useApprovalContext([...groups.needsYou, ...groups.yours], me);
  const disputeRows = React.useMemo(() => sortDisputesByDaysLeft(disputes.data ?? []), [disputes.data]);
  const holds = sortHoldsOldestFirst(health.data?.slashHolds ?? []);
  const blockCount = activeBlocks.data?.items.length ?? null;

  const lastChecked = Math.max(pending.dataUpdatedAt, disputes.dataUpdatedAt, health.dataUpdatedAt);
  const refreshing = pending.isFetching || disputes.isFetching || health.isFetching;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["operator", "approvals"] });
    void queryClient.invalidateQueries({ queryKey: ["operator", "arbiter", "disputes"] });
    void queryClient.invalidateQueries({ queryKey: ["operator", "health"] });
    void queryClient.invalidateQueries({ queryKey: ["operator", "blocks"] });
  };

  const [results, setResults] = React.useState<ApprovalResult[]>([]);
  const onDecided = React.useCallback((result: ApprovalResult) => setResults((list) => [result, ...list.filter((r) => r.id !== result.id)]), []);

  const needsYouTotal = needsYouCount(groups.needsYou.length, disputeRows.length, caps.rule);
  const loading = pending.isLoading || (caps.rule && disputes.isLoading);

  return (
    <>
      <header className="flex w-full flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Needs you{needsYouTotal > 0 ? ` · ${needsYouTotal}` : ""}</h1>
          <p className="text-body-13 text-03" aria-live="polite">
            {caps.rule && needsYouTotal > 0
              ? `${groups.needsYou.length} approval${groups.needsYou.length === 1 ? "" : "s"} · ${disputeRows.length} dispute${disputeRows.length === 1 ? "" : "s"} · `
              : ""}
            {lastChecked > 0 ? checkedAgo(lastChecked, now) : "checking…"}
            <span className="hidden tablet:inline"> · keys: j / k to move, Enter to act</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/operator/approvals">
              All approvals{groups.yours.length + groups.others.length > 0 ? ` · ${groups.needsYou.length + groups.yours.length + groups.others.length} open` : ""}
            </Link>
          </Button>
          {!intro.open ? (
            <Button type="button" variant="ghost" size="sm" onClick={intro.show}>
              What can I do?
            </Button>
          ) : null}
          <Button type="button" variant="secondary" size="sm" loading={refreshing} icon={<RefreshCw aria-hidden="true" />} onClick={refresh}>
            Refresh
          </Button>
        </div>
      </header>

      {intro.open ? <RoleIntro identity={me} waiting={groups.needsYou.length} onDismiss={intro.dismiss} /> : null}

      <HealthStrip health={health.data} error={health.isError} />

      {results.map((result) => (
        <ResultCard
          key={result.id}
          title={result.title}
          next={result.next}
          activityHref={result.activityHref}
          onDismiss={() => setResults((list) => list.filter((r) => r.id !== result.id))}
        />
      ))}

      {loading ? (
        <PageState kind="loading" rows={3} label="Loading what needs you" />
      ) : pending.isError ? (
        <PageState
          kind="error"
          description={approvalErrorMessage(pending.error, "list")}
          onRetry={() => void pending.refetch()}
          code={pending.error instanceof ApiError ? pending.error.code : null}
          details={pending.error instanceof Error ? pending.error.message : null}
        />
      ) : needsYouTotal === 0 ? (
        <PageState
          kind="empty"
          title="Nothing needs you"
          description={`${checkedAgo(lastChecked || now, now).replace(/^c/, "C")}. New requests and disputes appear here on their own.`}
        />
      ) : (
        <>
          {groups.needsYou.length > 0 ? (
            <section aria-labelledby="needs-approval" className="flex w-full flex-col gap-2.5">
              <h2 id="needs-approval" className="text-label-md text-01">
                Waiting for your approval · {groups.needsYou.length}
              </h2>
              {groups.needsYou.map((approval) => (
                <ApprovalItem
                  key={approval.id}
                  approval={approval}
                  context={context}
                  mode="decide"
                  onDecided={onDecided}
                  approvers={approversFor(approval)}
                  nameOf={nameOf}
                  compact
                />
              ))}
            </section>
          ) : null}

          {caps.rule && disputeRows.length > 0 ? (
            <section aria-labelledby="needs-ruling" className="flex w-full flex-col gap-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="needs-ruling" className="text-label-md text-01">
                  Disputes to rule · {disputeRows.length}
                </h2>
                <p className="text-body-xs text-03">fewest days left first · unruled after 30 days, the stake is released</p>
              </div>
              {disputeRows.map((row) => (
                <DisputeLine key={row.requestId} row={row} providerName={providers.name(row.providerId)} now={now} canRule />
              ))}
            </section>
          ) : null}
        </>
      )}

      {caps.rule && disputes.isError ? (
        <PageState
          kind="error"
          title="Disputes could not be loaded"
          description="The on-chain disputes could not be read. Approvals above are still current."
          onRetry={() => void disputes.refetch()}
          code={disputes.error instanceof ApiError ? disputes.error.code : null}
        />
      ) : null}

      {groups.yours.length > 0 ? (
        <section aria-labelledby="your-requests" className="flex w-full flex-col gap-1.5 rounded-lg border border-01 bg-01 px-3.5 py-3">
          <h2 id="your-requests" className="text-label-13 text-01">
            Your request{groups.yours.length === 1 ? "" : "s"} waiting for someone else · {groups.yours.length}
          </h2>
          <ul className="flex flex-col gap-1">
            {groups.yours.slice(0, 3).map((approval) => {
              const names = approverNames(approversFor(approval));
              const expiry = expiryReading(approval.createdAt, approval.expiresAt, now);
              return (
                <li key={approval.id} className="text-body-13 text-02 [overflow-wrap:anywhere]">
                  <Link href={approvalHref(approval.id)} className="text-01 hover:underline">
                    {describeApproval(approval, context).sentence}
                  </Link>{" "}
                  <span className="text-03">
                    · {names ? `waiting for ${names}` : "waiting for an approver"}
                    {expiry ? ` · ${expiry.label.toLowerCase()}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
          {groups.yours.length > 3 ? (
            <Link href="/operator/approvals" className="text-label-13 text-primary-600 hover:underline">
              See all {groups.yours.length}
            </Link>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="watching" className="flex w-full flex-col gap-2.5">
        <h2 id="watching" className="text-label-md text-01">
          On watch
        </h2>
        <div className="grid w-full grid-cols-1 gap-2.5 tablet:grid-cols-2">
          <Link
            href="/operator/blocks"
            className="flex flex-col gap-0.5 rounded-xl border border-01 bg-01 p-4 hover:border-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <span className="text-label-13 text-01">Active blocks</span>
            <span className="font-mono text-mono-sm text-01">{blockCount === null ? "—" : blockCount}</span>
            <span className="text-body-xs text-03">accounts that cannot use Assay right now</span>
          </Link>
          <details className="group flex flex-col rounded-xl border border-01 bg-01 p-4">
            <summary className="flex cursor-pointer list-none flex-col gap-0.5">
              <span className="text-label-13 text-01">Slash holds</span>
              <span className="font-mono text-mono-sm text-01">{health.data?.slashHolds === undefined ? "—" : holds.length}</span>
              <span className="text-body-xs text-03">
                providers not routed while a penalty cannot be collected · lifts by itself
                {holds.length > 0 ? <span className="text-primary-600 group-open:hidden"> · show</span> : null}
              </span>
            </summary>
            {holds.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2 border-t border-01 pt-3">
                {holds.map((hold) => (
                  <li key={`${hold.providerId}:${hold.chainId}`} className="flex flex-col gap-0.5 text-body-13">
                    <span className="text-01">
                      {providers.name(hold.providerId)} · {holdChainName(hold.chainId)}
                    </span>
                    <span className="text-body-xs text-03">
                      {hold.reasons.map((reason) => operatorHoldReasonText(reason).replace(/\s*\([A-Z_]+\)$/, "")).join("; ")} · since{" "}
                      <LocalTime value={hold.heldSince} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </details>
        </div>
      </section>
    </>
  );
}
