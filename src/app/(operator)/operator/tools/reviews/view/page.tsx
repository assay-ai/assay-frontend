"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { ReasonChips } from "@/components/patterns/reason-chips";
import { UtcTime } from "@/components/patterns/utc-time";
import { Chip } from "@/components/toolsets/toolset-bits";
import { Button } from "@/components/ui/button";
import {
  approveBlockedBy,
  checklistRows,
  isStaleReview,
  mayReviewTools,
  mayTakeDownTools,
  REJECT_REASONS,
  REVIEW_KIND_LABEL,
  shortHash,
  toolReviewErrorText,
} from "@/features/operator/provider-tool-review";
import { ReviewChanges, ReviewedVersion, TakedownSheet } from "@/features/operator/provider-tool-ui";
import { ResultCard } from "@/features/operator/result-card";
import { useOperatorSession } from "@/features/operator/session-context";
import { gateRows } from "@/features/provider-tools/model";
import { ScreenFindings } from "@/features/provider-tools/ui";
import { useSearchParam } from "@/hooks/useSearchParam";
import { ApiError } from "@/libs/ApiClient";
import { decideProviderToolReview, getProviderToolReview, type ReviewDetail } from "@/services/operator-provider-tools.service";
import { cn } from "@/utils";
import { toast } from "@/utils/toast";

/**
 * One provider tool review — `/operator/tools/reviews/view?id=` (design spec
 * §7.6): every word a model will read in the versions it covers (or the diff
 * of a change), the §7.6 checklist with what the screen decided, the publish
 * gate as it stands, and the decision.
 *
 * The decision is bound to the content hash the operator read. If the
 * provider changes the content meanwhile — seen by polling, or refused by
 * the server as TOOL_REVIEW_STALE — nothing is decided and the page asks to
 * read the new content first.
 */

const APPROVE_REASON = "PROVIDER_TOOL_APPROVED";

function ReviewScreen() {
  const id = useSearchParam("id");
  const me = useOperatorSession();
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: ["operator", "review", id], queryFn: () => getProviderToolReview(id), enabled: Boolean(id), retry: 0, refetchInterval: 30_000 });
  const [readHash, setReadHash] = React.useState<string | null>(null);
  // Another review opened in the same page: what was read was the other tool's content.
  React.useEffect(() => setReadHash(null), [id]);
  React.useEffect(() => {
    if (detail.data && readHash === null) setReadHash(detail.data.contentHash);
  }, [detail.data, readHash]);
  const [takingDown, setTakingDown] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);

  const back = (
    <Link href="/operator/tools/reviews" className="inline-flex min-h-10 items-center gap-1.5 self-start text-label-13 text-02 hover:text-01">
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      Reviews
    </Link>
  );
  if (detail.isPending) return <>{back}<PageState kind="loading" rows={6} label="Loading the review" /></>;
  if (detail.isError || !detail.data) {
    return (
      <>
        {back}
        <PageState kind="error" description={toolReviewErrorText(detail.error)} onRetry={() => void detail.refetch()} code={detail.error instanceof ApiError ? detail.error.code : null} />
      </>
    );
  }
  const review = detail.data;
  const tool = review.tool;
  const changedSinceRead = readHash !== null && readHash !== review.contentHash;
  const reread = () => {
    setReadHash(review.contentHash);
    window.scrollTo({ top: 0 });
  };
  const removed = Boolean(tool.removedAt) || tool.status === "REMOVED";

  return (
    <>
      {back}
      <header className="flex flex-col gap-1.5">
        <h1 className="break-all font-mono text-heading-md text-01">{tool.name}</h1>
        <div className="flex flex-wrap items-center gap-1.5 text-body-13 text-03">
          <Chip tone={review.kind === "CHANGE" ? "primary" : "neutral"}>{REVIEW_KIND_LABEL[review.kind] ?? review.kind}</Chip>
          {review.pending ? <Chip tone="warning">Waiting for a decision</Chip> : <Chip>{tool.review.label}</Chip>}
          {removed ? <Chip tone="danger">Taken down</Chip> : null}
          <span>
            @{tool.handle} · {tool.category}
            {tool.review.submittedAt ? (
              <>
                {" "}
                · sent <UtcTime value={tool.review.submittedAt} midSentence />
              </>
            ) : null}
          </span>
        </div>
      </header>

      {changedSinceRead ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-3 tablet:flex-row tablet:items-center tablet:justify-between" data-testid="review-stale">
          <p className="text-body-13 text-01">The provider changed what is under review after you opened it. Read the new content before you decide.</p>
          <Button variant="secondary" size="sm" className="touch-target" icon={<RefreshCw aria-hidden="true" />} onClick={reread}>
            I&apos;ll read the new content
          </Button>
        </div>
      ) : null}

      {done ? <ResultCard title={done} next="The provider is told, with your note." onDismiss={() => setDone(null)} /> : null}

      <section aria-labelledby="covered-title" className="flex w-full flex-col gap-2">
        <h2 id="covered-title" className="text-label-md text-01">
          {review.kind === "CHANGE" ? "The change under review" : "Everything it serves"}
        </h2>
        {review.kind === "CHANGE" ? <ReviewChanges changes={review.changes} /> : null}
        <div className="flex flex-col gap-2">
          {review.covered.map((v) => (
            <ReviewedVersion key={v.version} version={v} />
          ))}
        </div>
      </section>

      <Checklist review={review} />

      <section aria-labelledby="gate-title" className="flex w-full flex-col gap-2">
        <h2 id="gate-title" className="text-label-md text-01">
          Publish checks, now
        </h2>
        <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01 bg-01">
          {gateRows(review.gate, tool).map((row) => (
            <li key={row.requirement} className="flex items-start gap-2 px-3.5 py-2.5 text-body-13">
              {row.met ? <Check aria-hidden="true" className="mt-0.5 size-3.5 text-success-700" /> : <X aria-hidden="true" className="mt-0.5 size-3.5 text-danger-700" />}
              <span className={row.met ? "text-02" : "text-01"}>
                {row.label}
                {!row.met && row.detail ? <span className="block text-body-xs text-03">{row.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {review.pending && mayReviewTools(me.roles) && !removed ? (
        <DecisionPanel
          review={review}
          readHash={readHash ?? review.contentHash}
          blocked={changedSinceRead}
          onStale={() => {
            void detail.refetch();
          }}
          onDecided={(message) => {
            setDone(message);
            void queryClient.invalidateQueries({ queryKey: ["operator", "reviews"] });
            void detail.refetch();
          }}
        />
      ) : review.pending ? (
        <p className="text-body-13 text-03">Deciding needs an Adjudicator, a Lead adjudicator or a Policy author.</p>
      ) : null}

      {mayTakeDownTools(me.roles) && !removed && tool.visibility !== "PRIVATE" ? (
        <section className="flex flex-col gap-2 rounded-xl border border-danger-20 bg-01 px-4 py-3.5 tablet:flex-row tablet:items-center tablet:justify-between">
          <p className="text-body-13 text-02">Abuse that can&apos;t wait for a review decision? Take it down at once; a second operator confirms within 72 hours.</p>
          <Button variant="danger" onClick={() => setTakingDown(true)}>
            Take down
          </Button>
        </section>
      ) : null}
      <TakedownSheet
        toolId={tool.id}
        toolName={tool.name}
        open={takingDown}
        onOpenChange={setTakingDown}
        onDone={() => {
          toast.success(`${tool.name} is down. A second operator confirms it under Takedowns.`);
          void detail.refetch();
        }}
      />
    </>
  );
}

function Checklist({ review }: { review: ReviewDetail }) {
  const rows = checklistRows(review.checklist);
  return (
    <section aria-labelledby="checklist-title" className="flex w-full flex-col gap-2">
      <h2 id="checklist-title" className="text-label-md text-01">
        Review checklist
      </h2>
      <ul className="flex flex-col divide-y divide-01 rounded-lg border border-01 bg-01" data-testid="review-checklist">
        {rows.map((row) => (
          <li key={row.item} className="flex flex-col gap-1.5 px-3.5 py-3">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-label-13 text-01">{row.label}</span>
              <Chip tone={row.verdict === "PASS" ? "success" : row.verdict === "FAIL" ? "danger" : "warning"}>{row.verdictLabel}</Chip>
            </span>
            {row.detail ? <span className="text-body-13 text-02">{row.detail}</span> : null}
            <ScreenFindings findings={row.findings} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function DecisionPanel({
  review,
  readHash,
  blocked,
  onStale,
  onDecided,
}: {
  review: ReviewDetail;
  readHash: string;
  blocked: boolean;
  onStale: () => void;
  onDecided: (message: string) => void;
}) {
  const [decision, setDecision] = React.useState<"APPROVE" | "REJECT" | null>(null);
  const [tier, setTier] = React.useState<"VERIFIED" | "UNVERIFIED">("VERIFIED");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [ticket, setTicket] = React.useState("");
  const [errors, setErrors] = React.useState<{ reason?: string; note?: string }>({});
  const rows = checklistRows(review.checklist);
  const approveBlock = approveBlockedBy(rows, review.gate.passed);
  const semver = review.covered.map((v) => `v${v.semver}`).join(", ");

  const decide = useMutation({
    mutationFn: () =>
      decideProviderToolReview(review.tool.id, {
        decision: decision!,
        contentHash: readHash,
        reasonCode: decision === "APPROVE" ? APPROVE_REASON : reason,
        ...(decision === "APPROVE" ? { tier } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(ticket.trim() ? { ticketRef: ticket.trim() } : {}),
      }),
    onSuccess: (result) => {
      onDecided(
        result.decision === "APPROVE"
          ? `Approved: ${review.tool.name} ${result.approvedVersion ? "now serves the approved version" : "is listed"} in the catalogue`
          : `Rejected: ${review.tool.name} goes back to its provider with your note`,
      );
    },
    onError: (error) => {
      if (isStaleReview(error)) onStale();
    },
  });

  const submit = () => {
    if (decision === "REJECT") {
      const next: typeof errors = {};
      if (!reason) next.reason = "Pick what is wrong.";
      if (note.trim().length < 10) next.note = "Tell the provider what to fix, in a sentence or two.";
      setErrors(next);
      if (Object.keys(next).length > 0) return;
    }
    decide.mutate();
  };

  return (
    <section aria-labelledby="decide-title" className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 px-4 py-4" data-testid="review-decision">
      <header className="flex flex-col gap-0.5">
        <h2 id="decide-title" className="text-label-md text-01">
          Decide
        </h2>
        <p className="text-body-xs text-03">
          For the content you read ({semver}, content <span className="font-mono">{shortHash(readHash)}</span>). If it changes before you click, nothing is decided.
        </p>
      </header>
      <fieldset className="flex flex-col gap-2 tablet:flex-row">
        <legend className="sr-only">Decision</legend>
        {(["APPROVE", "REJECT"] as const).map((d) => (
          <label key={d} className={cn("flex flex-1 cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-label-13", decision === d ? "border-primary-500 bg-primary-10 text-01" : "border-02 text-02")}>
            <input type="radio" name="review-decision" className="accent-primary-500" checked={decision === d} onChange={() => setDecision(d)} />
            {d === "APPROVE" ? "Approve for the catalogue" : "Reject: changes needed"}
          </label>
        ))}
      </fieldset>

      {decision === "APPROVE" ? (
        <>
          {approveBlock ? <p className="text-body-13 text-danger-700">{approveBlock}</p> : null}
          <fieldset className="flex flex-col gap-1.5">
            <legend className="pb-1 text-label-13 text-01">Tier</legend>
            <div className="flex flex-wrap gap-2">
              {(["VERIFIED", "UNVERIFIED"] as const).map((t) => (
                <label key={t} className={cn("flex cursor-pointer items-center gap-2 rounded-full border px-3.5 text-label-13", tier === t ? "border-primary-500 bg-primary-10 text-01" : "border-02 text-02")}>
                  <input type="radio" name="review-tier" className="accent-primary-500" checked={tier === t} onChange={() => setTier(t)} />
                  {t === "VERIFIED" ? "Verified" : "Unverified"}
                </label>
              ))}
            </div>
            <p className="text-body-xs text-03">One maker&apos;s API is never Guaranteed.</p>
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className="text-label-13 text-01">Note to the provider (optional)</span>
            <textarea value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} className="rounded-md border border-02 bg-01 px-3 py-2 text-body-13 text-01" />
          </label>
        </>
      ) : null}
      {decision === "REJECT" ? (
        <ReasonChips label="What is wrong" options={REJECT_REASONS} value={reason} onChange={setReason} note={note} onNoteChange={setNote} noteLabel="What the provider must fix (they read this)" noteMin={10} noteMax={1000} errors={errors} />
      ) : null}
      {decision ? (
        <label className="flex flex-col gap-1.5 tablet:max-w-[320px]">
          <span className="text-label-13 text-01">Ticket (optional)</span>
          <input value={ticket} maxLength={128} onChange={(e) => setTicket(e.target.value)} className="min-h-10 rounded-md border border-02 bg-01 px-3 font-mono text-mono-12 text-01" />
        </label>
      ) : null}

      {decide.isError ? (
        <p role="alert" className="rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-2.5 text-body-13 text-danger-700">
          {toolReviewErrorText(decide.error)}
        </p>
      ) : null}
      <Button
        className="self-start"
        variant={decision === "REJECT" ? "danger" : "primary"}
        disabled={!decision || blocked || (decision === "APPROVE" && approveBlock !== null)}
        loading={decide.isPending}
        onClick={submit}
      >
        {decision === "REJECT" ? "Reject with this note" : `Approve ${semver}`}
      </Button>
      {blocked ? <p className="text-body-xs text-warning-700">Read the new content first (see above).</p> : null}
    </section>
  );
}

export default function OperatorReviewPage() {
  return (
    <React.Suspense fallback={null}>
      <ReviewScreen />
    </React.Suspense>
  );
}
