"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, FlaskConical, Flag, LayoutGrid, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { count, DASH, stampUtc } from "@/features/g34a/stats";
import { badgeForVerdict, scoreText } from "@/features/provider-verdicts/format";
import type {
  ProviderVerdictDetail,
  VerdictStageResult,
  VerifierVote,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { getProviderVerdict } from "@/services";
import { formatMoney } from "@/utils/money";
import { shortBindingId } from "@/utils/provider-label";
import { presentVerdict } from "@/utils/verdict";

/**
 * Verdict detail — route
 * `/provider/bindings/[bindingId]/verdicts/[verdictId]`.
 *
 * Per the backend controller's own docstring, `GET /providers/me/verdicts/:id`
 * is **deliberately not the evidence pack** — the bodies (mapped request,
 * upstream response, mapped output) live behind `evidenceUrl`
 * (`/providers/me/verdicts/{id}/evidence`, the evidence pack screen, owned by another screen).
 * This page reads the decomposition and the production consequence — what
 * this route actually carries — and links out for the bodies rather than
 * fetching or fabricating them.
 *
 * ## What the design's "five panes" narrative shows here, and doesn't
 *
 * The mapping tester design draws five numbered panes: mapped request,
 * upstream response, mapped output, coverage, verdict. This screen's own
 * frame borrows that chrome, and the note banner at the top says so
 * ("Deliberately the same five panes as the tester"). Panes 1–3 are body
 * content this route does not carry at all — they render as a hand-off card
 * pointing at `evidence`, not an empty box pretending to have tried. Panes 4
 * and 5 are real: `stageResults` + `verifiers` (the decomposition) and
 * `consequence` (the money).
 *
 * ## Gaps between the design's example and what this route can back
 *
 * - **"binding v3"** — `bindingVersion` does not exist on this DTO either
 *   (nor on the feed's row; see that screen's comment). Rendered `DASH`.
 * - **"counted toward w_4482"** — `windowId`/`countedTowardWindow` are on the
 *   FEED row (`ProviderVerdictListItemDto`) but **not** on this detail DTO.
 *   There is no way for this screen to say which window a call counted
 *   toward. Omitted rather than guessed.
 * - **The four coloured "production consequence" boxes** in the frame narrate
 *   one specific example call (an empty upstream array, a griefing-exclusion
 *   note) that this screen has no way to reproduce for an arbitrary verdict —
 *   the specifics live in the evidence pack this route does not read. What
 *   is rendered instead is the same STRUCTURE (credited / strike / buyer
 *   outcome) built from real fields (`consequence.strike`,
 *   `settlementOutcome`, the four money fields), in the same tone, rather
 *   than the frame's literal sentences.
 * - **"Weight"** on the decomposition table. The tester's coverage table has
 *   a per-rule `weight` (`VerificationRuleResult.weight`, a different DTO).
 *   This route's `verifiers[]` is `VerifierVoteDto`, which carries `score`
 *   and `costUsd` but no `weight` — so the decomposition table here has no
 *   Weight column to show, rather than a fabricated one.
 * - **"Flag as platform defect"** has no backing endpoint at the verdict
 *   level — `POST /providers/me/slash-proposals/:id/dispute` takes
 *   a *slash proposal* id, not a verdict id, and no route maps one to the
 *   other. Rendered disabled with the reason in its tooltip, per the
 *   provider-flags precedent (`provider/flags/page.tsx`'s "Flag" column).
 * - **"Open in tester"** genuinely works — it is a real link to
 *   `/provider/bindings/{bindingId}/test` — but does not, and cannot, preload
 *   this call's actual input: the tester has no case-loading capability (see
 *   that screen's own docstring).
 */

interface StageRow extends TableRowData {
  stage: VerdictStageResult;
}

const STAGE_COLUMNS: TableColumn<StageRow>[] = [
  { key: "stage", header: "Stage", cell: (r) => r.stage.stage, mono: true },
  {
    key: "status",
    header: "Status",
    cell: (r) => (
      <span className={r.stage.passed ? undefined : "text-danger-600"}>{r.stage.label}</span>
    ),
    width: 140,
    mono: true,
  },
  {
    key: "detail",
    header: "Detail",
    cell: (r) => r.stage.detail ?? r.stage.note ?? DASH,
    width: 420,
    mono: true,
  },
  {
    key: "score",
    header: "Score",
    cell: (r) => scoreText(r.stage.score),
    width: 90,
    mono: true,
    align: "end",
  },
];

interface VerifierRow extends TableRowData {
  vote: VerifierVote;
}

/**
 * `VerifierOutcome` shares literal spellings (`PASS`, `FAIL`, `MISAPPLIED`)
 * with the call-level verdict vocabulary Foundations rule 03 forbids
 * showing raw — a different vocabulary, but the same three words a reviewer
 * would flag on sight. Humanized here the same way the tester humanizes
 * `StageStatus` (`LAYER_WORD` in `test/page.tsx`), rather than argued past.
 */
const OUTCOME_WORD: Record<VerifierVote["outcome"], string> = {
  PASS: "passed",
  FAIL: "failed",
  MISAPPLIED: "misapplied",
  UNAVAILABLE: "unavailable",
  ABSTAIN: "abstained",
};

const VERIFIER_COLUMNS: TableColumn<VerifierRow>[] = [
  { key: "verifierId", header: "Verifier", cell: (r) => r.vote.verifierId, mono: true },
  { key: "stage", header: "Stage", cell: (r) => r.vote.stage ?? DASH, width: 140, mono: true },
  {
    key: "outcome",
    header: "Outcome",
    cell: (r) => (
      <span className={r.vote.outcome === "FAIL" ? "text-danger-600" : undefined}>
        {OUTCOME_WORD[r.vote.outcome]}
      </span>
    ),
    width: 110,
    mono: true,
  },
  {
    key: "detail",
    header: "Detail",
    cell: (r) => r.vote.detail ?? DASH,
    width: 360,
    mono: true,
  },
  {
    key: "score",
    header: "Score",
    cell: (r) => scoreText(r.vote.score),
    width: 80,
    mono: true,
    align: "end",
  },
  {
    key: "cost",
    header: "Cost",
    cell: (r) => (r.vote.costUsd === 0 ? "$0" : `$${r.vote.costUsd.toFixed(4)}`),
    width: 80,
    mono: true,
    align: "end",
  },
];

/** `1 · MAPPED REQUEST` etc — a hand-off card, matching the tester's pane chrome, that points at evidence rather than pretending to have a body it does not carry. */
function HandoffPane({ caption, evidenceHref }: { caption: string; evidenceHref: string }) {
  return (
    <section className="flex h-[220px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-01 bg-01">
      <header className="flex w-full flex-col gap-[3px] border-b border-01 bg-02 px-3.5 py-[11px]">
        <h2 className="font-mono text-mono-2xs tracking-[1.1px] text-03">{caption}</h2>
      </header>
      <div className="flex w-full flex-1 flex-col items-start justify-center gap-2.5 p-3.5">
        <p className="font-mono text-mono-xs leading-[1.75] text-03">
          This route does not carry call bodies — they are kept in the evidence pack.
        </p>
        <Button variant="secondary" size="sm" asChild>
          <Link href={evidenceHref}>Open evidence pack</Link>
        </Button>
      </div>
    </section>
  );
}

function moneyOrDash(m: { amount: string; asset: string; decimals: number } | null): string {
  return m ? formatMoney(m, { decimals: 4 }) : DASH;
}

/** The four coloured boxes, built from real `consequence` fields — see the file docstring. */
function ConsequenceBoxes({ detail }: { detail: ProviderVerdictDetail }) {
  const c = detail.consequence;
  const boxes: { tone: "danger" | "warning" | "success" | "primary"; icon: React.ReactNode; text: string }[] = [];

  if (c.strike === true) {
    boxes.push({
      tone: "danger",
      icon: <CircleX aria-hidden="true" className="size-[15px]" />,
      text: `This call was NOT credited to you${c.providerAmount ? ` — ${moneyOrDash(c.providerAmount)} was not paid` : ""}.`,
    });
    boxes.push({
      tone: "warning",
      icon: <TriangleAlert aria-hidden="true" className="size-[15px]" />,
      text: "It counts as a strike against this binding's SLA windows.",
    });
  } else if (c.strike === false) {
    boxes.push({
      tone: "success",
      icon: <CircleCheck aria-hidden="true" className="size-[15px]" />,
      text: `This call was credited to you${c.providerAmount ? ` — ${moneyOrDash(c.providerAmount)}` : ""}.`,
    });
  } else {
    boxes.push({
      tone: "warning",
      icon: <TriangleAlert aria-hidden="true" className="size-[15px]" />,
      text: "This call has not settled yet — there is no strike/credit outcome to show.",
    });
  }

  if (c.settlementOutcome === "REFUND") {
    boxes.push({
      tone: "success",
      icon: <CircleCheck aria-hidden="true" className="size-[15px]" />,
      text: "The buyer was refunded. We did not keep the money.",
    });
  } else if (c.settlementOutcome === "VOID") {
    boxes.push({
      tone: "primary",
      icon: <TriangleAlert aria-hidden="true" className="size-[15px]" />,
      text: "This call was voided — nobody was charged.",
    });
  }

  const toneClass: Record<string, string> = {
    danger: "border-danger-20 bg-danger-10 text-danger-700",
    warning: "border-warning-20 bg-warning-10 text-warning-700",
    success: "border-success-20 bg-success-10 text-success-700",
    primary: "border-primary-20 bg-primary-10 text-primary-700",
  };

  return (
    <div className="flex w-full flex-col gap-2.5">
      {boxes.map((box, i) => (
        <div
          key={i}
          className={`flex w-full items-center gap-3 rounded-lg border p-[13px] ${toneClass[box.tone]}`}
        >
          {box.icon}
          <p className="min-w-0 flex-1 text-label-13">{box.text}</p>
        </div>
      ))}
    </div>
  );
}

export default function ProviderVerdictDetailPage() {
  const params = useParams<{ bindingId: string; verdictId: string }>();
  const { bindingId, verdictId } = params;

  const query = useQuery({
    queryKey: ["provider", "verdict", verdictId],
    queryFn: () => getProviderVerdict(verdictId),
    retry: 0,
  });
  const detail = query.data;

  if (query.isPending) {
    return <p className="font-mono text-mono-13 text-03">Loading verdict…</p>;
  }

  if (query.isError || !detail) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <EmptyState
        icon={null}
        title={notFound ? "This verdict could not be found" : "This verdict could not be loaded"}
        description={
          notFound
            ? "It may not exist, or it may not be a call you served."
            : query.error instanceof ApiError
              ? query.error.message
              : "The request failed."
        }
      />
    );
  }

  const presented = presentVerdict(detail.verdictStatus ?? undefined);
  const evidenceHref = `/provider/bindings/${bindingId}/verdicts/${verdictId}/evidence`;

  const stageRows: StageRow[] = detail.stageResults.map((stage) => ({
    id: stage.stage,
    stage,
  }));
  const verifierRows: VerifierRow[] = detail.verifiers.map((vote, i) => ({
    id: `${vote.verifierId}-${i}`,
    vote,
  }));

  return (
    <TooltipProvider delayDuration={150}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex w-full flex-col items-start gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/*
            The frame's title prints the raw token ("FAIL 0.40"). Foundations
            rule 03 forbids that everywhere else on this surface, and
            `ui/badge.tsx` has no `label` prop for exactly this reason — so
            this heading carries the id and score, the verdict is a Badge
            (closed vocabulary), and `presented.shownAs` below is the sentence
            a person actually reads. A deliberate divergence.
          */}
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="truncate text-heading-lg text-01">
              Verdict {shortBindingId(detail.id)}
            </h1>
            <Badge
              variant={badgeForVerdict({ verdictStatus: detail.verdictStatus, state: detail.state })}
              title={presented.shownAs}
            />
            <span className="font-mono text-mono-md font-semibold text-01">
              {scoreText(detail.score)}
            </span>
          </div>
          <p className="text-body-13 text-02">{presented.shownAs}</p>
          <p className="font-mono text-mono-12 text-03">
            {stampUtc(detail.createdAt)} UTC · binding v{DASH} · policy v
            {count(detail.decisionPolicyVersion)}
            {detail.sampleDisplay ? ` · sampled ${detail.sampleDisplay}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button variant="secondary" icon={<Flag aria-hidden="true" />} disabled>
                  Flag as platform defect
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[280px] border border-01 shadow-soft">
              <span className="text-body-13 text-02">
                Flagging a single call from here is not available yet. A dispute is filed against a
                penalty proposal, from its case page.
              </span>
            </TooltipContent>
          </Tooltip>

          <Button variant="primary" icon={<FlaskConical aria-hidden="true" />} asChild>
            <Link href={`/provider/bindings/${bindingId}/test`}>Open in tester</Link>
          </Button>
        </div>
      </header>

      {/* ── Note — same chrome as the tester's, on this screen's own claim ── */}
      <div className="flex w-full items-start gap-2.5 rounded-lg border border-primary-20 bg-primary-10 p-[15px]">
        <LayoutGrid aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-primary-600" />
        <p className="min-w-0 flex-1 text-body-13 leading-[1.6] text-primary-700">
          The same five panes as the tester, for a real call: what we sent, what your endpoint
          returned, and what each check concluded.
        </p>
      </div>

      {/* ── Panes 1-3 — hand off to the evidence pack ─────────────────────── */}
      <div className="flex w-full flex-col gap-3 tablet:flex-row">
        <HandoffPane caption="1 · MAPPED REQUEST" evidenceHref={evidenceHref} />
        <HandoffPane caption="2 · UPSTREAM RESPONSE" evidenceHref={evidenceHref} />
        <HandoffPane caption="3 · MAPPED OUTPUT" evidenceHref={evidenceHref} />
      </div>

      {/* ── 4 · Verdict decomposition ──────────────────────────────────── */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>4 · Verdict decomposition</PanelTitle>
            <PanelDescription>
              all four pipeline stages, always, then every verifier that actually voted
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-4 px-2.5 pb-3.5 pt-1.5">
          <Table caption="Pipeline stages" columns={STAGE_COLUMNS} rows={stageRows} />

          {verifierRows.length > 0 ? (
            <Table caption="Verifier votes" columns={VERIFIER_COLUMNS} rows={verifierRows} />
          ) : (
            <p className="px-3 py-2 font-mono text-mono-13 text-03">
              No verifier voted on this call.
            </p>
          )}

          {detail.tally ? (
            <p className="px-3 font-mono text-mono-12 text-03">
              tally: {detail.tally.passed} passed · {detail.tally.failed} failed ·{" "}
              {detail.tally.misapplied} misapplied · {detail.tally.unavailable} unavailable ·{" "}
              {detail.tally.abstained} abstained of {detail.tally.declared} declared (
              {detail.tally.votes} voted)
            </p>
          ) : null}

          {detail.decidedBy?.label ? (
            <p className="px-3 font-mono text-mono-12 text-03">
              decided by: {detail.decidedBy.trigger ?? DASH} — {detail.decidedBy.label}
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      {/* ── 5 · Production consequence ─────────────────────────────────── */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>5 · Production consequence</PanelTitle>
            <PanelDescription>{`a score of ${scoreText(detail.score)} means nothing on its own`}</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-3 px-3.5 pb-3.5 pt-1.5">
          <ConsequenceBoxes detail={detail} />

          <dl className="mt-2 flex w-full flex-col gap-2 border-t border-01 pt-3.5">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-body-13 text-02">listed price</dt>
              <dd className="font-mono text-mono-13 font-semibold text-01">
                {moneyOrDash(detail.consequence.price)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-body-13 text-02">your share</dt>
              <dd className="font-mono text-mono-13 font-semibold text-01">
                {moneyOrDash(detail.consequence.providerAmount)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-body-13 text-02">platform fee</dt>
              <dd className="font-mono text-mono-13 font-semibold text-01">
                {moneyOrDash(detail.consequence.platformFee)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-body-13 text-02">settled amount</dt>
              <dd className="font-mono text-mono-13 font-semibold text-01">
                {moneyOrDash(detail.consequence.settledAmount)}
              </dd>
            </div>
          </dl>

          <p className="pt-1">
            <Link href={evidenceHref} className="text-body-13 text-primary-600 hover:underline">
              See the evidence pack for the exact request/response behind this verdict →
            </Link>
          </p>
        </PanelBody>
      </Panel>
    </TooltipProvider>
  );
}
