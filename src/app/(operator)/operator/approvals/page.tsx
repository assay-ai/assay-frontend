"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import {
  actionLabel,
  approvalErrorMessage,
  approverRolesFor,
  approveBlockedBecause,
  approvedResultSentence,
  decisionText,
  describeApproval,
  isOwnRequest,
  rejectMode,
  showApprove,
  statusWord,
  type ApprovalContext,
} from "@/features/operator/approvals";
import { useOperatorSession } from "@/features/operator/session-context";
import type { OperatorApproval, OperatorApprovalStatus } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import {
  approveApproval,
  listAccountBlocks,
  listApprovals,
  listOperators,
  rejectApproval,
} from "@/services/operator.service";
import { cn } from "@/utils";

/**
 * The approvals inbox, route `/operator/approvals`.
 *
 * Two-person actions wait here for their second person. Approving re-runs the
 * queued request, as the requester, on the state as it is now; a failure
 * leaves it pending. Approve is never shown on your own request; Reject is
 * shown to anyone who could approve it, and to the requester as Withdraw.
 */

type Tab = "pending" | "history";
type HistoryFilter = "" | Exclude<OperatorApprovalStatus, "PENDING">;

const LIST_LIMIT = 50;
/** The API's page ceiling. Enough to name what a pending request is about. */
const LOOKUP_LIMIT = 100;

function when(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

interface Outcome {
  readonly approvalId: string;
  readonly tone: "success" | "error";
  readonly text: string;
  readonly result?: unknown;
}

function ApprovalsInbox() {
  const me = useOperatorSession();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const highlight = searchParams.get("id");

  // The tab lives in the URL, so a reload or a shared link keeps it.
  const tab: Tab = searchParams.get("tab") === "history" ? "history" : "pending";
  const setTab = React.useCallback(
    (next: Tab) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "history") params.set("tab", "history");
      else params.delete("tab");
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );
  const [historyFilter, setHistoryFilter] = React.useState<HistoryFilter>("");
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);

  const status: OperatorApprovalStatus | undefined =
    tab === "pending" ? "PENDING" : historyFilter || undefined;

  const list = useInfiniteQuery({
    queryKey: ["operator", "approvals", "list", tab, historyFilter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listApprovals({ status, cursor: pageParam, limit: LIST_LIMIT }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: 0,
  });

  const rows = React.useMemo(() => {
    const all = (list.data?.pages ?? []).flatMap((page) => page.items);
    // "All" history is the unfiltered list without what is still pending.
    return tab === "history" ? all.filter((row) => row.status !== "PENDING") : all;
  }, [list.data, tab]);

  // What the cards' targets name: a block's subject, an operator's name and
  // wallet. Read only when a listed request needs them; a miss falls back to
  // the id.
  const needsBlocks = rows.some((row) => row.action === "account.unblock");
  const needsOperators = rows.some((row) => row.action === "operator.change" || row.action === "operator.add");
  const blocksQuery = useQuery({
    queryKey: ["operator", "approvals", "lookup", "blocks"],
    queryFn: () => listAccountBlocks({ limit: LOOKUP_LIMIT }),
    enabled: needsBlocks,
    retry: 0,
  });
  const operatorsQuery = useQuery({
    queryKey: ["operator", "approvals", "lookup", "operators"],
    queryFn: () => listOperators({ limit: LOOKUP_LIMIT }),
    enabled: needsOperators,
    retry: 0,
  });
  const context = React.useMemo<ApprovalContext>(() => {
    const operators = operatorsQuery.data?.items ?? [];
    const withLimit = operators.find((op) => op.authorityLimit !== null)?.authorityLimit ?? me.authorityLimit;
    return {
      blocks: new Map((blocksQuery.data?.items ?? []).map((block) => [block.id, block])),
      operators: new Map(operators.map((op) => [op.id, op])),
      asset: withLimit ? { asset: withLimit.asset, decimals: withLimit.decimals } : null,
    };
  }, [blocksQuery.data, operatorsQuery.data, me.authorityLimit]);

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["operator", "approvals"] });
  }, [queryClient]);

  const approve = useMutation({
    mutationFn: (row: OperatorApproval) => approveApproval(row.id),
    onSuccess: (decision, row) => {
      const text = approvedResultSentence(row.action, decision.result);
      setOutcome({ approvalId: row.id, tone: "success", text, result: decision.result });
      toast.success(text);
      invalidate();
      // The action changed whatever it was about.
      void queryClient.invalidateQueries({ queryKey: ["operator"] });
    },
    onError: (error, row) => {
      setOutcome({ approvalId: row.id, tone: "error", text: approvalErrorMessage(error, "approve") });
      if (error instanceof ApiError && error.code === "OPERATOR_APPROVAL_NOT_PENDING") invalidate();
    },
  });

  const reject = useMutation({
    mutationFn: (row: OperatorApproval) => rejectApproval(row.id),
    onSuccess: (_decision, row) => {
      const text = isOwnRequest(row, me) ? "Request withdrawn." : "Request rejected. Nothing ran.";
      setOutcome({ approvalId: row.id, tone: "success", text });
      toast.success(text);
      invalidate();
    },
    onError: (error, row) => {
      setOutcome({ approvalId: row.id, tone: "error", text: approvalErrorMessage(error, "reject") });
      if (error instanceof ApiError && error.code === "OPERATOR_APPROVAL_NOT_PENDING") invalidate();
    },
  });

  const busyId = approve.isPending
    ? approve.variables?.id
    : reject.isPending
      ? reject.variables?.id
      : undefined;

  return (
    <>
      <header className="flex w-full flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Approvals</h1>
          <p className="text-body-sm text-03">
            two-person actions waiting for a second operator · each expires after 24 hours
          </p>
        </div>
      </header>

      <div role="tablist" aria-label="Approvals" className="flex gap-4 border-b border-01">
        {(["pending", "history"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => {
              setTab(value);
              setOutcome(null);
            }}
            className={cn(
              "-mb-px border-b-2 pb-2 text-label-13",
              tab === value ? "border-primary-500 text-01" : "border-transparent text-02 hover:text-01",
            )}
          >
            {value === "pending" ? "Pending" : "History"}
          </button>
        ))}
      </div>

      {tab === "history" ? (
        <div className="w-full max-w-[240px]">
          <Select
            label="Outcome"
            value={historyFilter}
            onChange={(e) => setHistoryFilter(e.target.value as HistoryFilter)}
          >
            <option value="">All decided</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected or withdrawn</option>
            <option value="EXPIRED">Expired</option>
          </Select>
        </div>
      ) : null}

      {/* A decided row leaves the pending list; its outcome stays on screen here. */}
      {outcome && !rows.some((row) => row.id === outcome.approvalId) ? (
        <OutcomeBox outcome={outcome} />
      ) : null}

      {list.isLoading ? (
        <p className="text-body-13 text-03">Loading…</p>
      ) : list.isError ? (
        <p className="text-body-13 text-danger-600" role="alert">
          {approvalErrorMessage(list.error, "list")}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          title={tab === "pending" ? "Nothing waiting" : "No history"}
          description={
            tab === "pending"
              ? "No two-person action is waiting for a second operator."
              : "No approval has been decided with this outcome yet."
          }
        />
      ) : (
        <div className="flex w-full flex-col gap-3">
          {rows.map((row) => (
            <ApprovalCard
              key={row.id}
              row={row}
              context={context}
              highlighted={row.id === highlight}
              own={isOwnRequest(row, me)}
              canApprove={showApprove(row, me)}
              approveBlocked={approveBlockedBecause(row, me)}
              reject={rejectMode(row, me)}
              busy={busyId === row.id}
              disabled={busyId !== undefined && busyId !== row.id}
              outcome={outcome?.approvalId === row.id ? outcome : null}
              onApprove={() => {
                setOutcome(null);
                approve.mutate(row);
              }}
              onReject={() => {
                setOutcome(null);
                reject.mutate(row);
              }}
            />
          ))}
        </div>
      )}

      {list.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={list.isFetchingNextPage}
          onClick={() => list.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </>
  );
}

function ApprovalCard({
  row,
  context,
  highlighted,
  own,
  canApprove,
  approveBlocked,
  reject,
  busy,
  disabled,
  outcome,
  onApprove,
  onReject,
}: {
  row: OperatorApproval;
  context: ApprovalContext;
  highlighted: boolean;
  own: boolean;
  canApprove: boolean;
  approveBlocked: string | null;
  reject: ReturnType<typeof rejectMode>;
  busy: boolean;
  disabled: boolean;
  outcome: Outcome | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { sentence, target, fields } = describeApproval(row, context);
  const approverRoles = approverRolesFor(row.code);
  return (
    <Panel id={`approval-${row.id}`} className={cn("w-full", highlighted && "ring-2 ring-primary-500")}>
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>{actionLabel(row.action)}</PanelTitle>
          <PanelDescription>
            {row.code} · {row.action} · {statusWord(row)}
          </PanelDescription>
        </PanelTitles>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-3 p-4 tablet:p-5">
        <p className="text-body-13 text-01 [overflow-wrap:anywhere]">{sentence}</p>
        <dl className="grid w-full grid-cols-1 gap-x-6 gap-y-1.5 text-body-13 tablet:grid-cols-[160px_1fr]">
          <dt className="text-label-13 text-02">Target</dt>
          <dd className="break-all text-01">
            {target.href ? (
              <Link href={target.href} className="text-primary-600 hover:underline">
                {target.label}
              </Link>
            ) : (
              target.label
            )}
          </dd>
          <dt className="text-label-13 text-02">Requested by</dt>
          <dd className="text-01">
            {row.requestedBy}
            {own ? <span className="text-03"> (you)</span> : null} · {when(row.createdAt)}
          </dd>
          {row.status === "PENDING" ? (
            <>
              <dt className="text-label-13 text-02">Expires</dt>
              <dd className="text-01">{when(row.expiresAt)}</dd>
            </>
          ) : (
            <>
              <dt className="text-label-13 text-02">Decided</dt>
              <dd className="text-01">
                {decisionText(row)} · {when(row.decidedAt ?? row.expiresAt)}
              </dd>
            </>
          )}
          {fields.map((line) => (
            <React.Fragment key={line.label}>
              <dt className="text-label-13 text-02">{line.label}</dt>
              <dd className="text-01 [overflow-wrap:anywhere]">{line.value}</dd>
            </React.Fragment>
          ))}
        </dl>

        <details className="w-full">
          <summary className="cursor-pointer text-label-13 text-02 hover:text-01">Details</summary>
          <div className="mt-2">
            <CodeBlock
              title={`${row.action} · ${row.target}`}
              code={JSON.stringify({ id: row.id, target: row.target, payload: row.payload }, null, 2)}
            />
          </div>
        </details>

        {row.status === "PENDING" ? (
          <div className="flex flex-wrap items-center gap-2.5">
            {canApprove ? (
              <Button
                type="button"
                loading={busy}
                disabled={disabled || approveBlocked !== null}
                onClick={onApprove}
              >
                Approve and run
              </Button>
            ) : null}
            {reject ? (
              <Button
                type="button"
                variant="secondary"
                disabled={disabled || busy}
                onClick={onReject}
              >
                {reject === "withdraw" ? "Withdraw" : "Reject"}
              </Button>
            ) : null}
            {own ? (
              <span className="text-body-xs text-03">
                You asked for this, so a different operator must approve it
                {approverRoles ? `: one who holds ${approverRoles.join(" or ")}` : ""}.
              </span>
            ) : approveBlocked ? (
              <span className="text-body-xs text-03">{approveBlocked}</span>
            ) : null}
          </div>
        ) : null}

        {outcome ? <OutcomeBox outcome={outcome} /> : null}
      </PanelBody>
    </Panel>
  );
}

function OutcomeBox({ outcome }: { outcome: Outcome }) {
  return (
    <div
      role={outcome.tone === "error" ? "alert" : "status"}
      className={cn(
        "flex w-full flex-col gap-2 rounded-md border p-3",
        outcome.tone === "error" ? "border-danger-20 bg-danger-10" : "border-success-20 bg-success-10",
      )}
    >
      <p className={cn("text-body-13", outcome.tone === "error" ? "text-danger-600" : "text-01")}>
        {outcome.text}
      </p>
      {outcome.result !== undefined ? (
        <CodeBlock title="Result" code={JSON.stringify(outcome.result, null, 2)} />
      ) : null}
    </div>
  );
}

export default function ApprovalsPage() {
  // `useSearchParams()` needs a Suspense boundary to build.
  return (
    <React.Suspense fallback={null}>
      <ApprovalsInbox />
    </React.Suspense>
  );
}
