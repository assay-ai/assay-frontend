"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Minus, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { Amount } from "@/features/g30/receipt-parts";
import { usePublicCallId } from "@/hooks/usePublicCallId";
import { ApiError } from "@/libs/ApiClient";
import { isRecordMissing } from "@/libs/record-missing";
import { routes } from "@/libs/routes";
import {
  getPublicReceipt,
  PublicReceiptShapeError,
  type PublicReceipt,
  type PublicReceiptStage,
  type PublicReceiptStageName,
  type PublicReceiptStatus,
} from "@/services/public-receipt.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

/**
 * One call on the public explorer — `/explorer/call/<intentId>` (rewritten to
 * this page by `public/_redirects`; `?id=` works too, for `next dev`).
 *
 * Shows only the fields of `PublicReceipt`, each one written out below: what
 * the tool listed, what was charged, why not (a fixed sentence) and the four
 * checks. Never a wallet, a hash or the request and response. Every string
 * from the API is rendered as text. The id is never sent to analytics.
 */

const HEADLINE: Record<PublicReceiptStatus, { title: string; explain: string }> = {
  IN_PROGRESS: {
    title: "Being checked",
    explain: "The result is still being checked. Nothing is charged unless it passes.",
  },
  CHARGED: {
    title: "Charged",
    explain: "The result passed its checks, so the listed price was charged.",
  },
  NOT_CHARGED: {
    title: "Not charged",
    explain: "This call was not charged.",
  },
  CLOSED: {
    title: "Closed",
    explain: "This call has ended.",
  },
};

const STAGE_NAME: Record<PublicReceiptStageName, string> = {
  SCHEMA: "Response shape",
  DETERMINISTIC_RULES: "Result quality rules",
  CROSS_CHECK: "Independent cross-check",
  SEMANTIC: "Relevance check",
};

/** Only a PASSED stage gets a tick; anything else that is not FAILED is a dash. */
function StageMark({ status }: { status: string }) {
  if (status === "PASSED") return <Check aria-hidden="true" className="size-4 shrink-0 text-success-500" />;
  if (status === "FAILED") return <X aria-hidden="true" className="size-4 shrink-0 text-danger-500" />;
  return <Minus aria-hidden="true" className="size-4 shrink-0 text-03" />;
}

function StageRow({ stage }: { stage: PublicReceiptStage }) {
  return (
    <li className="flex w-full items-center gap-3 py-3" data-testid="public-stage">
      <StageMark status={stage.status} />
      <span className="min-w-0 flex-1 text-label-sm text-01 tablet:w-[260px] tablet:flex-none">{STAGE_NAME[stage.stage]}</span>
      <span
        className={cn(
          "shrink-0 text-body-sm",
          stage.status === "PASSED" ? "text-success-500" : stage.status === "FAILED" ? "text-danger-500" : "text-02",
        )}
      >
        {stage.label}
      </span>
    </li>
  );
}

const LINK = "text-primary-600 hover:underline";

function ReceiptView({ receipt }: { receipt: PublicReceipt }) {
  const headline = HEADLINE[receipt.status];
  const listed = formatMoney(receipt.listedPrice, { decimals: 4 });
  const charged = formatMoney(receipt.chargedPrice, { decimals: 4 });
  const toolName = receipt.tool ? receipt.tool.name : "a tool";

  return (
    <>
      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="break-all text-heading-md text-01">
          A call to{" "}
          {receipt.tool ? (
            <Link href={routes.publicTool(receipt.tool.id)} rel="noopener noreferrer" className={cn("font-mono", LINK)}>
              {toolName}
            </Link>
          ) : (
            toolName
          )}
        </h1>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-13 text-03">
          <UtcTime value={receipt.createdAt} alwaysDay />
          {receipt.provider ? (
            <>
              <span aria-hidden="true">·</span>
              <span>
                Served by{" "}
                <Link href={routes.publicProvider(receipt.provider.id)} rel="noopener noreferrer" className={LINK}>
                  {receipt.provider.name}
                </Link>
              </span>
            </>
          ) : null}
        </p>
      </header>

      <section
        data-testid="public-receipt-headline"
        className="flex w-full flex-col gap-5 rounded-xl border border-01 bg-01 px-[22px] py-[18px] tablet:flex-row tablet:items-center"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h2 className="text-heading-sm text-01">{headline.title}</h2>
          <p className="text-body-13 text-02">
            {receipt.status === "NOT_CHARGED" && receipt.notCharged ? receipt.notCharged.text : headline.explain}
          </p>
          {receipt.settledAt ? (
            <p className="text-body-xs text-03">
              Settled <UtcTime value={receipt.settledAt} alwaysDay midSentence />
            </p>
          ) : null}
        </div>
        <div className="flex w-full items-end gap-3 tablet:w-auto tablet:shrink-0 tablet:gap-8">
          <Amount label="Listed price" value={listed} align="start" className="min-w-0 flex-1 tablet:flex-none tablet:items-end" />
          <Amount label="Charged" value={charged} align="start" className="min-w-0 flex-1 tablet:flex-none tablet:items-end" />
        </div>
      </section>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Checks run on this call</PanelTitle>
            <PanelDescription>Checks stop at the first failure</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-2 px-5 pb-5 pt-2">
          <ul className="flex w-full flex-col">
            {receipt.stages.map((stage) => (
              <StageRow key={stage.stage} stage={stage} />
            ))}
          </ul>
          {receipt.sampling ? (
            <p className="text-body-13 text-02" data-testid="public-sampling">
              Relevance is checked on {receipt.sampling}.
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <p className="text-body-xs text-03">
        This page shows only the price, the tool and the check results of one call.{" "}
        <Link href="/how-it-works" rel="noopener noreferrer" className={LINK}>
          How Assay checks calls
        </Link>
      </p>
    </>
  );
}

function PublicReceiptContent() {
  const intentId = usePublicCallId();
  const query = useQuery<PublicReceipt, Error>({
    queryKey: ["public-receipt", intentId],
    queryFn: () => getPublicReceipt(intentId),
    enabled: Boolean(intentId),
    retry: 0,
    networkMode: "always" as const,
  });

  if (query.isPending) return <PageState kind="loading" rows={4} label="Loading the receipt" />;

  if (query.isError) {
    const err = query.error;
    // One neutral state for every "no": unknown id, hidden by its owner, or a reply we cannot read.
    if (isRecordMissing(err) || err instanceof PublicReceiptShapeError) {
      return (
        <PageState
          kind="empty"
          titleAsH1
          title="This receipt is not available"
          description="The link may be incomplete or out of date."
          action={{ label: "See all tools", href: "/catalogue" }}
        />
      );
    }
    return (
      <PageState
        kind="error"
        titleAsH1
        title="This receipt could not be loaded"
        description="Something went wrong on our side or with the connection. Try again in a moment."
        onRetry={() => void query.refetch()}
        code={err instanceof ApiError ? err.code : null}
      />
    );
  }

  return <ReceiptView receipt={query.data} />;
}

export default function PublicReceiptPage() {
  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4 px-4 py-6 tablet:gap-[18px] tablet:px-7 tablet:py-8">
      <React.Suspense fallback={<PageState kind="loading" rows={4} label="Loading the receipt" />}>
        <PublicReceiptContent />
      </React.Suspense>
    </div>
  );
}
