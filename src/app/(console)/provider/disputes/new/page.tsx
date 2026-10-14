"use client";

import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Banner } from "@/components/ui/banner";
import { DisputeFilingForm } from "@/features/provider-disputes/dispute-filing-form";
import { routes } from "@/libs/routes";

/**
 * the dispute filing screen — dispute filing, route `/provider/disputes/new?subjectType=&subjectId=`.
 *
 * The whole screen is `DisputeFilingForm` (`@/features/provider-disputes/
 * dispute-filing-form`), exported separately so the slash proposal case screen's slash-proposal case
 * screen (a different agent's route) can mount it inline rather than
 * navigating here. See that file's docstring for what the form does and does
 * not render.
 *
 * ## What `subjectId` means here
 *
 * Only one caller reaches this route today — a slash case's "Dispute ▸"
 * action — and the only filing endpoint whose shape matches the
 * frame (a header reading "proposed penalty $X", claim-type-driven prefill)
 * is `POST /providers/me/slash-proposals/:id/dispute`. So `subjectId` is read
 * as a slash **proposal** id, not a generic dispute subject id.
 * `subjectType` is accepted on the query string for forward compatibility
 * but is not branched on: there is no
 * second design frame or backend flow reaching this route with a different
 * subject shape to distinguish. If a future screen needs to open the general
 * `POST /disputes` path (an `SLA_WINDOW`/`VERDICT`/`PAYMENT_INTENT` dispute
 * with no proposal behind it), that is a second form, not a branch here —
 * `createDispute` and `CreateDisputeBody` already exist in this package's
 * service/interface files for whoever builds it.
 */

function DisputeFilingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const subjectId = searchParams.get("subjectId");

  if (!subjectId) {
    return (
      <Banner
        tone="danger"
        title="No slash proposal named."
        description="Open this page from the Dispute button on a case page, so we know which penalty proposal you are disputing."
      />
    );
  }

  return (
    <DisputeFilingForm
      proposalId={subjectId}
      onCancel={() => router.back()}
      onFiled={(result) => {
        const disputeId = result.proposal.disputeId;
        if (disputeId) {
          router.push(routes.dispute(disputeId));
        } else {
          router.push("/provider/disputes");
        }
      }}
    />
  );
}

export default function DisputeFilingPage() {
  // `useSearchParams()` opts this route out of static prerendering — Next
  // refuses to build without a Suspense boundary around it. Same pattern as
  // `src/app/(main)/receipts/[intentId]/page.tsx`.
  return (
    <React.Suspense fallback={null}>
      <DisputeFilingPageContent />
    </React.Suspense>
  );
}
