"use client";

import { ArrowRight, Store } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/utils";

import type { ProviderEntry } from "./entry";
import { useProviderEntryState } from "./use-provider-entry";

/**
 * "Have an API? List it on Assay and get paid per call." A quiet card for a
 * buyer who is not a provider yet; one plain link for someone who already is.
 * Nothing at all while the registration is unknown.
 */
export function ProviderEntryView({ entry, pending = false, className }: { entry: ProviderEntry | null; pending?: boolean; className?: string }) {
  // While it is being read, its place is kept: no late pop-in that pushes the page down (onboarding run 3).
  if (!entry && pending) {
    return (
      <div
        aria-hidden="true"
        data-testid="provider-entry-pending"
        className={cn("h-[108px] w-full animate-pulse rounded-lg border border-01 bg-01 tablet:h-[64px]", className)}
      />
    );
  }
  if (!entry) return null;
  if (entry.provider) {
    return (
      <Link
        href={entry.href}
        data-testid="provider-entry"
        className={cn("inline-flex min-h-10 items-center gap-1 self-start text-body-13 text-primary-600 hover:underline", className)}
      >
        {entry.label}
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    );
  }
  return (
    <section
      data-testid="provider-entry"
      aria-label="List your API"
      className={cn(
        "flex w-full flex-col gap-3 rounded-lg border border-01 bg-01 px-4 py-3.5 tablet:flex-row tablet:items-center tablet:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Store aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-03" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-label-13 text-01">Have an API? List it on Assay and get paid per call.</p>
          <p className="text-body-xs text-03">About five minutes, no review queue. Free listings need no stake.</p>
        </div>
      </div>
      <Button size="sm" variant="secondary" asChild className="self-start tablet:self-center">
        <Link href={entry.href}>{entry.label}</Link>
      </Button>
    </section>
  );
}

export function ProviderEntryCard({ className, buyersOnly = false }: { className?: string; buyersOnly?: boolean }) {
  const { entry, pending } = useProviderEntryState();
  // Explore is a buyer's page: a provider is not told about their own console there.
  if (buyersOnly && entry?.provider) return null;
  return <ProviderEntryView entry={entry} pending={pending} className={className} />;
}
