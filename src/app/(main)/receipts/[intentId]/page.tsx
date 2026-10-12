"use client";

import { useQuery } from "@tanstack/react-query";
import { Braces, ChevronRight, Flag } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { MoneyPair } from "@/components/ui/money-pair";
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
  ChargedHeadline,
  CodePane,
  MetaBar,
  MobileStageList,
  NotChargedHeadline,
  StateCardBlock,
} from "@/features/g30/receipt-parts";
import {
  STATE_CARDS,
  STATE_CARD_ORDER,
  chargedHeadline,
  deriveReceiptState,
  notChargedHeadline,
  samplingExplainerCopy,
  samplingSubline,
  toStageChecks,
  type ReceiptState,
} from "@/features/g30/receipt-state";
import { ErrorBlock, PendingBlock } from "@/features/g30/ui";
import type { Receipt } from "@/features/g30/wire";
import { ApiError } from "@/libs/ApiClient";
import { getReceipt } from "@/services";
import { getProviderVerification } from "@/services/providers.service";
import { getVerdictEvidence, resolveVerdictIdForIntent } from "@/services/verdicts.service";
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
];

function short(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/** "2026-08-10 11:42:07.221 UTC", as the design writes it. */
function utcStamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)} UTC`
  );
}

/** "11:42:07.221" — the Timeline's own format. */
function clock(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(
    d.getUTCMilliseconds(),
    3,
  )}`;
}

function pretty(value: unknown): string {
  if (value === undefined || value === null) return "—";
  return JSON.stringify(value, null, 2);
}

function ReceiptPageContent() {
  const params = useParams<{ intentId: string }>();
  const search = useSearchParams();
  const intentId = params.intentId;
  const [showRaw, setShowRaw] = React.useState(false);

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
        <PendingBlock label="Loading receipt…" />
      </div>
    );
  }

  if (receiptQuery.error || !receipt) {
    const err = receiptQuery.error;
    return (
      <div className="w-full bg-02 px-4 py-5 tablet:px-7 tablet:py-[22px]">
        <ErrorBlock
          code={err?.code ?? "UNKNOWN"}
          message={err?.message ?? "This receipt could not be read."}
        />
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
  const paid = formatMoney(receipt.chargedPrice, { decimals: 4 });
  const withheld = formatMoney(receipt.withheld, { decimals: 4 });

  const stateCard = state === "CHARGED" || state === "NOT_CHARGED" ? null : STATE_CARDS[state];

  /* ------------------------------------------------------------- timeline */

  const releasedLabel = state === "EXPIRED" ? "Expired, hold released" : "Hold released";
  const events: TimelineEvent[] = [
    { time: clock(receipt.createdAt), label: "Created", tone: "neutral" },
    {
      time: clock(receipt.createdAt),
      label: "Funds held",
      meta: listed,
      tone: "primary",
    },
  ];
  if (receipt.evaluatedAt) {
    events.push({
      time: clock(receipt.evaluatedAt),
      label: "Checks evaluated",
      // Deliberately no meta. The Timeline's meta column is 11.5px mono in a
      // 400px panel and the design only ever puts a short fact there
      // ("prv_pricefeed · verified · 175ms"). A verdict SENTENCE here wraps to
      // eight lines and pushes the settlement row off the panel; the sentence
      // already has a home in the headline.
      tone: "neutral",
    });
  }
  if (receipt.settledAt) {
    const charged = receipt.chargedPrice.amount !== "0";
    events.push({
      time: clock(receipt.settledAt),
      label: charged ? "Settled" : releasedLabel,
      meta: charged ? `charged ${paid}` : "you were not charged",
      tone: charged ? "success" : "teal",
    });
  } else if (receipt.holdReleasedAt) {
    events.push({
      time: clock(receipt.holdReleasedAt),
      label: releasedLabel,
      meta: "you were not charged",
      tone: "teal",
    });
  }

  /* --------------------------------------------------------------- header */

  const notCharged = receipt.chargedPrice.amount === "0";
  // "Our check was wrong" only makes sense when a check rejected the result —
  // not on an expired, voided or errored call, where none ran.
  const checkRejected = state === "NOT_CHARGED" || state === "MISAPPLIED";

  const meta = [
    { label: "Provider", value: providerQuery.data?.legalName ?? short(receipt.providerId ?? "—") },
    {
      label: "Tier",
      value: providerQuery.data ? (providerQuery.data.verification.verified ? "verified" : "unverified") : "—",
    },
    {
      label: "Spend policy",
      value:
        receipt.policy.decisionPolicyVersion != null
          ? `v${receipt.policy.decisionPolicyVersion}`
          : "—",
    },
    { label: "Sample rate", value: receipt.sampling.display ?? "—" },
    { label: "Response class", value: receipt.classification ?? "—" },
    // No settlement signature is on the receipt wire.
    { label: "Transaction", value: "—", accent: true },
  ];

  return (
    <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2">
        <Link href="/spend" className="text-body-13 text-03 hover:text-01">
          Spend
        </Link>
        <ChevronRight aria-hidden="true" className="size-3 text-03" />
        <span className="font-mono text-mono-12 text-03">{short(receipt.toolId)}</span>
        <ChevronRight aria-hidden="true" className="size-3 text-03" />
        <span className="text-body-13 text-01">Receipt {short(receipt.intentId)}</span>
      </nav>

      <div className="flex w-full flex-col gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-heading-md text-01">Receipt {short(receipt.intentId)}</h1>
          <p className="truncate font-mono text-mono-12 text-03">
            {short(receipt.toolId)} · {utcStamp(receipt.createdAt)} · agent prod · {receipt.intentId}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <Button variant="secondary" onClick={() => setShowRaw((v) => !v)}>
            <Braces aria-hidden="true" />
            Raw JSON
          </Button>
        </div>
      </div>

      {/* One headline per state — never one "error" for all of them. */}
      {state === "CHARGED" ? (
        <ChargedHeadline
          headline={chargedHeadline(receipt)}
          sub={samplingSubline(receipt)}
          listed={listed}
          paid={paid}
          notCharged={withheld}
        />
      ) : null}

      {state === "NOT_CHARGED" ? (
        <NotChargedHeadline
          headline={notChargedHeadline(receipt)}
          failedChecks={receipt.verdict?.status === "FAIL"}
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
          <div className="flex shrink-0 items-end gap-8">
            <div className="flex flex-col items-end gap-[3px]">
              <span className="text-body-13 text-03">Listed price</span>
              <span className="font-mono text-mono-xl text-01">{listed}</span>
            </div>
            <div className="flex flex-col items-end gap-[3px]">
              <span className="text-body-13 text-03">You paid</span>
              <span className="font-mono text-mono-xl text-01">{paid}</span>
            </div>
            <div className="flex flex-col items-end gap-[3px]">
              <span className="text-body-13 text-03">Not charged</span>
              <span className="font-mono text-mono-xl text-teal-600">{withheld}</span>
            </div>
          </div>
        </section>
      ) : null}

      {showRaw ? (
        <pre className="w-full overflow-x-auto rounded-xl border border-01 bg-01 p-4 font-mono text-mono-12 text-01">
          {pretty(receipt)}
        </pre>
      ) : null}

      <div className="flex w-full flex-col gap-4 desktop:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Panel>
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>Checks run on this call</PanelTitle>
                <PanelDescription>
                  {[
                    receipt.policy.decisionPolicyId
                      ? `policy ${receipt.policy.decisionPolicyId} v${receipt.policy.decisionPolicyVersion ?? 0}`
                      : null,
                    receipt.verdict?.score != null ? `score ${receipt.verdict.score}` : null,
                    "checks stop at the first failure",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-3.5 px-5 pb-5 pt-2">
              {/* Two layouts, not one responsive one — see MobileStageList. */}
              <div className="hidden tablet:block">
                <StageList checks={checks} />
              </div>
              <div className="tablet:hidden">
                <MobileStageList checks={checks} />
              </div>
              {/*
                The design's sentence, with ONE substitution: the design writes
                "At $0.0010 a call" because $0.0010 is what its example call
                cost. Quoting a price this call did not have, on a screen whose
                whole job is to say what you were charged, would be a lie in the
                one place it matters most — so the number is this call's listed
                price and every other word is the design's.
              */}
              <SamplingExplainer
                rate={receipt.sampling.display ?? "This tool publishes no sample rate."}
                {...samplingExplainerCopy(receipt, listed)}
              />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>Request and response</PanelTitle>
                <PanelDescription>
                  the bodies exactly as the checks saw them
                </PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="p-5">
              {evidenceQuery.error ? (
                <p className="text-body-13 text-03">
                  The evidence pack could not be read, so the bodies cannot be shown.
                </p>
              ) : evidenceQuery.isPending ? (
                <p className="text-body-13 text-03">Loading the evidence pack…</p>
              ) : evidenceQuery.data ? (
                <div className="flex w-full flex-col gap-3.5 tablet:flex-row">
                  <CodePane label="REQUEST" body={pretty(evidenceQuery.data.request)} />
                  <CodePane label="RESPONSE" body={pretty(evidenceQuery.data.response)} />
                </div>
              ) : (
                <p className="text-body-13 text-03">
                  No evidence pack is retained for this call, so the bodies cannot be shown.
                </p>
              )}
            </PanelBody>
          </Panel>
        </div>

        <div className="flex w-full flex-col gap-4 desktop:w-[400px] desktop:shrink-0">
          <Panel>
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>What this call cost</PanelTitle>
                <PanelDescription>listed and charged, always both</PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="px-5 pb-4 pt-1.5">
              <MoneyPair
                className="border-transparent bg-transparent p-0 shadow-none"
                listedValue={listed}
                paidValue={paid}
                notChargedValue={withheld}
              />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>Timeline</PanelTitle>
                <PanelDescription>UTC, to the millisecond</PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="px-5 pb-3.5 pt-1">
              <Timeline events={events} />
            </PanelBody>
          </Panel>

          {checkRejected ? (
            <div className="flex w-full flex-col gap-2.5 rounded-xl border border-01 bg-01 p-[18px]">
              <Button variant="secondary" className="w-full justify-center">
                <Flag aria-hidden="true" />
                This result was actually fine
              </Button>
              <p className="text-body-13 text-02">
                You keep the money either way. This tells us our check was wrong, and it is how we
                measure the false-positive rate this release exists to learn.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <MetaBar items={meta} />

      {/* the not-charged receipt screen's states panel. The design draws it on the not-charged receipt. */}
      {notCharged ? (
        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>The other states this screen has to render</PanelTitle>
              <PanelDescription>
                Response classes and verdicts — each gets its own sentence, because
                collapsing them into one “error” is a three-year support tax
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="flex-row flex-wrap gap-3 p-5">
            {STATE_CARD_ORDER.map((key) => (
              <StateCardBlock
                key={key}
                card={STATE_CARDS[key]}
                receipt={receipt}
                current={state === key}
              />
            ))}
          </PanelBody>
        </Panel>
      ) : null}

      {!notCharged ? (
        <section className="flex w-full flex-col gap-5 rounded-lg border border-01 bg-01 px-5 py-4 tablet:flex-row tablet:items-center">
          <p className="min-w-0 flex-1 text-body-13 text-02">
            This does not change the charge. It is how we measure our own false-positive rate, which
            is one of the four things this release exists to learn.
          </p>
          <Button variant="secondary" className="w-full shrink-0 justify-center tablet:w-auto">
            <Flag aria-hidden="true" />
            Report this verdict as wrong
          </Button>
        </section>
      ) : null}
    </div>
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
