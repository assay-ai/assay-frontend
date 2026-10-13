"use client";

import { useQuery } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { listToolCalls } from "@/services/tool-calls.service";
import { formatMoney } from "@/utils/money";

import { PageHeader, StatusPill } from "./chrome";
import { relativeTime } from "./format";
import { shortToolId, useToolNames } from "./use-tool-names";

/**
 * Approval queue.
 *
 * The "ask" region of Foundations rule 04: an approval HOLDS a call open for
 * a human. It is not a limit (which refuses) and not an alert (which blocks
 * nothing), and the design's own subtitle says the in-app queue and the
 * signed one-shot link are the same decision reached two ways.
 *
 * **There is no approvals resource in the API.** No endpoint lists pending
 * approvals, and `PaymentIntentStatus` has no awaiting-approval member —
 * `CREATED, FUNDS_SECURED, PROVIDER_EXECUTING, VERIFYING, SETTLED, REFUNDED,
 * VOIDED, EXPIRED`. Rather than dress up `FUNDS_SECURED` as "waiting for you"
 * — money held mid-flight is not a call waiting on a human, and mislabelling
 * it would invite someone to "approve" a call that was never asking — the
 * queue renders empty and says why.
 *
 * The in-flight calls panel below is NOT the queue. It is the closest real
 * thing the API can answer and is labelled as what it is.
 */

const IN_FLIGHT = ["CREATED", "FUNDS_SECURED", "PROVIDER_EXECUTING", "VERIFYING"];

export function ApprovalsView() {
  const { nameOf } = useToolNames();
  const inFlight = useQuery({
    queryKey: ["tool-calls", "in-flight"],
    retry: false,
    queryFn: () => listToolCalls({ status: IN_FLIGHT, limit: 20 }),
  });

  const waiting = 0;

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Approvals"
        subtitle={`${waiting} waiting`}
        actions={
          <Button variant="secondary" icon={<Settings />} asChild>
            <Link href="/limits">Policy</Link>
          </Button>
        }
      />

      <div className="flex w-full flex-col gap-4 tablet:flex-row tablet:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <EmptyState
            title="Nothing is waiting on you"
            description="An approval holds a call open until a person decides. Nothing is holding right now, so your agent is spending inside its policy without asking. A call refused by a limit does not appear here — see Limits."
          />
          <p className="text-body-xs text-03">
            Approving a call by hand is not available yet. Until it is, a call above your approval
            threshold is refused instead of waiting here.
          </p>
        </div>

        <Panel className="tablet:w-[400px] tablet:shrink-0">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Calls in flight</PanelTitle>
              <PanelDescription className="whitespace-normal">
                money is held, not spent — none of these is asking you anything
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3 p-5">
            {inFlight.isPending ? (
              <p className="font-mono text-mono-13 text-03">Loading…</p>
            ) : inFlight.isError ? (
              <p className="text-body-13 text-danger-600">
                Calls in flight could not be read, so this panel is not saying that none exist.
              </p>
            ) : (inFlight.data?.items.length ?? 0) === 0 ? (
              <p className="text-body-13 text-02">No call is in flight.</p>
            ) : (
              inFlight.data?.items.map((call) => (
                <div key={call.intentId} className="flex w-full items-center gap-3">
                  <span className="font-mono text-mono-md font-semibold text-01">
                    {formatMoney(call.price, { decimals: 4 })}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-mono text-mono-13 text-01">
                      {nameOf(call.toolId)}
                    </span>
                    <span className="truncate text-body-xs text-03" title={call.toolId}>
                      {shortToolId(call.toolId)} · {relativeTime(call.createdAt)}
                    </span>
                  </div>
                  <StatusPill label={call.status} tone="warning" />
                </div>
              ))
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}
