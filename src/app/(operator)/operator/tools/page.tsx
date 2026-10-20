"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { Search } from "@/components/ui/search";
import { mayAnswerToolRequests, mayEditContracts, pendingFor, publishedFirst, toolStatusText } from "@/features/operator/contract-editor";
import { ACCEPT_HANDOVER, AcceptRequestSheet, AnswerRequestSheet, NewToolSheet, type ToolRequestAnswer } from "@/features/operator/contract-sheets";
import { OperatorToolsTabs } from "@/features/operator/provider-tool-ui";
import { useOperatorSession } from "@/features/operator/session-context";
import type { OperatorToolSummary } from "@/interfaces/contracts";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { type OperatorToolRequestRow } from "@/services/operator-contracts.service";
import { cn } from "@/utils";
import { operatorQueries } from "@/features/operator/queries";

/**
 * Tools, route `/operator/tools`: the standard tools every provider serves
 * (design spec §7.5 "Editor", §7.10 Operator).
 *
 * One list: each tool with the version agents get by default, a "Draft"
 * chip when a change is being written, and "Waiting for approval" when a
 * publish or a default change waits for a second person. Above it, the tool
 * requests nobody has decided yet, each with "Create tool from it" (accepts
 * the request and opens the new draft tool in one step), "Decline" and, while
 * nobody has answered, "Answer" (marks it being reviewed). All three are the
 * one `PATCH`, whose role check is the server's; the buttons only show to the
 * roles it accepts.
 */

function Chip({ tone = "neutral", children }: { tone?: "neutral" | "warning" | "primary"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-label-xs",
        tone === "warning" ? "bg-warning-10 text-warning-700" : tone === "primary" ? "bg-primary-10 text-primary-700" : "bg-03 text-02",
      )}
    >
      {children}
    </span>
  );
}

function ToolsScreen() {
  const me = useOperatorSession();
  const router = useRouter();
  const canEdit = mayEditContracts(me.roles);
  const canAnswer = mayAnswerToolRequests(me.roles);
  const [q, setQ] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [accepting, setAccepting] = React.useState<OperatorToolRequestRow | null>(null);
  const [answering, setAnswering] = React.useState<{ request: OperatorToolRequestRow; answer: ToolRequestAnswer } | null>(null);
  // "Overdue" is read against the moment the page opened; the list refreshes on every visit.
  const [now] = React.useState(() => Date.now());

  const tools = useQuery({ ...operatorQueries.tools(), refetchOnMount: "always" });
  const requests = useQuery(operatorQueries.toolRequests());
  const pending = useQuery({
    ...operatorQueries.pendingApprovals(),
    refetchInterval: 30_000,
    retry: 0,
  });

  const needle = q.trim().toLowerCase();
  const rows = publishedFirst((tools.data?.tools ?? []).filter((t) => !needle || t.name.includes(needle) || t.category.includes(needle)));
  const waiting = requests.data?.items ?? [];

  return (
    <>
      <OperatorToolsTabs />
      <header className="flex w-full flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-heading-md text-01">Tools</h1>
          <p className="text-body-13 text-02">The standard tools every provider serves, and their versions.</p>
        </div>
        <div className="flex w-full flex-col gap-2 tablet:w-auto tablet:flex-row tablet:items-center">
          <div className="w-full tablet:w-[280px]">
            <Search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a tool" aria-label="Find a tool by name or topic" shortcut={null} autoComplete="off" spellCheck={false} />
          </div>
          {canEdit ? (
            <Button icon={<Plus aria-hidden="true" />} onClick={() => setCreating(true)}>
              New tool
            </Button>
          ) : null}
        </div>
      </header>

      {!canEdit ? (
        <p className="text-body-13 text-03">You can read the contracts. Writing and publishing them needs the Policy author or Policy approver role.</p>
      ) : null}

      {requests.isSuccess && waiting.length > 0 ? (
        <section aria-labelledby="requests-title" className="flex w-full flex-col gap-2">
          <h2 id="requests-title" className="text-label-md text-01">
            Tool requests to decide <span className="tabular-nums text-03">{waiting.length}</span>
          </h2>
          {canAnswer && !canEdit ? <p className="text-body-13 text-03">{ACCEPT_HANDOVER}</p> : null}
          <ul className="flex w-full flex-col divide-y divide-01 rounded-xl border border-01 bg-01">
            {waiting.map((request) => {
              const answered = request.status === "ACKNOWLEDGED";
              const overdue = !answered && Date.parse(request.firstResponseDueAt) < now;
              return (
                <li key={request.id} className="flex w-full flex-col gap-2 px-4 py-3 tablet:flex-row tablet:items-center tablet:justify-between">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-label-13 text-01 [overflow-wrap:anywhere]">
                      {request.title}
                      {request.status === "ACKNOWLEDGED" ? <span className="ml-2 rounded-full bg-03 px-2 py-0.5 text-label-xs text-02">Being reviewed</span> : null}
                    </span>
                    <span className="text-body-xs text-03">
                      {answered ? "Asked " : overdue ? <span className="text-danger-600">Answer overdue since </span> : "Answer due "}
                      <UtcTime value={answered ? request.createdAt : request.firstResponseDueAt} midSentence />
                      {request.expectedMonthlyCalls ? ` · about ${request.expectedMonthlyCalls.toLocaleString("en-US")} calls a month` : ""}
                    </span>
                  </div>
                  {canAnswer ? (
                    <div className="flex flex-wrap items-center gap-2 self-start tablet:shrink-0 tablet:self-auto">
                      {!answered ? (
                        <Button variant="ghost" onClick={() => setAnswering({ request, answer: "acknowledge" })}>
                          Answer
                        </Button>
                      ) : null}
                      <Button variant="ghost" onClick={() => setAnswering({ request, answer: "decline" })}>
                        Decline
                      </Button>
                      <Button variant="secondary" onClick={() => setAccepting(request)}>
                        Create tool from it
                      </Button>
                    </div>
                  ) : (
                    <span className="text-body-xs text-03">Support, Provider success or a Lead adjudicator can answer it.</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-label="Standard tools" className="flex w-full flex-col gap-2">
        {tools.isLoading ? (
          <PageState kind="loading" rows={5} label="Loading tools" />
        ) : tools.isError ? (
          <PageState kind="error" description="The tools could not be loaded." onRetry={() => void tools.refetch()} code={tools.error instanceof ApiError ? tools.error.code : null} />
        ) : rows.length === 0 ? (
          <PageState
            kind="empty"
            bare
            title={needle ? `No tool matches “${q.trim()}”` : "No standard tools yet"}
            description={needle ? "Search by the tool's name or its topic." : "A tool starts as a draft here, or from an accepted tool request."}
            {...(canEdit && !needle ? { action: { label: "New tool", onClick: () => setCreating(true) } } : {})}
          />
        ) : (
          <ul className="flex w-full flex-col divide-y divide-01 rounded-xl border border-01 bg-01">
            {rows.map((tool) => (
              <ToolRow key={tool.id} tool={tool} waiting={pendingFor(tool.id, pending.data?.items ?? [])} />
            ))}
          </ul>
        )}
      </section>

      <NewToolSheet open={creating} onClose={() => setCreating(false)} onCreated={(tool) => router.push(routes.operatorTool(tool.id))} />
      <AnswerRequestSheet
        request={answering?.request ?? null}
        answer={answering?.answer ?? "decline"}
        onClose={() => setAnswering(null)}
        onAnswered={() => {
          setAnswering(null);
          void requests.refetch();
        }}
      />
      <AcceptRequestSheet
        request={accepting}
        canWriteVersions={canEdit}
        onClose={() => setAccepting(null)}
        onAccepted={(toolId) => {
          const requestId = accepting?.id;
          setAccepting(null);
          void requests.refetch();
          void tools.refetch();
          if (toolId) router.push(routes.operatorTool(toolId, requestId));
        }}
      />
    </>
  );
}

function ToolRow({ tool, waiting }: { tool: OperatorToolSummary; waiting: ReturnType<typeof pendingFor> }) {
  return (
    <li>
      <Link
        href={routes.operatorTool(tool.id)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-mono-13 text-01 [overflow-wrap:anywhere]">{tool.name}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-body-xs text-03">
            <span>{toolStatusText(tool)}</span>
            <span aria-hidden="true">·</span>
            <span>{tool.category}</span>
            {tool.kind === "PROVIDER" ? <Chip>One maker&apos;s API</Chip> : null}
            {tool.hasDraft ? <Chip tone="primary">Draft</Chip> : null}
            {waiting.publish || waiting.current ? <Chip tone="warning">Waiting for approval</Chip> : null}
          </span>
        </span>
        <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-03" />
      </Link>
    </li>
  );
}

export default function OperatorToolsPage() {
  return (
    <React.Suspense fallback={null}>
      <ToolsScreen />
    </React.Suspense>
  );
}
