"use client";

import { CircleCheck, Loader2, PartyPopper } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { ToolBindingDetail } from "@/interfaces";
import { routes } from "@/libs/routes";

import { callPrice } from "./format";

/**
 * The first minutes after a tool goes live: what buyers now see (a preview of
 * the explore row) and a listener that turns into "First call ✓" when the
 * first call lands. Shown on Home until the tool has served a call.
 */
export function ListingPreview({
  toolName,
  providerName,
  binding,
}: {
  toolName: string;
  providerName: string | null;
  binding: Pick<ToolBindingDetail, "pricingMode" | "price" | "freeQuotaPerAgent" | "slaFailureRate">;
}) {
  const priceLine =
    binding.pricingMode === "FREE" ? "Free" : `${callPrice(binding.price)} per call`;
  const freeLine =
    binding.pricingMode === "FREEMIUM" && binding.freeQuotaPerAgent
      ? `${binding.freeQuotaPerAgent} free calls a day per agent`
      : null;
  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-01 p-3.5" aria-label="How buyers see your tool">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-label-13 text-01">{toolName}</span>
        {providerName ? <span className="text-body-xs text-03">by {providerName}</span> : null}
        <span className="ml-auto font-mono text-mono-13 font-semibold text-01">{priceLine}</span>
      </div>
      <div className="flex flex-wrap gap-2 text-body-xs text-02">
        {freeLine ? <span className="rounded-full bg-teal-10 px-2 py-0.5 text-teal-600">{freeLine}</span> : null}
        <span className="rounded-full bg-03 px-2 py-0.5">Promises at most {Math.round(binding.slaFailureRate * 1000) / 10}% failed calls</span>
        <span className="rounded-full bg-03 px-2 py-0.5">Checked by Assay on every call</span>
      </div>
    </div>
  );
}

export function FirstRunCard({
  bindingId,
  toolName,
  providerName,
  binding,
  calls,
}: {
  bindingId: string;
  toolName: string;
  providerName: string | null;
  binding: Pick<ToolBindingDetail, "pricingMode" | "price" | "freeQuotaPerAgent" | "slaFailureRate"> | null;
  /** Calls served so far (null while unknown). */
  calls: number | null;
}) {
  const firstCall = calls !== null && calls > 0;
  return (
    <section className="flex w-full flex-col gap-4 rounded-xl border border-success-20 bg-success-10 p-4 tablet:p-5">
      <div className="flex items-start gap-3">
        <PartyPopper aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success-600" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-label-md text-01">{toolName} is live</h2>
          <p className="text-body-13 text-02">
            Buyers&apos; agents can call it now. Assay checks the response shape of each paid call; you are paid for every paid call that passes.
          </p>
        </div>
      </div>
      {binding ? <ListingPreview toolName={toolName} providerName={providerName} binding={binding} /> : null}
      <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3">
        {firstCall ? (
          <span className="inline-flex items-center gap-1.5 text-label-13 text-success-700">
            <CircleCheck aria-hidden="true" className="size-4" /> First call served
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-body-13 text-02">
            <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            Waiting for the first call. This updates by itself.
          </span>
        )}
        <Button size="sm" variant="secondary" asChild className="ml-auto">
          <Link href={routes.binding(bindingId, "quality")}>See calls and quality</Link>
        </Button>
      </div>
    </section>
  );
}
