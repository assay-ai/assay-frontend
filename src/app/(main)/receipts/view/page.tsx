"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Braces } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { EntityName } from "@/components/patterns/entity-name";
import { LocalTime } from "@/components/patterns/local-time";
import { MoneyFlow } from "@/components/patterns/money-flow";
import { PageState } from "@/components/patterns/page-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { SamplingExplainer } from "@/components/ui/sampling-explainer";
import { StageList } from "@/components/ui/stage-list";
import { Timeline, type TimelineEvent } from "@/components/ui/timeline";
import {
  Amount,
  ChargedHeadline,
  CodePane,
  MobileStageList,
  NotChargedHeadline,
  StateCardBlock,
} from "@/features/g30/receipt-parts";
import {
  isFinalNotCharged,
  isFinalNotChargedReceipt,
  notChargedStory,
  receiptFlow,
  relevanceReached,
  canContestRejection,
  COLLECTION_STATES,
  STATE_CARDS,
  STATE_CARD_ORDER,
  chargedHeadline,
  deriveReceiptState,
  samplingExplainerCopy,
  samplingSubline,
  toStageChecks,
  type ReceiptState,
} from "@/features/g30/receipt-state";
import { ErrorBlock } from "@/features/g30/ui";
import { collectionAt, collectionView, isCollectionState, timelineStamp, timelineZoneNote } from "@/features/g30/receipt-collection";
import { OwedReceiptAction } from "@/features/buyer-debt/owed-row-action";
import { owedCallState } from "@/features/buyer-debt/debt-summary";
import { useBuyerDebtsQuery } from "@/features/buyer-debt/settle-debt-sheet";
import type { Receipt } from "@/features/g30/wire";
import { ApiError } from "@/libs/ApiClient";
import { getReceipt } from "@/services";
import { getProviderVerification } from "@/services/providers.service";
import { getVerdictEvidence, resolveVerdictIdForIntent } from "@/services/verdicts.service";
import { responseClassLabel } from "@/features/call-classes/labels";
import { useEntityNames } from "@/hooks/useEntityNames";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { formatMoney } from "@/utils/money";

/**
 * Receipt (design, mobile the design) and Receipt · not
 * charged + states. One route, because they are one screen: which
 * headline a receipt gets is a property of the call, not of the URL.
 *
 * `?state=` overrides the derived state. It changes ONLY which headline and
 * which state card is marked current — never a figure, never a stage, never
 * the verdict. It exists because the seeded API has two calls and this screen
 * has seven states, and it is how all five of the main states can be
 * exercised.
 *
 * It is COMPILED OUT of production. `process.env.NODE_ENV` is inlined at build
 * time, so the branch below is statically false in a production bundle and the
 * parameter simply does not exist there. Deleting it outright was the other
 * option and was rejected: the five-state walkthrough is a required acceptance
 * artifact and will be needed again every time this screen changes, so the
 * affordance should survive in development and be unreachable in a build a
 * person can visit. Remove it once the API can produce all seven states.
 */

const OVERRIDABLE: ReceiptState[] = [
  "CHECKING",
  "CHARGED",
  "NOT_CHARGED",
  "EMPTY_CONFIRMED",
  "MISAPPLIED",
  "SYSTEM_ERROR",
  "REQUEST_ERROR",
  "EXPIRED",
  "DEBT_OUTSTANDING",
  "DEBT_WRITTEN_OFF",
  "DEBT_VOIDED",
  "FORFEITED",
];

/** A timeline stamp: local day and clock with seconds, the exact UTC instant on hover. */
function stamp(iso: string): Pick<TimelineEvent, "time" | "timeTitle"> {
  return timelineStamp(iso);
}

function pretty(value: unknown): string {
  if (value === undefined || value === null) return "—";
  return JSON.stringify(value, null, 2);
}

function ReceiptPageContent() {
  const search = useSearchParams();
  const intentId = search.get("id") ?? "";
  const names = useEntityNames({ kinds: ["tool", "provider"] });
  // The same debts query as the banner (one request): a written-off row takes its write-off time from it.
  const debtsQuery = useBuyerDebtsQuery();

  const receiptQuery = useQuery<Receipt, ApiError>({
    queryKey: ["receipt", intentId],
    queryFn: () => getReceipt(intentId) as Promise<Receipt>,
    enabled: Boolean(intentId),
    // No retries, and `networkMode: "always"`.
    //
    // Measured, not assumed: with the defaults this query sat at
    // `status: "pending", fetchStatus: "paused", failureCount: 1` forever
    // while the request had already rejected with ERR_NETWORK — React Query
    // PAUSES a pending retry rather than failing it, so /funding showed
    // "Loading balance…" indefinitely with the API down. A money screen that
    // cannot read its figures has to say so, immediately and in words.
    retry: 0,
    networkMode: "always" as const,
  });

  const receipt = receiptQuery.data;

  // The request/response bodies live only on the evidence pack, and the only
  // way from an intent to its verdict is to page the feed. See verdicts.service.
  const evidenceQuery = useQuery({
    queryKey: ["receipt-evidence", intentId],
    enabled: Boolean(receipt),
    queryFn: async () => {
      const verdictId = await resolveVerdictIdForIntent(intentId);
      if (!verdictId) return null;
      return getVerdictEvidence(verdictId);
    },
    // No retries, and `networkMode: "always"`.
    //
    // Measured, not assumed: with the defaults this query sat at
    // `status: "pending", fetchStatus: "paused", failureCount: 1` forever
    // while the request had already rejected with ERR_NETWORK — React Query
    // PAUSES a pending retry rather than failing it, so /funding showed
    // "Loading balance…" indefinitely with the API down. A money screen that
    // cannot read its figures has to say so, immediately and in words.
    retry: 0,
    networkMode: "always" as const,
  });

  const providerQuery = useQuery({
    queryKey: ["receipt-provider", receipt?.providerId],
    enabled: Boolean(receipt?.providerId),
    queryFn: () => getProviderVerification(receipt!.providerId!),
    // No retries, and `networkMode: "always"`.
    //
    // Measured, not assumed: with the defaults this query sat at
    // `status: "pending", fetchStatus: "paused", failureCount: 1` forever
    // while the request had already rejected with ERR_NETWORK — React Query
    // PAUSES a pending retry rather than failing it, so /funding showed
    // "Loading balance…" indefinitely with the API down. A money screen that
    // cannot read its figures has to say so, immediately and in words.
    retry: 0,
    networkMode: "always" as const,
  });

  if (receiptQuery.isPending) {
    return (
      <div className="w-full bg-02 px-4 py-5 tablet:px-7 tablet:py-[22px]">
        <PageState kind="loading" rows={5} label="Loading the receipt" />
      </div>
    );
  }

  if (receiptQuery.error || !receipt) {
    const err = receiptQuery.error;
    if (err?.code === "AUTH_WALLET_NOT_LINKED") {
      return (
        <div className="w-full bg-02 px-4 py-5 tablet:px-7 tablet:py-[22px]">
          <ErrorBlock code={err.code} message={err.message} />
        </div>
      );
    }
    return (
      <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:px-7 tablet:py-[22px]">
        <BackButton />
        {err?.status === 404 || !intentId ? (
          <PageState
            kind="empty"
            title="We could not find this call"
            description="The link may be incomplete. Your calls are all listed under Calls."
            action={{ label: "Open Calls", href: routes.calls() }}
          />
        ) : (
          <PageState
            kind="error"
            title="This receipt could not be loaded"
            description={plainError(err?.code ?? "ERR_NETWORK")}
            onRetry={() => void receiptQuery.refetch()}
            code={err?.code ?? null}
            details={err?.message ?? null}
          />
        )}
      </div>
    );
  }

  const override = search.get("state") as ReceiptState | null;
  const state: ReceiptState =
    process.env.NODE_ENV !== "production" && override && OVERRIDABLE.includes(override)
      ? override
      : deriveReceiptState(receipt);

  const checks = toStageChecks(receipt);
  const listed = formatMoney(receipt.listedPrice, { decimals: 4 });
  const samplingExplainer = samplingExplainerCopy(receipt, listed);
  const paid = formatMoney(receipt.chargedPrice, { decimals: 4 });
  const withheld = formatMoney(receipt.withheld, { decimals: 4 });

  // A debt or a forfeit is not one of the "ended without a charge" outcomes.
  const finalNotCharged = isFinalNotCharged(state, receipt) && !COLLECTION_STATES.has(state);
  // Every finished call that was not charged tells ONE story — the banner, the
  // money strip, the check rows and the details all read from it — so a voided
  // call can never say "No result recorded" beside "Check failed".
  const story = state !== "CHECKING" && isFinalNotChargedReceipt(receipt) ? notChargedStory(receipt) : null;
  // A debt, a voided debt or a forfeit: a short headline of its own (`receipt-collection.ts`).
  const collection = isCollectionState(state) ? collectionView(state, receipt) : null;
  const stateCard =
    state === "CHARGED" || state === "NOT_CHARGED" || story || collection
      ? null
      : STATE_CARDS[state as keyof typeof STATE_CARDS];

  /* ------------------------------------------------------------- timeline */

  const releasedLabel = state === "EXPIRED" ? "Did not finish in time, hold released" : "Hold released";
  const events: TimelineEvent[] = [
    { ...stamp(receipt.createdAt), label: "Call made", tone: "neutral" },
    { ...stamp(receipt.createdAt), label: "Money held", meta: listed, tone: "primary" },
  ];
  if (receipt.evaluatedAt) {
    events.push({ ...stamp(receipt.evaluatedAt), label: "Result checked", tone: "neutral" });
  }
  if (receipt.settledAt && collection && isCollectionState(state)) {
    // A debt, a voided debt or a forfeit, in what it means for the buyer.
    const listedDebt = owedCallState(debtsQuery.data, receipt.intentId);
    events.push({
      ...stamp(collectionAt(state, receipt.settledAt, listedDebt.kind === "unknown" ? null : listedDebt.debt)),
      label: collection.timeline.label,
      meta: collection.timeline.meta,
      tone: collection.owed ? "primary" : "teal",
    });
  } else if (receipt.settledAt) {
    const charged = receipt.chargedPrice.amount !== "0";
    events.push({
      ...stamp(receipt.settledAt),
      label: charged ? "Charged" : releasedLabel,
      meta: charged ? paid : "not charged",
      tone: charged ? "success" : "teal",
    });
  } else if (receipt.holdReleasedAt) {
    events.push({ ...stamp(receipt.holdReleasedAt), label: releasedLabel, meta: "not charged", tone: "teal" });
  }

  const providerName: React.ReactNode =
    providerQuery.data?.legalName ??
    (receipt.providerId ? <EntityName kind="provider" id={receipt.providerId} /> : "—");
  const details = [
    { label: "Provider", value: providerName },
    {
      label: "Provider identity",
      value: providerQuery.data ? (providerQuery.data.verification.verified ? "Verified" : "Not verified") : "—",
    },
    {
      label: "Result type",
      value: story ? story.resultType : receipt.classification ? responseClassLabel(receipt.classification) : "—",
    },
    ...(relevanceReached(receipt) && receipt.sampling.display
      ? [{ label: "Relevance checked on", value: receipt.sampling.display }]
      : []),
  ];

  return (
    <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <BackButton />

      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="break-all font-mono text-heading-md text-01">{names.name("tool", receipt.toolId)}</h1>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-13 text-03">
          {/* Day + HH:MM + zone, as the debt banner ("Today 07:32 GMT+9", "Sep 15, 08:40 GMT+9"). */}
          <LocalTime value={receipt.createdAt} alwaysDay withZone />
          <span aria-hidden="true">·</span>
          <span>{providerName}</span>
          <span aria-hidden="true">·</span>
          <CopyChip value={receipt.intentId} label="Call id" />
        </p>
      </div>

      {/* 1. One verdict banner per state — never one "error" for all of them. */}
      {state === "CHARGED" ? (
        <ChargedHeadline
          headline={chargedHeadline(receipt)}
          sub={samplingSubline(receipt)}
          listed={listed}
          paid={paid}
          notCharged={withheld}
        />
      ) : null}

      {collection ? (
        <CollectionHeadline
          view={collection}
          intentId={receipt.intentId}
          listed={listed}
          notCharged={collection.owed ? null : listed}
        />
      ) : null}

      {story && !collection ? (
        <NotChargedHeadline
          headline={story.headline}
          explain={story.explain}
          failedChecks={story.reason === "FAILED_CHECKS"}
          listed={listed}
          paid={paid}
          notCharged={withheld}
        />
      ) : null}

      {stateCard ? (
        <section
          data-testid="receipt-headline-state"
          className="flex w-full flex-col gap-5 rounded-xl border border-01 bg-01 px-[22px] py-[18px] tablet:flex-row tablet:items-center"
        >
          <div className="min-w-0 flex-1">
            <StateCardBlock card={stateCard} receipt={receipt} current />
          </div>
          <div className="flex w-full items-end gap-3 tablet:w-auto tablet:shrink-0 tablet:gap-8">
            <Amount label="Listed price" value={listed} align="start" className="min-w-0 flex-1 tablet:flex-none tablet:items-end" />
            <Amount label="You paid" value={paid} align="start" className="min-w-0 flex-1 tablet:flex-none tablet:items-end" />
            {/* A debt or a forfeit has its own headline (`CollectionHeadline`), so `withheld` here is the guarantee's. */}
            <Amount label="Not charged" value={withheld} teal align="start" className="min-w-0 flex-1 tablet:flex-none tablet:items-end" />
          </div>
        </section>
      ) : null}

      {/* 2. Where the money went. */}
      <section className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 px-5 py-4">
        <h2 className="text-label-13 text-02">Where the money went</h2>
        <MoneyFlow nodes={receiptFlow(receipt, state)} />
      </section>

      {/* 3. The checks and the timeline. */}
      <div className="flex w-full flex-col gap-4 desktop:flex-row">
        <Panel className="min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Checks run on this call</PanelTitle>
              <PanelDescription>{story ? story.checksSummary : "Checks stop at the first failure"}</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3.5 px-5 pb-5 pt-2">
            <div className="hidden tablet:block">
              <StageList checks={checks} />
            </div>
            <div className="tablet:hidden">
              <MobileStageList checks={checks} />
            </div>
            {relevanceReached(receipt) ? (
              <SamplingExplainer
                {...samplingExplainer}
                rate={
                  samplingExplainer.rate ??
                  receipt.sampling.display ??
                  "This tool publishes no sample rate."
                }
              />
            ) : null}
          </PanelBody>
        </Panel>

        <Panel className="w-full desktop:w-[400px] desktop:shrink-0">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Timeline</PanelTitle>
              <PanelDescription>{timelineZoneNote()}</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="px-5 pb-3.5 pt-1">
            <Timeline events={events} />
          </PanelBody>
        </Panel>
      </div>

      <dl className="grid w-full grid-cols-1 gap-4 rounded-xl border border-01 bg-01 px-5 py-4 tablet:grid-cols-4">
        {details.map((item) => (
          <div key={item.label} className="flex min-w-0 flex-col gap-[3px]">
            <dt className="text-body-xs text-03">{item.label}</dt>
            <dd className="truncate text-body-13 text-01">{item.value}</dd>
          </div>
        ))}
      </dl>

      {/* Only on a call that was not charged: what the other outcomes mean. */}
      {finalNotCharged ? (
        <details className="group rounded-xl border border-01 bg-01">
          <summary className="cursor-pointer select-none px-5 py-3.5 text-label-13 text-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500">
            Other ways a call can end without a charge
          </summary>
          <div className="flex flex-row flex-wrap gap-3 px-5 pb-5">
            {STATE_CARD_ORDER.filter((key) => key !== "CHECKING" && key !== "EMPTY_CONFIRMED").map((key) => (
              <StateCardBlock
                key={key}
                card={STATE_CARDS[key]}
                receipt={receipt}
                current={state === key}
                className="basis-[160px]"
              />
            ))}
          </div>
        </details>
      ) : null}

      {/* 4. Request and response, collapsed. */}
      <details className="group rounded-xl border border-01 bg-01">
        <summary className="cursor-pointer select-none px-5 py-3.5 text-label-13 text-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500">
          Request and response, exactly as the checks saw them
        </summary>
        <div className="px-5 pb-5">
          {evidenceQuery.error ? (
            <p className="text-body-13 text-03">The request and response could not be loaded.</p>
          ) : evidenceQuery.isPending ? (
            <PageState kind="loading" rows={2} label="Loading the request and response" />
          ) : evidenceQuery.data ? (
            <div className="flex w-full flex-col gap-3.5 tablet:flex-row">
              <CodePane label="REQUEST" body={pretty(evidenceQuery.data.request)} />
              <CodePane label="RESPONSE" body={pretty(evidenceQuery.data.response)} />
            </div>
          ) : (
            <p className="text-body-13 text-03">The request and response are not kept for this call.</p>
          )}
        </div>
      </details>

      {/* 5. Raw JSON, collapsed. */}
      <details className="group rounded-xl border border-01 bg-01">
        <summary className="flex cursor-pointer select-none items-center gap-2 px-5 py-3.5 text-label-13 text-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500">
          <Braces aria-hidden="true" className="size-3.5" />
          Raw data
        </summary>
        <pre className="mx-5 mb-5 overflow-x-auto rounded-lg border border-01 bg-02 p-4 font-mono text-mono-12 text-01">
          {pretty(receipt)}
        </pre>
      </details>
    </div>
  );
}

/**
 * The headline for a debt, a voided debt or a forfeit: what it means in one
 * line, the amounts (owed is never hidden), and, on an owed call, the way to
 * settle it right here.
 */
function CollectionHeadline({
  view,
  intentId,
  listed,
  notCharged,
}: {
  view: ReturnType<typeof collectionView>;
  intentId: string;
  listed: string;
  notCharged: string | null;
}) {
  return (
    <section
      data-testid="receipt-headline-collection"
      className={
        view.owed
          ? "flex w-full flex-col gap-4 rounded-xl border border-warning-20 bg-warning-10 px-[22px] py-[18px] tablet:flex-row tablet:items-center"
          : "flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 px-[22px] py-[18px] tablet:flex-row tablet:items-center"
      }
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h2 className="text-heading-sm text-01">{view.headline}</h2>
        <p className="text-body-13 text-02">{view.explain}</p>
        {view.cause ? <p className="text-body-xs text-03">Why: {view.cause}.</p> : null}
        {view.owed ? <OwedReceiptAction intentId={intentId} /> : null}
      </div>
      <div className="flex w-full items-end gap-3 tablet:w-auto tablet:shrink-0 tablet:gap-8">
        <Amount label="Listed price" value={listed} align="start" className="min-w-0 flex-1 tablet:flex-none tablet:items-end" />
        {view.owed ? (
          <Amount label="Owed" value={listed} align="start" className="min-w-0 flex-1 tablet:flex-none tablet:items-end" />
        ) : (
          <Amount label="Not charged" value={notCharged ?? listed} teal align="start" className="min-w-0 flex-1 tablet:flex-none tablet:items-end" />
        )}
      </div>
    </section>
  );
}

/** Back to wherever the person came from (Overview, Calls, Spend); Calls when opened directly. */
function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(routes.calls());
      }}
      className="inline-flex items-center gap-1.5 self-start rounded-md text-label-13 text-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <ArrowLeft aria-hidden="true" className="size-3.5" />
      Back
    </button>
  );
}

/**
 * `useSearchParams()` opts a route out of static prerendering, and Next refuses
 * to build unless the component that reads it sits under a Suspense boundary —
 * `next build` failed on this page with "useSearchParams() should be wrapped in
 * a suspense boundary". The page has no server-rendered fallback worth drawing
 * (the whole receipt view is client-fetched), so the boundary renders nothing and
 * exists only to mark the bail-out point.
 */
export default function ReceiptPage() {
  return (
    <React.Suspense fallback={null}>
      <ReceiptPageContent />
    </React.Suspense>
  );
}
