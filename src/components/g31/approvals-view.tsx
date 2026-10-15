"use client";

import { Settings } from "lucide-react";
import Link from "next/link";

import { CallsInFlight } from "@/components/buyer/calls-in-flight";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

import { PageHeader } from "./chrome";

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
 * The in-flight calls panel beside it is NOT the queue: it is the shared
 * `CallsInFlight` (also on Spend), labelled as what it is.
 */

export function ApprovalsView() {
  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Approvals"
        subtitle="0 waiting"
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
            Calls can't be approved by hand yet, so a call above your approval threshold is refused instead of
            waiting here.
          </p>
        </div>

        <div className="min-w-0 tablet:w-[400px] tablet:shrink-0">
          <CallsInFlight />
        </div>
      </div>
    </div>
  );
}
