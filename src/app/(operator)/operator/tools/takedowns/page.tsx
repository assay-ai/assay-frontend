"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { ReasonChips } from "@/components/patterns/reason-chips";
import { UtcTime } from "@/components/patterns/utc-time";
import { Chip } from "@/components/toolsets/toolset-bits";
import { Button } from "@/components/ui/button";
import { Search } from "@/components/ui/search";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { confirmBlockedBy, cutoffView, mayConfirmCutoffs, mayTakeDownTools, MODERATION_NOTE_MIN, toolReviewErrorText } from "@/features/operator/provider-tool-review";
import { OperatorToolsTabs, TakeDownButton, takedownSearch } from "@/features/operator/provider-tool-ui";
import { ResultCard } from "@/features/operator/result-card";
import { useOperatorSession } from "@/features/operator/session-context";
import { approvalHref } from "@/features/operator/two-person";
import { useOperatorDirectory } from "@/features/operator/use-operator-lookups";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { confirmCutoff, listCutoffs, revertCutoff, type ModerationCutoff } from "@/services/operator-provider-tools.service";
import { toast } from "@/utils/toast";
import { operatorQueries } from "@/features/operator/queries";

/**
 * Provider tool takedowns — `/operator/tools/takedowns` (FR-18, A-25): a
 * takedown acts at once; a second operator confirms it within 72 hours
 * (A-18) or it is reverted. Rejecting a pending one, or lifting a confirmed
 * one (two-person), is A-19. A live provider tool can be found here by name
 * and taken down without a review (the same A-25 sheet); a standard tool
 * never can (D24).
 */

/** Find a live provider tool to take down. Only for a role that may (ADJ, ADJL, SRE). */
function FindToTakeDown({ onDone }: { onDone: (name: string) => void }) {
  const [q, setQ] = React.useState("");
  const tools = useQuery({ ...operatorQueries.tools(), enabled: q.trim() !== "" });
  const found = takedownSearch(tools.data?.tools ?? [], q);
  return (
    <section aria-labelledby="find-title" className="flex w-full flex-col gap-2">
      <h2 id="find-title" className="text-label-md text-01">
        Take a provider tool down
      </h2>
      <div className="w-full tablet:w-[360px]">
        <Search value={q} onChange={(e) => setQ(e.target.value)} placeholder="Provider tool name" aria-label="Find a provider tool by name or topic" shortcut={null} autoComplete="off" spellCheck={false} />
      </div>
      {q.trim() === "" ? null : tools.isPending ? (
        <p className="text-body-13 text-03">Searching…</p>
      ) : tools.isError ? (
        <p role="alert" className="text-body-13 text-danger-700">
          The tools could not be loaded. Try again.
        </p>
      ) : (
        <>
          {found.matches.length > 0 ? (
            <ul className="flex w-full flex-col divide-y divide-01 rounded-xl border border-01 bg-01">
              {found.matches.map((tool) => (
                <li key={tool.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <Link href={routes.operatorReview(tool.id)} className="inline-flex min-h-10 items-center font-mono text-mono-13 text-01 hover:underline [overflow-wrap:anywhere]">
                    {tool.name}
                  </Link>
                  <TakeDownButton tool={tool} size="sm" onDone={() => onDone(tool.name)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-13 text-03">No live provider tool matches “{q.trim()}”.</p>
          )}
          {found.standard.length > 0 ? (
            <p className="text-body-13 text-03">
              {found.standard.map((t) => t.name).join(", ")} {found.standard.length === 1 ? "is a standard tool" : "are standard tools"}: those can&apos;t be taken down. Block the provider, or pause its binding, instead.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Why a takedown is confirmed, or why it is rejected or lifted: never the same list. */
const CONFIRM_REASONS = [
  { value: "CONFIRMED_ABUSE", label: "Abuse confirmed" },
  { value: "OTHER", label: "Other" },
] as const;
const REVERT_REASONS = [
  { value: "NOT_ABUSE", label: "Not abuse" },
  { value: "FIXED_BY_OWNER", label: "Fixed by the owner" },
  { value: "OTHER", label: "Other" },
] as const;

interface ActionResult {
  title: string;
  next: string;
  href?: string;
  /** A lift that now waits for a second operator. */
  lifted?: string;
}

function ActionSheet({ cutoff, action, toolName, onClose, onDone }: { cutoff: ModerationCutoff | null; action: "confirm" | "revert"; toolName: string; onClose: () => void; onDone: (message: ActionResult) => void }) {
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<{ reason?: string; note?: string }>({});
  React.useEffect(() => {
    setReason("");
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
      if (answer.kind === "queued") return { title: "Sent for approval: lifting a confirmed takedown needs a second operator", next: "Nothing has happened yet: the tool stays down until a second operator approves the lift in Approvals.", href: approvalHref(answer.approval.approvalId), lifted: cutoff!.id };
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
      <SheetContent className="tablet:max-w-[520px]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHeader>
          <SheetTitle>{action === "confirm" ? `Confirm the takedown of ${toolName}?` : lifting ? `Lift the takedown of ${toolName}?` : `Reject the takedown of ${toolName}?`}</SheetTitle>
          <SheetDescription>
            {action === "confirm"
              ? "It stays down for good, until an operator lifts it with a second person's approval."
              : lifting
                ? "Two people agreed on it, so lifting it needs a second operator's approval."
                : "Rejecting restores the tool at once: it serves again as it did before."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-[18px] pb-5 pt-3">
          <ReasonChips label="Why" options={action === "confirm" ? CONFIRM_REASONS : REVERT_REASONS} value={reason} onChange={setReason} note={note} onNoteChange={setNote} noteMin={MODERATION_NOTE_MIN} noteMax={1000} errors={errors} />
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
  const [result, setResult] = React.useState<ActionResult | null>(null);
  // Lifts sent for approval on this page: the row says so instead of offering Lift again.
  const [liftsWaiting, setLiftsWaiting] = React.useState<ReadonlySet<string>>(new Set());
  const [now] = React.useState(() => Date.now());
  const cutoffs = useQuery({ queryKey: ["operator", "cutoffs", "TOOL", show], queryFn: () => listCutoffs({ pending: show === "pending" ? true : undefined, targetType: "TOOL" }), retry: 0 });
  const rows = (cutoffs.data ?? []).filter((c) => c.targetType === "TOOL");
  const nameOf = (c: ModerationCutoff) => c.targetName ?? "A removed provider tool";
  const canAct = mayConfirmCutoffs(me.roles);

  return (
    <>
      <OperatorToolsTabs />
      <header className="flex w-full flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-heading-md text-01">Provider tool takedowns</h1>
          <p className="text-body-13 text-02">A takedown acts at once. A second operator confirms it within 72 hours, or it is reverted. Take a provider tool down from its page, or find it below.</p>
          {!canAct ? <p className="text-body-13 text-03">You can see takedowns. Confirming, rejecting or lifting one needs an Adjudicator or a Lead adjudicator other than the one who took it down.</p> : null}
        </div>
        <Segmented value={show} onValueChange={(v) => setShow(v as "pending" | "all")} aria-label="Show" className="inline-flex rounded-md bg-03 p-0.5">
          <SegmentedItem value="pending">To confirm</SegmentedItem>
          <SegmentedItem value="all">All</SegmentedItem>
        </Segmented>
      </header>
      {mayTakeDownTools(me.roles) ? (
        <FindToTakeDown
          onDone={(name) => {
            toast.success(`${name} is down. A second operator confirms it here.`);
            void queryClient.invalidateQueries({ queryKey: ["operator", "cutoffs"] });
            void queryClient.invalidateQueries({ queryKey: ["operator", "tools"] });
          }}
        />
      ) : null}
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
                    {nameOf(c)}
                  </Link>
                  <Chip tone={view.tone}>{view.label}</Chip>
                </div>
                <p className="text-body-xs text-03">
                  By {directory.nameOf(c.actedBy)} <UtcTime value={c.actedAt} midSentence alwaysDay />
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
                    {liftsWaiting.has(c.id) ? (
                      <span className="text-body-13 text-primary-700">Lift waiting for a second operator&apos;s approval</span>
                    ) : (
                      <Button variant="secondary" size="sm" className="touch-target" onClick={() => setActing({ cutoff: c, action: "revert" })}>
                        {view.pending ? "Reject" : "Lift"}
                      </Button>
                    )}
                    {view.pending ? <span className="text-body-xs text-03">Reject restores the tool at once.</span> : null}
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
        toolName={acting ? nameOf(acting.cutoff) : ""}
        onClose={() => setActing(null)}
        onDone={(message) => {
          setResult(message);
          if (message.lifted) setLiftsWaiting((set) => new Set([...set, message.lifted!]));
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
