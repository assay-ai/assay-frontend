"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { ReasonChips } from "@/components/patterns/reason-chips";
import { UtcTime } from "@/components/patterns/utc-time";
import { Chip } from "@/components/toolsets/toolset-bits";
import { Button } from "@/components/ui/button";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { confirmBlockedBy, cutoffView, mayConfirmCutoffs, MODERATION_NOTE_MIN, toolReviewErrorText } from "@/features/operator/provider-tool-review";
import { OperatorToolsTabs } from "@/features/operator/provider-tool-ui";
import { ResultCard } from "@/features/operator/result-card";
import { useOperatorSession } from "@/features/operator/session-context";
import { approvalHref, queuedMessage } from "@/features/operator/two-person";
import { useOperatorDirectory } from "@/features/operator/use-operator-lookups";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { confirmCutoff, getProviderToolReview, listCutoffs, revertCutoff, type ModerationCutoff } from "@/services/operator-provider-tools.service";
import { toast } from "@/utils/toast";

/**
 * Provider tool takedowns — `/operator/tools/takedowns` (FR-18, A-25): a
 * takedown acts at once; a second operator confirms it within 72 hours
 * (A-18) or it is reverted. Rejecting a pending one, or lifting a confirmed
 * one (two-person), is A-19.
 */

const ACTION_REASONS = [
  { value: "CONFIRMED_ABUSE", label: "Abuse confirmed" },
  { value: "NOT_ABUSE", label: "Not abuse" },
  { value: "FIXED_BY_OWNER", label: "Fixed by the owner" },
  { value: "OTHER", label: "Other" },
] as const;

function ActionSheet({ cutoff, action, toolName, onClose, onDone }: { cutoff: ModerationCutoff | null; action: "confirm" | "revert"; toolName: string; onClose: () => void; onDone: (message: { title: string; next: string; href?: string }) => void }) {
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<{ reason?: string; note?: string }>({});
  React.useEffect(() => {
    setReason(action === "confirm" ? "CONFIRMED_ABUSE" : "");
    setNote("");
    setErrors({});
  }, [cutoff, action]);
  const run = useMutation({
    mutationFn: async () => {
      const body = { reasonCode: reason, note: note.trim() };
      if (action === "confirm") {
        await confirmCutoff(cutoff!.id, body);
        return { title: `Takedown of ${toolName} confirmed`, next: "It stays down until an operator lifts it (two-person)." };
      }
      const answer = await revertCutoff(cutoff!.id, body);
      if (answer.kind === "queued") return { title: "Sent for approval: lifting a confirmed takedown needs a second operator", next: queuedMessage(answer.approval), href: approvalHref(answer.approval.approvalId) };
      return { title: `${toolName} is back`, next: "It serves again as it did before the takedown." };
    },
    onSuccess: (message) => {
      onDone(message);
      onClose();
    },
  });
  const submit = () => {
    const next: typeof errors = {};
    if (!reason) next.reason = "Pick why.";
    if (note.trim().length < MODERATION_NOTE_MIN) next.note = `Write at least ${MODERATION_NOTE_MIN} characters.`;
    setErrors(next);
    if (Object.keys(next).length === 0) run.mutate();
  };
  const lifting = action === "revert" && Boolean(cutoff?.confirmedAt);
  return (
    <Sheet open={cutoff !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="tablet:max-w-[520px]">
        <SheetHeader>
          <SheetTitle>{action === "confirm" ? `Confirm the takedown of ${toolName}?` : lifting ? `Lift the takedown of ${toolName}?` : `Reject the takedown of ${toolName}?`}</SheetTitle>
          <SheetDescription>
            {action === "confirm"
              ? "It stays down for good, until an operator lifts it with a second person's approval."
              : lifting
                ? "Two people agreed on it, so lifting it needs a second operator's approval."
                : "It serves again at once, as it did before."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-[18px] pb-5 pt-3">
          <ReasonChips label="Why" options={ACTION_REASONS} value={reason} onChange={setReason} note={note} onNoteChange={setNote} noteMin={MODERATION_NOTE_MIN} noteMax={1000} errors={errors} />
          {run.isError ? (
            <p role="alert" className="text-body-13 text-danger-700">
              {toolReviewErrorText(run.error)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant={action === "confirm" ? "danger" : "primary"} loading={run.isPending} onClick={submit}>
              {action === "confirm" ? "Confirm the takedown" : lifting ? "Ask to lift it" : "Reject the takedown"}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TakedownsScreen() {
  const me = useOperatorSession();
  const directory = useOperatorDirectory();
  const queryClient = useQueryClient();
  const [show, setShow] = React.useState<"pending" | "all">("pending");
  const [acting, setActing] = React.useState<{ cutoff: ModerationCutoff; action: "confirm" | "revert" } | null>(null);
  const [result, setResult] = React.useState<{ title: string; next: string; href?: string } | null>(null);
  const [now] = React.useState(() => Date.now());
  const cutoffs = useQuery({ queryKey: ["operator", "cutoffs", show], queryFn: () => listCutoffs(show === "pending" ? true : undefined), retry: 0 });
  const rows = (cutoffs.data ?? []).filter((c) => c.targetType === "TOOL");
  // A cutoff names its tool by id only: read each one's name from its review record.
  const names = useQueries({
    queries: rows.map((c) => ({ queryKey: ["operator", "review", c.targetId], queryFn: () => getProviderToolReview(c.targetId), retry: 0, staleTime: 60_000 })),
  });
  const nameOf = (toolId: string) => names.find((q) => q.data?.tool.id === toolId)?.data?.tool.name ?? "A provider tool";
  const canAct = mayConfirmCutoffs(me.roles);

  return (
    <>
      <OperatorToolsTabs />
      <header className="flex w-full flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-heading-md text-01">Provider tool takedowns</h1>
          <p className="text-body-13 text-02">A takedown acts at once. A second operator confirms it within 72 hours, or it is reverted. Take a tool down from its review page.</p>
        </div>
        <Segmented value={show} onValueChange={(v) => setShow(v as "pending" | "all")} aria-label="Show" className="inline-flex rounded-md bg-03 p-0.5">
          <SegmentedItem value="pending">To confirm</SegmentedItem>
          <SegmentedItem value="all">All</SegmentedItem>
        </Segmented>
      </header>
      {result ? <ResultCard title={result.title} next={result.next} tone={result.href ? "queued" : "done"} link={result.href ? { href: result.href, label: "Open it in Approvals" } : undefined} onDismiss={() => setResult(null)} /> : null}
      {cutoffs.isPending ? (
        <PageState kind="loading" rows={3} label="Loading takedowns" />
      ) : cutoffs.isError ? (
        <PageState kind="error" description="The takedowns could not be loaded." onRetry={() => void cutoffs.refetch()} code={cutoffs.error instanceof ApiError ? cutoffs.error.code : null} />
      ) : rows.length === 0 ? (
        <PageState kind="empty" title={show === "pending" ? "Nothing to confirm" : "No provider tool was taken down"} description="Takedowns of tool sets and public names are in the same register; this list shows provider tools." />
      ) : (
        <ul className="flex w-full flex-col divide-y divide-01 rounded-xl border border-01 bg-01" data-testid="takedown-list">
          {rows.map((c) => {
            const view = cutoffView(c, now);
            const selfBlock = confirmBlockedBy(c, me);
            return (
              <li key={c.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={routes.operatorReview(c.targetId)} className="inline-flex min-h-10 items-center font-mono text-mono-13 text-01 hover:underline [overflow-wrap:anywhere]">
                    {nameOf(c.targetId)}
                  </Link>
                  <Chip tone={view.tone}>{view.label}</Chip>
                </div>
                <p className="text-body-xs text-03">
                  By {directory.nameOf(c.actedBy)} <UtcTime value={c.actedAt} midSentence />
                  {view.pending ? (
                    <>
                      {" "}
                      · reverted unless confirmed by <UtcTime value={c.confirmBy} midSentence />
                    </>
                  ) : null}
                  {c.confirmedBy ? ` · confirmed by ${directory.nameOf(c.confirmedBy)}` : ""}
                </p>
                <p className="text-body-13 text-02 [overflow-wrap:anywhere]">{c.note}</p>
                {canAct && !c.revertedAt ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {view.pending ? (
                      <Button variant="danger" size="sm" className="touch-target" disabled={selfBlock !== null} onClick={() => setActing({ cutoff: c, action: "confirm" })}>
                        Confirm
                      </Button>
                    ) : null}
                    <Button variant="secondary" size="sm" className="touch-target" onClick={() => setActing({ cutoff: c, action: "revert" })}>
                      {view.pending ? "Reject" : "Lift"}
                    </Button>
                    {selfBlock && view.pending ? <span className="text-body-xs text-03">{selfBlock}</span> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <ActionSheet
        cutoff={acting?.cutoff ?? null}
        action={acting?.action ?? "confirm"}
        toolName={acting ? nameOf(acting.cutoff.targetId) : ""}
        onClose={() => setActing(null)}
        onDone={(message) => {
          setResult(message);
          toast.success(message.title);
          void queryClient.invalidateQueries({ queryKey: ["operator", "cutoffs"] });
        }}
      />
    </>
  );
}

export default function OperatorTakedownsPage() {
  return (
    <React.Suspense fallback={null}>
      <TakedownsScreen />
    </React.Suspense>
  );
}
