"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, ChevronRight, RefreshCw, Search, ShieldBan, UserPlus } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { shortId } from "@/components/patterns/copy-chip";
import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ApprovalItem, ApprovedChainBlockAction, RowSection, type ApprovalResult } from "@/features/operator/approval-item";
import { approvalErrorMessage } from "@/features/operator/approvals";
import { disputeAmount, possessive } from "@/features/operator/arbiter";
import { chainDisplayName } from "@/features/operator/call-summary";
import { Deadline } from "@/features/operator/deadline";
import { DisputeLine } from "@/features/operator/dispute-line";
import { HealthStrip } from "@/features/operator/health-strip";
import { checkedAgo, groupApprovals, needsYouBreakdown, needsYouCount, sortDisputesByDaysLeft, waitingSummary } from "@/features/operator/inbox";
import { ResultCard } from "@/features/operator/result-card";
import { RoleIntro, useRoleIntro } from "@/features/operator/role-intro";
import { capabilitiesFor } from "@/features/operator/roles";
import { useOperatorSession } from "@/features/operator/session-context";
import { useKeyboardTriage } from "@/features/operator/shortcuts";
import { sortHoldsOldestFirst } from "@/features/operator/slash-holds-panel";
import { useApprovalContext } from "@/features/operator/use-approval-context";
import { useOperatorDirectory, useProviderNames } from "@/features/operator/use-operator-lookups";
import { useToSign } from "@/features/operator/use-to-sign";
import { holdChainName } from "@/features/slash-hold/model";
import { ApiError } from "@/libs/ApiClient";
import { operatorHoldReasonText } from "@/libs/slash-hold";
import { getPlatformHealth, listAccountBlocks, listApprovals, listArbiterDisputes } from "@/services/operator.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

/**
 * Home, route `/operator`: the "Needs you" inbox.
 *
 * Flat lists, in the order things can be lost: requests this operator can
 * approve (closest to expiring first), then — for whoever can rule — on-chain
 * disputes by days left and what the arbiter's wallet still has to sign
 * (approved on-chain blocks, earlier penalties to cancel before anyone can
 * execute them), then their own requests waiting on someone else.
 * Under them "At a glance": four counts, each a link. Platform health is one
 * line that opens only when something is red. Each role gets its one way in
 * to its own work (Block an account, Add someone, Find a penalty).
 *
 * Not here, on purpose:
 *  - Penalties waiting for a cancel signature (CANCEL_REQUESTED). The backend
 *    has no endpoint that lists them; each one shows on its penalty page with
 *    its deadline. [backend] `GET /operator/cases`, then a group here.
 *  - The retired off-chain objection queue (claim / decide / second).
 *
 * j / k move between rows and Enter takes a row's main action (`?` lists the keys).
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

/** "All approvals →": a text link that reads as one. */
function ViewAll({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="touch-target inline-flex items-center gap-1 text-label-13 text-primary-700 underline-offset-2 hover:underline">
      {children}
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  );
}

/** The role's one way in to its own work. */
function QuickAction({ caps }: { caps: ReturnType<typeof capabilitiesFor> }) {
  if (caps.manageOperators) {
    return (
      <Button asChild size="sm" variant="secondary" className="touch-target" icon={<UserPlus aria-hidden="true" />}>
        <Link href="/operator/operators?new=1">Add someone</Link>
      </Button>
    );
  }
  if (caps.block && !caps.rule) {
    return (
      <Button asChild size="sm" variant="secondary" className="touch-target" icon={<ShieldBan aria-hidden="true" />}>
        <Link href="/operator/blocks?new=1">Block an account</Link>
      </Button>
    );
  }
  return (
    <Button asChild size="sm" variant="secondary" className="touch-target" icon={<Search aria-hidden="true" />}>
      <Link href="/operator/cases">Find a penalty</Link>
    </Button>
  );
}

const TILE =
  "flex min-w-0 items-center gap-3 rounded-xl border border-01 bg-01 px-4 py-3 text-left hover:border-02 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";

/**
 * One count. `opens` says what a click does, honestly: a tile that goes to a
 * page ends in a right chevron; one that opens a list in place, a down one.
 */
function Tile({ label, value, opens = "page" }: { label: string; value: number | null; opens?: "page" | "menu" }) {
  const Icon = opens === "menu" ? ChevronDown : ChevronRight;
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-body-xs text-03">{label}</span>
        <span className="text-heading-sm tabular-nums text-01">{value === null ? "—" : value}</span>
      </span>
      <Icon aria-hidden="true" className="size-4 shrink-0 text-03" />
    </>
  );
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
  const toSign = useToSign(caps.rule);
  const directory = useOperatorDirectory();
  const holds = sortHoldsOldestFirst(health.data?.slashHolds ?? []);
  const blockCount = activeBlocks.data?.items.length ?? null;
  const openApprovals = groups.needsYou.length + groups.yours.length + groups.others.length;
  const openDisputes = caps.rule ? (disputes.data ? disputeRows.length : null) : (health.data?.openDisputes ?? null);

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

  const needsYouTotal = needsYouCount(groups.needsYou.length, disputeRows.length, caps.rule, toSign.count);
  const breakdown = needsYouBreakdown(groups.needsYou.length, disputeRows.length, caps.rule, toSign.count);
  const loading = pending.isLoading || (caps.rule && (disputes.isLoading || toSign.isLoading));
  const nothing = needsYouTotal === 0 && groups.yours.length === 0;
  // Every waiting request, accounted for in one line: the same split and numbers as the Approvals tabs.
  const waiting = waitingSummary({ needsYou: groups.needsYou.length, yours: groups.yours.length, others: groups.others.length });

  return (
    <>
      <header className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="flex items-center gap-2 text-heading-md text-01">
            Needs you
            {needsYouTotal > 0 ? (
              <span className="rounded-full bg-danger-10 px-2 py-0.5 text-label-13 tabular-nums text-danger-700">
                {needsYouTotal}
              </span>
            ) : null}
          </h1>
          {breakdown ? <p className="text-body-13 tabular-nums text-03">{breakdown}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!nothing ? <QuickAction caps={caps} /> : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="touch-target"
            loading={refreshing}
            icon={<RefreshCw aria-hidden="true" />}
            onClick={refresh}
            aria-label={`Refresh, ${lastChecked > 0 ? checkedAgo(lastChecked, now) : "checking"}`}
          >
            <span aria-live="polite" className="tabular-nums">
              {lastChecked > 0 ? checkedAgo(lastChecked, now) : "checking…"}
            </span>
          </Button>
        </div>
      </header>

      {intro.open ? <RoleIntro identity={me} onDismiss={intro.dismiss} /> : null}

      <HealthStrip health={health.data} error={health.isError} />

      {results.map((result) => (
        <React.Fragment key={result.id}>
          <ResultCard
            title={result.title}
            next={result.next}
            activityHref={result.activityHref}
            onDismiss={() => setResults((list) => list.filter((r) => r.id !== result.id))}
          />
          {/* A-11: the approval's result is the arbiter's unsigned setBlocked; its wallet signs here, as on Approvals. */}
          {result.chainBlock ? <ApprovedChainBlockAction block={result.chainBlock} /> : null}
        </React.Fragment>
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
      ) : nothing ? (
        <div className="flex w-full flex-col items-center gap-3 rounded-xl border border-01 bg-01 px-4 py-8 text-center">
          <div className="flex flex-col gap-1">
            <p className="text-label-md text-01">Nothing needs you</p>
            <p className="text-body-13 text-03">
              {checkedAgo(lastChecked || now, now).replace(/^c/, "C")}. New requests{caps.rule ? " and disputes" : ""} appear here on their own.
            </p>
          </div>
          <QuickAction caps={caps} />
        </div>
      ) : (
        <>
          {needsYouTotal === 0 ? <p className="text-body-13 text-03">Nothing needs you right now.</p> : null}
          {groups.needsYou.length > 0 ? (
            <RowSection
              id="to-approve"
              title="To approve"
              count={groups.needsYou.length}
              hint="Requests your roles can approve (Waiting for you on Approvals), closest to expiring first."
            >
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
            </RowSection>
          ) : null}

          {caps.rule && disputeRows.length > 0 ? (
            <RowSection
              id="to-rule"
              title="To rule"
              count={disputeRows.length}
              hint="Fewest days left first. Unruled after 30 days, the penalty lapses and the stake is released."
              action={<ViewAll href="/operator/arbiter">Open Arbiter</ViewAll>}
            >
              {disputeRows.map((row) => (
                <DisputeLine key={row.requestId} row={row} providerName={providers.name(row.providerId)} now={now} canRule />
              ))}
            </RowSection>
          ) : null}

          {caps.rule && toSign.count > 0 ? (
            <RowSection
              id="to-sign"
              title="To sign"
              count={toSign.count}
              hint="Calls only the arbiter's wallet can sign: approved on-chain blocks, and earlier penalties to cancel before anyone can execute them."
              action={<ViewAll href="/operator/arbiter">Open Arbiter</ViewAll>}
            >
              {toSign.superseded.map((record) => {
                const amount = disputeAmount(record.chainId, record.penaltyAmount);
                return (
                  <Link key={record.requestId} href="/operator/arbiter#superseded-records" className="flex w-full min-w-0 flex-col gap-1 px-4 py-3 hover:bg-02 tablet:flex-row tablet:items-center tablet:gap-4">
                    <span className="min-w-0 flex-1 text-label-sm text-01">
                      Cancel {possessive(providers.name(record.providerId))} earlier {amount ? `${formatMoney(amount)} ` : ""}penalty
                      <span className="block text-body-xs font-normal text-03">
                        {chainDisplayName(record.chainId)} · it covers calls already in a later penalty, so executing it would charge them twice
                      </span>
                    </span>
                    <Deadline kind="execute" until={record.executableAt} now={now} />
                  </Link>
                );
              })}
              {toSign.blocks.map((block) => (
                <Link key={block.approvalId} href="/operator/arbiter#approved-blocks" className="flex w-full min-w-0 flex-col gap-1 px-4 py-3 hover:bg-02 tablet:flex-row tablet:items-center tablet:gap-4">
                  <span className="min-w-0 flex-1 text-label-sm text-01">
                    Block wallet {shortId(block.account)} on chain
                    <span className="block text-body-xs font-normal text-03">
                      {chainDisplayName(block.chainId)}
                      {block.approvedBy ? ` · approved by ${directory.nameOf(block.approvedBy)}` : ""} · nothing is blocked on chain until the arbiter signs
                    </span>
                  </span>
                </Link>
              ))}
            </RowSection>
          ) : null}

          {groups.yours.length > 0 ? (
            <RowSection
              id="waiting-on-others"
              title="Waiting on others"
              count={groups.yours.length}
              hint="Your requests, waiting for someone else to approve (Your requests on Approvals)."
            >
              {groups.yours.map((approval) => (
                <ApprovalItem
                  key={approval.id}
                  approval={approval}
                  context={context}
                  mode="own"
                  onDecided={onDecided}
                  approvers={approversFor(approval)}
                  nameOf={nameOf}
                  compact
                />
              ))}
            </RowSection>
          ) : null}
        </>
      )}

      {!loading && !pending.isError && waiting ? (
        <p className="flex w-full flex-wrap items-center gap-x-2 text-body-13 tabular-nums text-03">
          <span>{waiting}</span>
          <span aria-hidden="true">·</span>
          <ViewAll href="/operator/approvals">All approvals</ViewAll>
        </p>
      ) : null}

      {caps.rule && disputes.isError ? (
        <PageState
          kind="error"
          title="Disputes could not be loaded"
          description="The on-chain disputes could not be read. Approvals above are still current."
          onRetry={() => void disputes.refetch()}
          code={disputes.error instanceof ApiError ? disputes.error.code : null}
        />
      ) : null}

      <section aria-labelledby="at-a-glance" className="flex w-full flex-col gap-2">
        <h2 id="at-a-glance" className="text-label-13 text-02">
          At a glance
        </h2>
        <div className="grid w-full grid-cols-2 gap-2.5 desktop:grid-cols-4">
          <Link href="/operator/blocks" className={TILE}>
            <Tile label="Active blocks" value={blockCount} />
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(TILE, "w-full")} disabled={health.data?.slashHolds === undefined}>
              <Tile label="Slash holds" opens="menu" value={health.data?.slashHolds === undefined ? null : holds.length} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[min(360px,calc(100vw-32px))]">
              <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
                <span className="text-label-13 text-01">Slash holds</span>
                <span className="text-body-xs font-normal text-03">
                  Providers not routed while a penalty cannot be collected. Each lifts by itself.
                </span>
              </DropdownMenuLabel>
              {holds.length === 0 ? (
                <p className="px-2 pb-2 text-body-13 text-02">No provider is on a slash hold.</p>
              ) : (
                <ul className="flex flex-col gap-2 border-t border-01 px-2 py-2">
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
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Link href={caps.rule ? "/operator/arbiter" : "/operator/cases"} className={TILE}>
            <Tile label="Disputes open" value={openDisputes} />
          </Link>
          <Link href="/operator/approvals" className={TILE}>
            <Tile label="Approvals waiting" value={pending.data ? openApprovals : null} />
          </Link>
        </div>
      </section>
    </>
  );
}
